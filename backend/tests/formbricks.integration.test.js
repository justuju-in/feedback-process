import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { getDatabasePool } from '../src/db/connection.js';
import { ensureFormbricksSchema } from '../src/db/formbricksSchema.js';
import { connectFormbricksTemplate, openFormbricksSession, syncFormbricksSession } from '../src/services/formbricksService.js';
import { getFeedbackRequestById, redactFeedbackRequestForViewer, performFeedbackRequestAction } from '../src/services/feedbackRequestService.js';
import { submitFeedbackAnswers, saveFeedbackDraft } from '../src/services/feedbackAnswerService.js';
import { loginUser } from '../src/services/authService.js';
import formbricksRouter from '../src/routes/formbricksRoutes.js';
import { updateTemplate } from '../src/services/templateService.js';

const enabled = process.env.FORMBRICKS_TEST_DB === '1';
test('Formbricks lifecycle against disposable MySQL and a mock provider', { skip: !enabled }, async (t) => {
  assert.ok(['localhost', '127.0.0.1'].includes(process.env.DB_HOST), 'Tests require a disposable local database');
  assert.notEqual(process.env.DB_PORT, '3306', 'Do not run on the default database port');
  for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MATTERMOST_WEBHOOK_URL', 'SC_MATTERMOST_WEBHOOK_URL']) delete process.env[key];
  process.env.JWT_SECRET = 'local-integration-tests-not-a-real-secret';
  const survey = { id: 'survey_test', name: `Integration ${Date.now()}`, type: 'link', status: 'inProgress', singleUse: { enabled: true, isEncrypted: false }, questions: [{ id: 'text', type: 'openText', headline: { default: 'What went well?' } }, { id: 'choice', type: 'multipleChoiceMulti', headline: { default: 'Skills' } }, { id: 'rating', type: 'rating', headline: { default: 'Rating' } }, { id: 'branch', type: 'openText', headline: { default: 'Skipped question' } }] };
  let responses = [];
  let generated = 0;
  const remote = http.createServer((req, res) => {
    assert.equal(req.headers['x-api-key'], 'mock-key');
    const url = new URL(req.url, 'http://localhost');
    let data;
    if (url.pathname.endsWith('/singleUseIds')) data = [`${process.env.FORMBRICKS_URL}/s/survey_test?suId=invitation-${stamp}-${++generated}&suToken=signed`];
    else if (url.pathname.endsWith('/surveys/survey_test')) data = survey;
    else if (url.pathname.endsWith('/responses')) data = responses.slice(Number(url.searchParams.get('skip') || 0), Number(url.searchParams.get('skip') || 0) + 250);
    else if (url.pathname.includes('/responses/')) data = responses.find((response) => url.pathname.endsWith(`/${response.id}`));
    else if (url.pathname.endsWith('/me')) data = { id: 'mock-workspace' };
    else { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data }));
  });
  await new Promise((resolve) => remote.listen(0, '127.0.0.1', resolve));
  process.env.FORMBRICKS_URL = `http://127.0.0.1:${remote.address().port}`;
  process.env.FORMBRICKS_API_KEY = 'mock-key';
  const pool = getDatabasePool();
  t.after(async () => { await pool.end(); await new Promise((resolve) => remote.close(resolve)); });
  await ensureFormbricksSchema(pool);
  await ensureFormbricksSchema(pool); // Migration is idempotent.
  const password = 'Local-tests-only-2026';
  const hash = await bcrypt.hash(password, 4);
  const stamp = Date.now();
  const users = [];
  for (const [index, role] of ['admin', 'member', 'member'].entries()) {
    const email = `formbricks-${stamp}-${index}@example.invalid`;
    const [result] = await pool.execute('INSERT INTO users (name, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, TRUE)', [`Test ${role} ${index}`, email, hash, role]);
    users.push({ id: result.insertId, email });
  }
  let template;
  await t.test('connects survey with immutable snapshot', async () => {
    template = await connectFormbricksTemplate({ survey: survey.id, actorId: users[0].id });
    assert.equal(template.provider, 'formbricks');
    await assert.rejects(updateTemplate({ templateId: template.id, name: template.name, questions: ['Changed'], actorId: users[0].id, actorRole: 'admin' }), /Edit the survey in Formbricks/);
  });
  async function createRequest(status = 'requested') {
    const [result] = await pool.execute("INSERT INTO feedback_requests (requester_id, receiver_id, giver_id, template_id, status, is_anonymous) VALUES (?, ?, ?, ?, ?, TRUE)", [users[0].id, users[0].id, users[1].id, template.id, status]);
    return result.insertId;
  }
  const id = await createRequest();
  let session;
  await t.test('only giver can open; concurrent opens reuse one invitation', async () => {
    await assert.rejects(openFormbricksSession(id, users[2].id), /selected feedback giver/);
    const [a, b] = await Promise.all([openFormbricksSession(id, users[1].id), openFormbricksSession(id, users[1].id)]);
    assert.equal(a.link, b.link); assert.equal(generated, 1); session = a;
    assert.match(session.embedUrl, /embed=true/);
  });
  await t.test('native submission and draft endpoints cannot bypass external survey verification', async () => {
    await assert.rejects(submitFeedbackAnswers(id, users[1].id, [{ questionId: 1, answer: 'forged' }]), /Formbricks/);
    await assert.rejects(saveFeedbackDraft(id, users[1].id, [{ questionId: 1, answer: 'forged' }]), /Formbricks/);
  });
  const singleUseId = new URL(session.link).searchParams.get('suId');
  await t.test('partial responses never submit or expose partial answers', async () => {
    responses = [{ id: `response_${stamp}`, surveyId: survey.id, singleUseId, finished: false, data: { text: 'Private unfinished answer' } }];
    assert.equal((await syncFormbricksSession(id, users[1].id)).state, 'partial');
    const detail = await getFeedbackRequestById(id);
    assert.equal(detail.status, 'in_progress'); assert.equal(detail.formbricks.answers, null);
    assert.ok(!JSON.stringify(detail).includes(singleUseId));
  });
  await t.test('completed typed answers import once and omit hidden fields', async () => {
    responses[0] = { ...responses[0], finished: true, data: { text: 'Great teamwork', choice: ['Planning', 'Communication'], rating: 4, hidden_email: 'private@example.invalid' } };
    await pool.execute('UPDATE formbricks_sessions SET last_checked_at = NULL WHERE request_id = ?', [id]);
    const results = await Promise.all([syncFormbricksSession(id, users[1].id), syncFormbricksSession(id, users[1].id)]);
    assert.ok(results.every((result) => result.completed));
    const detail = redactFeedbackRequestForViewer(await getFeedbackRequestById(id), users[0].id);
    assert.equal(detail.status, 'submitted'); assert.equal(detail.giverName, 'Anonymous');
    assert.deepEqual(detail.formbricks.answers.choice, ['Planning', 'Communication']);
    assert.equal(detail.formbricks.answers.rating, 4); assert.ok(!('hidden_email' in detail.formbricks.answers));
    const [[row]] = await pool.execute("SELECT COUNT(*) AS count FROM feedback_audit_log WHERE request_id = ? AND event_type = 'feedback_submitted'", [id]);
    assert.equal(row.count, 1);
  });
  await t.test('existing acknowledgement and close workflow accepts imported feedback', async () => {
    await performFeedbackRequestAction(id, users[0].id, 'acknowledge', 'Thanks');
    await performFeedbackRequestAction(id, users[0].id, 'close');
    assert.equal((await getFeedbackRequestById(id)).status, 'closed');
  });
  await t.test('cancelled requests cannot open or sync', async () => {
    const cancelled = await createRequest();
    await openFormbricksSession(cancelled, users[1].id);
    await pool.execute("UPDATE feedback_requests SET status = 'cancelled' WHERE id = ?", [cancelled]);
    await assert.rejects(syncFormbricksSession(cancelled, users[1].id), /no longer accepting/);
    await assert.rejects(openFormbricksSession(cancelled, users[1].id), /no longer accepting/);
  });
  await t.test('changed survey schema blocks new invitations', async () => {
    const newId = await createRequest();
    survey.questions[0].headline.default = 'Changed remotely';
    await assert.rejects(openFormbricksSession(newId, users[1].id), /survey changed/);
    survey.questions[0].headline.default = 'What went well?';
  });
  await t.test('native templates still support draft and submission', async () => {
    const [native] = await pool.execute("INSERT INTO feedback_templates (name, created_by) VALUES (?, ?)", [`Native ${stamp}`, users[0].id]);
    const [question] = await pool.execute("INSERT INTO template_questions (template_id, question_text, question_order) VALUES (?, 'Native question', 1)", [native.insertId]);
    const [request] = await pool.execute("INSERT INTO feedback_requests (requester_id, receiver_id, giver_id, template_id, status) VALUES (?, ?, ?, ?, 'requested')", [users[0].id, users[0].id, users[1].id, native.insertId]);
    const answers = [{ questionId: question.insertId, answer: 'Native response', rating: 5 }];
    await saveFeedbackDraft(request.insertId, users[1].id, answers);
    await submitFeedbackAnswers(request.insertId, users[1].id, answers);
    const detail = await getFeedbackRequestById(request.insertId);
    assert.equal(detail.provider, 'native'); assert.equal(detail.formbricks, null);
    assert.equal(detail.answers[0].answer, 'Native response'); assert.equal(detail.status, 'submitted');
  });
  await t.test('HTTP routes require auth; only moderators can connect surveys; key never exposed', async () => {
    const app = express(); app.use(express.json()); app.use(cookieParser()); app.use('/formbricks', formbricksRouter);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const base = `http://127.0.0.1:${server.address().port}/formbricks`;
      assert.equal((await fetch(`${base}/config`)).status, 401);
      const login = await loginUser({ email: users[1].email, password });
      const headers = { Cookie: `feedback_access_token=${login.token}`, 'Content-Type': 'application/json' };
      assert.equal((await fetch(`${base}/templates`, { method: 'POST', headers, body: JSON.stringify({ survey: survey.id }) })).status, 403);
      const config = await (await fetch(`${base}/config`, { headers })).json();
      assert.equal(config.configured, true); assert.ok(!JSON.stringify(config).includes('mock-key'));
      assert.equal((await fetch(`${base}/requests/no-id/session`, { method: 'POST', headers, body: '{}' })).status, 400);
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
});

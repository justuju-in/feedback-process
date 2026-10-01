import test from 'node:test';
import assert from 'node:assert/strict';
import { formbricksConfig, formbricksGet, surveyIdFromInput, parseSingleUseLink, validateSurvey, surveySnapshot, responseAnswers, findSessionResponse } from '../src/integrations/formbricks.js';
import { assertFormbricksGiver } from '../src/services/formbricksService.js';

const origin = 'https://app.formbricks.com';
const survey = { id: 'survey1', type: 'link', status: 'inProgress', singleUse: { enabled: true, isEncrypted: false }, questions: [{ id: 'q1', type: 'openText' }, { id: 'q2', type: 'multipleChoiceMulti' }] };
test('configuration never accepts credentials, paths or insecure remote servers', () => {
  for (const value of ['http://remote.test', 'https://key@app.formbricks.com', 'https://app.formbricks.com/path', 'https://app.formbricks.com?key=secret', 'javascript:alert(1)']) assert.throws(() => formbricksConfig({ FORMBRICKS_URL: value }));
  assert.equal(formbricksConfig({ FORMBRICKS_URL: 'http://localhost:5999' }).configured, false);
});
test('survey input cannot select another host or traverse the API path', () => {
  assert.equal(surveyIdFromInput(`${origin}/s/survey1?embed=true`, origin), 'survey1');
  assert.equal(surveyIdFromInput('survey1', origin), 'survey1');
  for (const input of ['../responses', 'https://evil.test/s/survey1', `${origin}/api/v1/management/responses`, '']) assert.throws(() => surveyIdFromInput(input, origin));
});
test('only published single-use link surveys with matchable IDs are supported', () => {
  assert.doesNotThrow(() => validateSurvey(survey, 'survey1'));
  for (const overrides of [{ status: 'draft' }, { type: 'app' }, { singleUse: { enabled: true, isEncrypted: true } }, { questions: [] }]) assert.throws(() => validateSurvey({ ...survey, ...overrides }, 'survey1'));
});
test('signed invitation links preserve signatures but reject foreign origins', () => {
  const link = `${origin}/s/survey1?suId=opaque-id&suToken=signature`;
  assert.deepEqual(parseSingleUseLink([link], origin, 'survey1'), { link, singleUseId: 'opaque-id' });
  for (const link of ['https://evil.test/s/survey1?suId=id', `${origin}/s/wrong?suId=id`, `${origin}/s/survey1`]) assert.throws(() => parseSingleUseLink([link], origin, 'survey1'));
});
test('block surveys retain typed answers and omit hidden/contact metadata', () => {
  const snapshot = surveySnapshot({ blocks: [{ elements: survey.questions }] });
  assert.deepEqual(responseAnswers({ id: 'r1', finished: true, data: { q1: 'Hello', q2: ['One', 'Two'], email: 'private@example.invalid', hidden_id: 44 } }, snapshot), { q1: 'Hello', q2: ['One', 'Two'] });
});
test('responses are paginated and matched to both survey and invitation', async () => {
  const calls = [];
  const session = { surveyId: 'survey1', singleUseId: 'private-id' };
  const found = { ...session, id: 'response1', finished: true };
  const result = await findSessionResponse(session, async (path) => {
    calls.push(path);
    return calls.length === 1 ? Array.from({ length: 250 }, () => ({ surveyId: 'wrong', singleUseId: 'private-id' })) : [found];
  });
  assert.equal(result.id, found.id);
  assert.match(calls[1], /skip=250/);
});
test('known response IDs are revalidated against their invitation', async () => {
  await assert.rejects(findSessionResponse({ surveyId: 'survey1', singleUseId: 'ours', responseId: 'response1' }, async () => ({ surveyId: 'survey1', singleUseId: 'someone-else' })), /does not match/);
});
test('giver-only access rejects cancelled, hidden and removed requests', () => {
  const request = { giverId: 2, status: 'requested' };
  assert.doesNotThrow(() => assertFormbricksGiver(request, 2));
  assert.throws(() => assertFormbricksGiver(request, 1));
  for (const overrides of [{ status: 'cancelled' }, { status: 'submitted' }, { isHidden: true }, { isRemoved: true }]) assert.throws(() => assertFormbricksGiver({ ...request, ...overrides }, 2));
});
test('API keys stay in request headers, redirects are rejected, failures are sanitized', async () => {
  const config = { origin, configured: true, apiKey: 'test-secret' };
  let options;
  await assert.rejects(formbricksGet('surveys/survey1', { config, fetchImpl: async (url, opts) => { assert.ok(!url.includes(config.apiKey)); options = opts; return { ok: false, status: 401 }; } }), /API key is invalid/);
  assert.equal(options.headers['x-api-key'], config.apiKey);
  assert.equal(options.redirect, 'error');
  await assert.rejects(formbricksGet('surveys/survey1', { config, fetchImpl: async () => { throw new Error('test-secret'); } }), /could not be reached/);
});

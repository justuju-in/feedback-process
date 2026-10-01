import { getDatabasePool } from "../db/connection.js";
import { formbricksConfig, formbricksGet, surveyIdFromInput, validateSurvey, surveySnapshot, snapshotHash, parseSingleUseLink, findSessionResponse, responseAnswers, LOCAL_FORMBRICKS_ORIGIN } from "../integrations/formbricks.js";
import { ServiceError } from "./serviceError.js";
import { writeFeedbackAuditEvent } from "./feedbackAuditService.js";
import { notifyFeedbackSubmitted } from "./feedbackAnswerService.js";

const decode = (value) => typeof value === "string" ? JSON.parse(value) : value;
export async function connectFormbricksTemplate({ survey: input, name, actorId }) {
  const config = formbricksConfig();
  const surveyId = surveyIdFromInput(input, config.origin);
  const survey = await formbricksGet(`surveys/${encodeURIComponent(surveyId)}`);
  validateSurvey(survey, surveyId);
  const templateName = String(name || survey.name || "").trim();
  if (templateName.length < 3 || templateName.length > 100) throw new ServiceError(400, "Template name must be 3–100 characters");
  const snapshot = surveySnapshot(survey);
  const connection = await getDatabasePool().getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute("INSERT INTO feedback_templates (name, description, created_by) VALUES (?, ?, ?)", [templateName, "Feedback collected with Formbricks", actorId]);
    await connection.execute("INSERT INTO formbricks_templates (template_id, survey_id, origin, snapshot, snapshot_hash) VALUES (?, ?, ?, ?, ?)", [result.insertId, surveyId, config.origin, JSON.stringify(snapshot), snapshotHash(snapshot)]);
    await connection.commit();
    return { id: result.insertId, name: templateName, description: "Feedback collected with Formbricks", createdBy: actorId, isActive: true, provider: "formbricks" };
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") throw new ServiceError(409, "This template name is already in use. Choose a new name.");
    throw error;
  } finally { connection.release(); }
}

export function assertFormbricksGiver(request, actorId) {
  if (!request) throw new ServiceError(404, "Feedback request not found");
  if (Number(request.giverId) !== Number(actorId)) throw new ServiceError(403, "Only the selected feedback giver can open or sync this survey");
  if (!["requested", "in_progress", "overdue"].includes(request.status)) throw new ServiceError(409, "This feedback request is no longer accepting answers");
  if (request.isHidden || request.isRemoved) throw new ServiceError(409, "This feedback is unavailable");
}
async function lockedRequest(connection, requestId) {
  const [[request]] = await connection.execute("SELECT id, giver_id AS giverId, template_id AS templateId, status, hidden_at AS isHidden, removed_at AS isRemoved FROM feedback_requests WHERE id = ? FOR UPDATE", [requestId]);
  return request;
}
async function templateFor(connection, templateId) {
  const [[template]] = await connection.execute("SELECT survey_id AS surveyId, origin, snapshot, snapshot_hash AS snapshotHash FROM formbricks_templates WHERE template_id = ?", [templateId]);
  if (!template) throw new ServiceError(400, "This request does not use Formbricks");
  if (template.origin === LOCAL_FORMBRICKS_ORIGIN) return { ...template, snapshot: decode(template.snapshot), isLocalTesting: true };
  if (template.origin !== formbricksConfig().origin) throw new ServiceError(409, "This template belongs to a different Formbricks server");
  return { ...template, snapshot: decode(template.snapshot) };
}
async function checkedSurvey(template) {
  const survey = await formbricksGet(`surveys/${encodeURIComponent(template.surveyId)}`);
  validateSurvey(survey, template.surveyId);
  if (snapshotHash(surveySnapshot(survey)) !== template.snapshotHash) throw new ServiceError(409, "This survey changed after it was connected. Restore its questions or create a new template and feedback request.");
}
export async function openFormbricksSession(requestId, actorId) {
  const connection = await getDatabasePool().getConnection();
  try {
    await connection.beginTransaction();
    const request = await lockedRequest(connection, requestId);
    assertFormbricksGiver(request, actorId);
    const template = await templateFor(connection, request.templateId);
    if (template.isLocalTesting) {
      const [[existing]] = await connection.execute("SELECT request_id AS requestId FROM formbricks_sessions WHERE request_id = ?", [requestId]);
      if (!existing) {
        await connection.execute(
          "INSERT INTO formbricks_sessions (request_id, survey_id, origin, single_use_id, invitation_url) VALUES (?, ?, ?, ?, ?)",
          [requestId, template.surveyId, template.origin, `local-${requestId}`, `local-feedback-process://${requestId}`],
        );
        await writeFeedbackAuditEvent({ requestId, actorId, eventType: "formbricks_survey_opened", connection });
      }
      await connection.execute("UPDATE feedback_requests SET status = 'in_progress' WHERE id = ? AND status = 'requested'", [requestId]);
      await connection.commit();
      return { local: true, questions: template.snapshot.questions, blocks: template.snapshot.blocks || [], origin: template.origin };
    }
    await checkedSurvey(template);
    const [[existing]] = await connection.execute("SELECT invitation_url AS link FROM formbricks_sessions WHERE request_id = ?", [requestId]);
    let link = existing?.link;
    if (!link) {
      const invitation = parseSingleUseLink(await formbricksGet(`surveys/${encodeURIComponent(template.surveyId)}/singleUseIds?limit=1`), template.origin, template.surveyId);
      link = invitation.link;
      await connection.execute("INSERT INTO formbricks_sessions (request_id, survey_id, origin, single_use_id, invitation_url) VALUES (?, ?, ?, ?, ?)", [requestId, template.surveyId, template.origin, invitation.singleUseId, link]);
      await writeFeedbackAuditEvent({ requestId, actorId, eventType: "formbricks_survey_opened", connection });
    }
    await connection.execute("UPDATE feedback_requests SET status = 'in_progress' WHERE id = ? AND status = 'requested'", [requestId]);
    await connection.commit();
    const embedded = new URL(link); embedded.searchParams.set("embed", "true");
    return { link, embedUrl: embedded.toString(), origin: template.origin };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

function normalizeLocalAnswer(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value === "boolean" || typeof value === "number") return value;
  return String(value ?? "").trim();
}

function labelText(value) {
  if (typeof value === "string") return value.replace(/<[^>]*>/g, "");
  if (value && typeof value === "object") return labelText(value.default || Object.values(value).find((item) => typeof item === "string") || "");
  return "";
}

function visibleLocalQuestionIds(snapshot, submitted) {
  const blocks = Array.isArray(snapshot.blocks) ? snapshot.blocks : [];
  if (!blocks.length) return new Set((snapshot.questions || []).map((question) => question.id));

  const conditionalTargets = new Map();
  for (const block of blocks) {
    for (const rule of block.logic || []) {
      const sourceId = rule.conditions?.conditions?.[0]?.leftOperand?.value;
      const choiceId = rule.conditions?.conditions?.[0]?.rightOperand?.value;
      for (const action of rule.actions || []) {
        if (action.objective === "jumpToBlock" && action.target && sourceId && choiceId) {
          conditionalTargets.set(action.target, { sourceId, choiceId });
        }
      }
    }
  }

  const questionsById = new Map((snapshot.questions || []).map((question) => [question.id, question]));
  const visible = new Set();
  for (const block of blocks) {
    const condition = conditionalTargets.get(block.id);
    if (condition) {
      const source = questionsById.get(condition.sourceId);
      const expected = labelText(source?.choices?.find((choice) => choice.id === condition.choiceId)?.label);
      if (normalizeLocalAnswer(submitted[condition.sourceId]) !== expected) continue;
    }
    for (const element of block.elements || []) visible.add(element.id);
  }
  return visible;
}

export async function submitLocalFormbricksSession(requestId, actorId, body) {
  const connection = await getDatabasePool().getConnection();
  let changed = false;
  let result = { state: "waiting", completed: false };
  try {
    await connection.beginTransaction();
    const request = await lockedRequest(connection, requestId);
    assertFormbricksGiver(request, actorId);
    const template = await templateFor(connection, request.templateId);
    if (!template.isLocalTesting) throw new ServiceError(400, "This request uses an external Formbricks survey");

    const submitted = body?.answers && typeof body.answers === "object" && !Array.isArray(body.answers) ? body.answers : {};
    const answers = {};
    const visibleQuestionIds = visibleLocalQuestionIds(template.snapshot, submitted);
    for (const question of template.snapshot.questions || []) {
      if (!visibleQuestionIds.has(question.id)) continue;
      const value = normalizeLocalAnswer(submitted[question.id]);
      const empty = Array.isArray(value) ? value.length === 0 : value === "" || value === false || value == null;
      if (question.required && empty) throw new ServiceError(400, "Please answer all required questions");
      if (!empty) answers[question.id] = value;
    }

    await connection.execute(
      `INSERT INTO formbricks_sessions (request_id, survey_id, origin, single_use_id, invitation_url, answers, completed, last_checked_at)
       VALUES (?, ?, ?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE answers = VALUES(answers), completed = TRUE, last_checked_at = CURRENT_TIMESTAMP`,
      [requestId, template.surveyId, template.origin, `local-${requestId}`, `local-feedback-process://${requestId}`, JSON.stringify(answers)],
    );
    await connection.execute("UPDATE feedback_requests SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP WHERE id = ?", [requestId]);
    await writeFeedbackAuditEvent({ requestId, actorId, eventType: "feedback_submitted", details: JSON.stringify({ provider: "formbricks-local-test" }), connection });
    changed = true;
    result = { state: "completed", completed: true };
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  if (changed) {
    try { await notifyFeedbackSubmitted(requestId, actorId); }
    catch { console.error("Local Formbricks feedback saved, but a notification failed"); }
  }
  return result;
}

export async function syncFormbricksSession(requestId, actorId) {
  const connection = await getDatabasePool().getConnection();
  let completed = false;
  let changed = false;
  let state = "waiting";
  try {
    await connection.beginTransaction();
    const request = await lockedRequest(connection, requestId);
    if (!request || Number(request.giverId) !== Number(actorId)) throw new ServiceError(403, "Only the selected feedback giver can sync this survey");
    const [[session]] = await connection.execute("SELECT survey_id AS surveyId, origin, single_use_id AS singleUseId, response_id AS responseId, completed, (TIMESTAMPDIFF(SECOND, last_checked_at, CURRENT_TIMESTAMP) < 5) AS recentlyChecked FROM formbricks_sessions WHERE request_id = ?", [requestId]);
    if (!session) throw new ServiceError(409, "Open the survey before checking for a response");
    if (session.completed) { await connection.commit(); return { state: "completed", completed: true }; }
    assertFormbricksGiver(request, actorId);
    const template = await templateFor(connection, request.templateId);
    if (session.origin !== template.origin) throw new ServiceError(409, "Survey server configuration changed");
    if (session.recentlyChecked) {
      await connection.commit(); return { state: "waiting", completed: false };
    }
    // Prevent importing answers against stale question labels after a remote edit.
    const survey = await formbricksGet(`surveys/${encodeURIComponent(template.surveyId)}`);
    if (snapshotHash(surveySnapshot(survey)) !== template.snapshotHash) throw new ServiceError(409, "Survey questions changed. Restore the connected survey version before syncing.");
    const response = await findSessionResponse(session);
    if (response) {
      const answers = responseAnswers(response, template.snapshot);
      completed = response.finished === true;
      state = completed ? "completed" : "partial";
      await connection.execute("UPDATE formbricks_sessions SET response_id = ?, answers = ?, completed = ?, last_checked_at = CURRENT_TIMESTAMP WHERE request_id = ?", [response.id, JSON.stringify(answers), completed, requestId]);
      if (completed) {
        await connection.execute("UPDATE feedback_requests SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP WHERE id = ?", [requestId]);
        await writeFeedbackAuditEvent({ requestId, actorId, eventType: "feedback_submitted", details: JSON.stringify({ provider: "formbricks" }), connection });
        changed = true;
      }
    } else {
      await connection.execute("UPDATE formbricks_sessions SET last_checked_at = CURRENT_TIMESTAMP WHERE request_id = ?", [requestId]);
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  if (changed) {
    try { await notifyFeedbackSubmitted(requestId, actorId); }
    catch { console.error("Formbricks feedback saved, but a notification failed"); }
  }
  return { state, completed };
}

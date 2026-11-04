import { getDatabasePool } from "../db/connection.js";
import {
  sendFeedbackDueDateChangedNotification,
  sendFeedbackDueTodayNotification,
  sendFeedbackDueSoonNotification,
  sendFeedbackOverdueNotification,
  sendFeedbackRequestNotification,
} from "../integrations/mattermost.js";
import { sendFeedbackEmail } from "../integrations/email.js";
import { ServiceError } from "./serviceError.js";
import { createInAppNotification } from "./notificationService.js";
import { writeFeedbackAuditEvent } from "./feedbackAuditService.js";

const requestSelect = `
  SELECT
    request.id,
    request.requester_id AS requesterId,
    requester.name AS requesterName,
    requester.email AS requesterEmail,
    request.giver_id AS giverId,
    giver.name AS giverName,
    giver.email AS giverEmail,
    giver.role AS giverRole,
    request.receiver_id AS receiverId,
    receiver.name AS receiverName,
    receiver.email AS receiverEmail,
    request.template_id AS templateId,
    template.name AS templateName,
    request.message,
    request.purpose,
    request.visibility,
    request.is_anonymous AS isAnonymous,
    request.due_date AS dueDate,
    request.status,
    request.decline_reason AS declineReason,
    request.alternate_giver_id AS alternateGiverId,
    alternate_giver.name AS alternateGiverName,
    request.acknowledgement_comment AS acknowledgementComment,
    request.acknowledged_at AS acknowledgedAt,
    EXISTS(
      SELECT 1 FROM feedback_follow_ups AS follow_up
      WHERE follow_up.request_id = request.id AND follow_up.status != 'completed'
    ) AS hasOpenFollowUps,
    request.created_at AS createdAt,
    request.updated_at AS updatedAt
  FROM feedback_requests AS request
  JOIN users AS requester ON requester.id = request.requester_id
  JOIN users AS giver ON giver.id = request.giver_id
  JOIN users AS receiver ON receiver.id = request.receiver_id
  LEFT JOIN users AS alternate_giver ON alternate_giver.id = request.alternate_giver_id
  JOIN feedback_templates AS template ON template.id = request.template_id
`;

async function notifyUser(payload) {
  try {
    await createInAppNotification(payload);
  } catch (error) {
    console.error("In-app notification failed:", error.message);
  }
}

async function requireUser(pool, userId, label) {
  const [[user]] = await pool.execute(
    "SELECT id, role, is_active AS isActive FROM users WHERE id = ?",
    [userId],
  );

  if (!user) {
    throw new ServiceError(404, `${label} not found`);
  }
  if (!user.isActive) throw new ServiceError(400, `${label} is inactive`);
  return user;
}

async function requireTemplate(pool, templateId) {
  const [[template]] = await pool.execute(
    "SELECT id FROM feedback_templates WHERE id = ?",
    [templateId],
  );

  if (!template) {
    throw new ServiceError(404, "Feedback template not found");
  }
}

// This runs whenever requests are read. The dashboard refreshes every 3 seconds,
// so an unanswered request changes from Requested to Overdue shortly after its due date passes.
async function markOverdueRequests(pool) {
  await pool.execute(
    `UPDATE feedback_requests
     SET status = 'overdue'
     WHERE status IN ('requested', 'in_progress')
       AND due_date IS NOT NULL
       AND due_date < CURRENT_DATE()`,
  );
}

async function recordNotification(pool, requestId, notificationKey) {
  try {
    await pool.execute(
      "INSERT INTO feedback_notification_log (request_id, notification_key) VALUES (?, ?)",
      [requestId, notificationKey],
    );
    return true;
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return false;
    throw error;
  }
}

/**
 * Sends one reminder two days before and on the day a request is due, plus an
 * overdue alert. The database log makes this safe to call every hour.
 */
export async function sendScheduledFeedbackReminders() {
  const pool = getDatabasePool();
  await markOverdueRequests(pool);
  const [requests] = await pool.execute(
    `${requestSelect}
     WHERE (request.status IN ('requested', 'in_progress') AND request.due_date = DATE_ADD(CURRENT_DATE(), INTERVAL 2 DAY))
        OR (request.status IN ('requested', 'in_progress') AND request.due_date = CURRENT_DATE())
        OR (request.status = 'overdue' AND request.due_date < CURRENT_DATE())`,
  );

  const result = { dueSoon: 0, dueToday: 0, overdue: 0 };
  for (const feedbackRequest of requests) {
    if (feedbackRequest.giverRole === "external") continue;
    const isOverdue = feedbackRequest.status === "overdue";
    const isDueToday = !isOverdue && feedbackRequest.dueDate === new Date().toISOString().slice(0, 10);
    const notificationKind = isOverdue ? "overdue" : isDueToday ? "due-today" : "due-soon";
    const notificationKey = `${notificationKind}:${feedbackRequest.dueDate}`;
    const notification = isOverdue
      ? await sendFeedbackOverdueNotification(feedbackRequest)
      : isDueToday
        ? await sendFeedbackDueTodayNotification(feedbackRequest)
        : await sendFeedbackDueSoonNotification(feedbackRequest);
    const reminderText = isOverdue
      ? `${feedbackRequest.templateName} feedback for ${feedbackRequest.receiverName} is overdue.`
      : isDueToday
        ? `${feedbackRequest.templateName} feedback for ${feedbackRequest.receiverName} is due today.`
        : `${feedbackRequest.templateName} feedback for ${feedbackRequest.receiverName} is due in 2 days.`;
    let emailSent = false;
    try {
      await sendFeedbackEmail({
        email: feedbackRequest.giverEmail,
        name: feedbackRequest.giverName,
        subject: isOverdue ? "Feedback request is overdue" : isDueToday ? "Feedback request due today" : "Feedback request due in 2 days",
        message: reminderText,
        actionUrl: process.env.FRONTEND_ORIGIN || undefined,
      });
      emailSent = true;
    } catch (error) {
      console.error("Feedback reminder email failed:", error.message);
    }

    // Mattermost is optional when email is configured, but at least one
    // delivery channel needs to succeed before this reminder is marked sent.
    if (!notification?.sent && !emailSent) continue;
    const recorded = await recordNotification(pool, feedbackRequest.id, notificationKey);
    if (recorded) {
      await notifyUser({
        userId: feedbackRequest.giverId,
        requestId: feedbackRequest.id,
        type: isOverdue ? "feedback_overdue" : isDueToday ? "feedback_due_today" : "feedback_due_soon",
        title: isOverdue ? "Feedback is overdue" : isDueToday ? "Feedback due today" : "Feedback due in 2 days",
        message: reminderText,
      });
      result[isOverdue ? "overdue" : isDueToday ? "dueToday" : "dueSoon"] += 1;
    }
  }
  return result;
}

// Follow-up actions are part of a feedback request, so use the same durable
// notification log. A reminder is created only once per follow-up and date.
export async function sendScheduledFollowUpReminders() {
  const pool = getDatabasePool();
  const [followUps] = await pool.execute(
    `SELECT follow_up.id, follow_up.request_id AS requestId, follow_up.owner_id AS ownerId,
       follow_up.details, follow_up.due_date AS dueDate
     FROM feedback_follow_ups AS follow_up
     WHERE follow_up.status != 'completed'
       AND follow_up.due_date IS NOT NULL
       AND follow_up.due_date <= CURRENT_DATE()`,
  );

  let dueToday = 0;
  let overdue = 0;
  for (const followUp of followUps) {
    const isOverdue = String(followUp.dueDate).slice(0, 10) < new Date().toISOString().slice(0, 10);
    const notificationKey = `follow-up-${followUp.id}:${isOverdue ? "overdue" : "due-today"}:${followUp.dueDate}`;
    const recorded = await recordNotification(pool, followUp.requestId, notificationKey);
    if (!recorded) continue;
    await notifyUser({
      userId: followUp.ownerId,
      requestId: followUp.requestId,
      type: isOverdue ? "follow_up_overdue" : "follow_up_due_today",
      title: isOverdue ? "Follow-up is overdue" : "Follow-up due today",
      message: isOverdue
        ? `Your follow-up action is overdue: ${followUp.details}`
        : `Your follow-up action is due today: ${followUp.details}`,
    });
    if (isOverdue) overdue += 1;
    else dueToday += 1;
  }
  return { dueToday, overdue };
}

export async function createFeedbackRequest({
  requesterId,
  giverId,
  receiverId,
  templateId,
  message,
  dueDate,
  purpose,
  visibility,
  viewerIds,
  isAnonymous,
}) {
  // A person requests feedback about themselves: requester is always receiver.
  receiverId = requesterId;
  if (requesterId === giverId) {
    throw new ServiceError(400, "You cannot request feedback from yourself");
  }

  const pool = getDatabasePool();
  const normalizedDueDate = normalizeDueDate(dueDate);
  const normalizedPurpose = normalizePurpose(purpose);
  const normalizedVisibility = normalizeVisibility(visibility);
  const normalizedIsAnonymous = normalizeAnonymous(isAnonymous);
  const normalizedViewerIds = normalizeViewerIds(viewerIds, requesterId, giverId, normalizedVisibility);
  const requester = await requireUser(pool, requesterId, "Requester");
  if (requester.role === "external") throw new ServiceError(403, "External collaborators cannot create feedback requests");
  await requireUser(pool, giverId, "Feedback giver");
  await requireUser(pool, receiverId, "Feedback receiver");
  for (const viewerId of normalizedViewerIds) {
    const viewer = await requireUser(pool, viewerId, "Selected viewer");
    if (normalizedVisibility === "mentor_lead" && !["mentor", "lead", "manager"].includes(String(viewer.role || "").toLowerCase())) {
      throw new ServiceError(400, "The selected viewer must have a Mentor, Lead, or Manager role");
    }
  }
  await requireTemplate(pool, templateId);

  const [[duplicateRequest]] = await pool.execute(
    `SELECT id
     FROM feedback_requests
     WHERE requester_id = ?
       AND giver_id = ?
       AND receiver_id = ?
       AND template_id = ?
       AND status IN ('requested', 'in_progress', 'overdue')
     LIMIT 1`,
    [requesterId, giverId, receiverId, templateId],
  );

  if (duplicateRequest) {
    throw new ServiceError(
      409,
      "An open feedback request already exists for this requester, giver, and template",
    );
  }

  const connection = await pool.getConnection();
  let result;
  try {
    await connection.beginTransaction();
    [result] = await connection.execute(
      `INSERT INTO feedback_requests
         (requester_id, giver_id, receiver_id, template_id, message, due_date, purpose, visibility, is_anonymous, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested')`,
      [requesterId, giverId, receiverId, templateId, message || null, normalizedDueDate, normalizedPurpose, normalizedVisibility, normalizedIsAnonymous],
    );
    for (const viewerId of normalizedViewerIds) {
      await connection.execute(
        "INSERT INTO feedback_request_viewers (request_id, user_id) VALUES (?, ?)",
        [result.insertId, viewerId],
      );
    }
    await writeFeedbackAuditEvent({ requestId: result.insertId, actorId: requesterId, eventType: "request_created", connection });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const feedbackRequest = await getFeedbackRequestById(result.insertId);
  await notifyUser({
    userId: feedbackRequest.giverId,
    requestId: feedbackRequest.id,
    type: "feedback_request",
    title: "New feedback request",
    message: `${feedbackRequest.requesterName} requested ${feedbackRequest.templateName} from you.`,
  });

  let notification = { sent: false, reason: "Mattermost notification was not sent" };
  try {
    notification = await sendFeedbackRequestNotification(feedbackRequest);
  } catch (error) {
    console.error("Mattermost notification failed:", error.message);
  }
  try {
    await sendFeedbackEmail({
      email: feedbackRequest.giverEmail,
      name: feedbackRequest.giverName,
      subject: "New feedback request",
      message: `${feedbackRequest.requesterName} requested ${feedbackRequest.templateName} feedback from you.`,
      actionUrl: process.env.FRONTEND_ORIGIN || undefined,
    });
  } catch (error) {
    console.error("Feedback request email failed:", error.message);
  }
  return { ...feedbackRequest, notification };
}

function normalizeAnonymous(isAnonymous) {
  if (isAnonymous === undefined || isAnonymous === null) return false;
  if (typeof isAnonymous !== "boolean") {
    throw new ServiceError(400, "isAnonymous must be true or false");
  }
  return isAnonymous;
}

function normalizeVisibility(visibility) {
  const value = visibility || "private";
  if (!["private", "mentor_lead", "selected_group"].includes(value)) {
    throw new ServiceError(400, "visibility must be private, mentor_lead, or selected_group");
  }
  return value;
}

function normalizeViewerIds(viewerIds, requesterId, giverId, visibility) {
  const ids = viewerIds === undefined ? [] : viewerIds;
  if (!Array.isArray(ids) || ids.some((id) => !Number.isInteger(Number(id)) || Number(id) <= 0)) {
    throw new ServiceError(400, "viewerIds must contain positive user IDs");
  }
  const uniqueIds = [...new Set(ids.map(Number))];
  if (uniqueIds.some((id) => id === requesterId || id === giverId)) {
    throw new ServiceError(400, "Requester and feedback giver already have access");
  }
  if (visibility === "private" && uniqueIds.length) {
    throw new ServiceError(400, "Private feedback cannot have extra viewers");
  }
  if (visibility === "mentor_lead" && uniqueIds.length !== 1) {
    throw new ServiceError(400, "Select one mentor or lead viewer");
  }
  if (visibility === "selected_group" && uniqueIds.length === 0) {
    throw new ServiceError(400, "Select at least one group viewer");
  }
  return uniqueIds;
}

function normalizePurpose(purpose) {
  if (purpose === undefined || purpose === null || purpose === "") {
    return null;
  }

  const allowedPurposes = ["growth", "project_improvement", "one_on_one", "appraisal"];
  if (!allowedPurposes.includes(purpose)) {
    throw new ServiceError(400, "purpose must be growth, project_improvement, one_on_one, or appraisal");
  }
  return purpose;
}

function normalizeDueDate(dueDate) {
  if (dueDate === undefined || dueDate === null || dueDate === "") {
    return null;
  }

  if (typeof dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new ServiceError(400, "dueDate must use YYYY-MM-DD format");
  }

  const parsed = new Date(`${dueDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dueDate) {
    throw new ServiceError(400, "dueDate must be a valid calendar date");
  }

  const today = new Date().toISOString().slice(0, 10);
  if (dueDate < today) {
    throw new ServiceError(400, "Due date cannot be in the past");
  }

  return dueDate;
}

export async function getRequestsForGiver(giverId) {
  const pool = getDatabasePool();
  await requireUser(pool, giverId, "Feedback giver");
  await markOverdueRequests(pool);

  const [requests] = await pool.execute(
    `${requestSelect}
     WHERE request.giver_id = ?
       AND request.hidden_at IS NULL
       AND request.removed_at IS NULL
     ORDER BY request.created_at DESC, request.id DESC`,
    [giverId],
  );

  return requests;
}

export async function getRequestsForRequester(requesterId) {
  const pool = getDatabasePool();
  await requireUser(pool, requesterId, "Requester");
  await markOverdueRequests(pool);

  const [requests] = await pool.execute(
    `${requestSelect}
     WHERE request.requester_id = ?
       AND request.hidden_at IS NULL
       AND request.removed_at IS NULL
     ORDER BY request.created_at DESC, request.id DESC`,
    [requesterId],
  );

  return requests;
}

export async function getRequestsForReceiver(receiverId) {
  const pool = getDatabasePool();
  await requireUser(pool, receiverId, "Feedback receiver");
  await markOverdueRequests(pool);
  const [requests] = await pool.execute(
    `${requestSelect} WHERE request.receiver_id = ? AND request.hidden_at IS NULL AND request.removed_at IS NULL ORDER BY request.created_at DESC, request.id DESC`,
    [receiverId],
  );
  return requests;
}

export async function getRequestsVisibleTo(viewerId) {
  const pool = getDatabasePool();
  await requireUser(pool, viewerId, "Viewer");
  await markOverdueRequests(pool);
  const [requests] = await pool.execute(
    `${requestSelect}
     JOIN feedback_request_viewers AS viewer ON viewer.request_id = request.id
     WHERE viewer.user_id = ?
       AND request.hidden_at IS NULL
       AND request.removed_at IS NULL
     ORDER BY request.created_at DESC, request.id DESC`,
    [viewerId],
  );
  return requests;
}

export async function getFeedbackRequestById(requestId) {
  const pool = getDatabasePool();
  await markOverdueRequests(pool);
  const [[request]] = await pool.execute(
    `${requestSelect}
     WHERE request.id = ?`,
    [requestId],
  );

  const [attachments] = await pool.execute(
    `SELECT attachment.id, attachment.label, attachment.url, attachment.added_by AS addedBy,
       user.name AS addedByName, attachment.created_at AS createdAt
     FROM feedback_request_attachments AS attachment
     JOIN users AS user ON user.id = attachment.added_by
     WHERE attachment.request_id = ? ORDER BY attachment.created_at ASC, attachment.id ASC`,
    [requestId],
  );

  if (!request) {
    throw new ServiceError(404, "Feedback request not found");
  }

  const [viewers] = await pool.execute(
    `SELECT viewer.user_id AS userId, user.name, user.email
     FROM feedback_request_viewers AS viewer
     JOIN users AS user ON user.id = viewer.user_id
     WHERE viewer.request_id = ?
     ORDER BY user.name`,
    [requestId],
  );

  // Questions belong to the feedback request's selected template. Returning
  // them with the request detail prevents the client from accidentally loading
  // questions from a different template while the request is being refreshed.
  const [questions] = await pool.execute(
    `SELECT id, question_text AS questionText, question_order AS questionOrder
     FROM template_questions
     WHERE template_id = ?
     ORDER BY question_order, id`,
    [request.templateId],
  );

  const [answers] = await pool.execute(
    `SELECT
       answer.id,
       answer.question_id AS questionId,
       question.question_text AS questionText,
       answer.answer,
       answer.rating,
       answer.created_at AS createdAt
     FROM feedback_answers AS answer
     JOIN template_questions AS question ON question.id = answer.question_id
     WHERE answer.request_id = ?
     ORDER BY question.question_order, answer.id`,
    [requestId],
  );

  const [[draft]] = await pool.execute(
    `SELECT giver_id AS giverId, answers, updated_at AS updatedAt
     FROM feedback_answer_drafts WHERE request_id = ?`,
    [requestId],
  );

  const [followUps] = await pool.execute(
    `SELECT
       follow_up.id,
       follow_up.details,
       follow_up.owner_id AS ownerId,
       owner.name AS ownerName,
       follow_up.due_date AS dueDate,
       follow_up.status,
       (follow_up.status != 'completed' AND follow_up.due_date IS NOT NULL AND follow_up.due_date < CURRENT_DATE()) AS isOverdue,
       CASE
         WHEN follow_up.status != 'completed' AND follow_up.due_date IS NOT NULL AND follow_up.due_date < CURRENT_DATE()
         THEN DATEDIFF(CURRENT_DATE(), follow_up.due_date)
         ELSE 0
       END AS overdueDays,
       follow_up.progress_note AS progressNote,
       follow_up.completed_at AS completedAt,
       follow_up.created_at AS createdAt,
       follow_up.updated_at AS updatedAt
     FROM feedback_follow_ups AS follow_up
     JOIN users AS owner ON owner.id = follow_up.owner_id
     WHERE follow_up.request_id = ?
     ORDER BY follow_up.created_at DESC, follow_up.id DESC`,
    [requestId],
  );

  const [discussions] = await pool.execute(
    `SELECT discussion.id, discussion.parent_id AS parentId, discussion.answer_id AS answerId,
       discussion.author_id AS authorId, author.name AS authorName,
       discussion.type, discussion.message, discussion.status,
       discussion.resolved_at AS resolvedAt, discussion.created_at AS createdAt
     FROM feedback_discussions AS discussion
     JOIN users AS author ON author.id = discussion.author_id
     WHERE discussion.request_id = ?
     ORDER BY discussion.created_at ASC, discussion.id ASC`,
    [requestId],
  );

  const [auditLog] = await pool.execute(
    `SELECT audit.id, audit.actor_id AS actorId, audit.event_type AS eventType, audit.details,
       audit.created_at AS createdAt, actor.name AS actorName
     FROM feedback_audit_log AS audit
     LEFT JOIN users AS actor ON actor.id = audit.actor_id
     WHERE audit.request_id = ?
     ORDER BY audit.created_at ASC, audit.id ASC`,
    [requestId],
  );

  return {
    ...request,
    viewers,
    questions,
    answers,
    draft: draft ? { ...draft, answers: typeof draft.answers === "string" ? JSON.parse(draft.answers) : draft.answers } : null,
    followUps,
    attachments,
    discussions,
    auditLog,
  };
}

export async function addFeedbackAttachment({ requestId, actorId, label, url }) {
  const normalizedLabel = String(label || "").trim();
  const normalizedUrl = String(url || "").trim();
  if (normalizedLabel.length < 2 || normalizedLabel.length > 160) throw new ServiceError(400, "Attachment name must be between 2 and 160 characters");
  let parsedUrl;
  try { parsedUrl = new URL(normalizedUrl); } catch { throw new ServiceError(400, "Enter a valid link"); }
  if (!["https:", "http:"].includes(parsedUrl.protocol)) throw new ServiceError(400, "Attachment link must use http or https");
  const pool = getDatabasePool();
  const [[request]] = await pool.execute("SELECT requester_id AS requesterId, giver_id AS giverId, receiver_id AS receiverId, status FROM feedback_requests WHERE id = ?", [requestId]);
  if (!request) throw new ServiceError(404, "Feedback request not found");
  if (request.requesterId !== actorId) throw new ServiceError(403, "Only the requester can add supporting links");
  if (["cancelled", "declined", "closed"].includes(request.status)) throw new ServiceError(409, "Supporting links cannot be added to a completed request");
  await pool.execute("INSERT INTO feedback_request_attachments (request_id, added_by, label, url) VALUES (?, ?, ?, ?)", [requestId, actorId, normalizedLabel, normalizedUrl]);
  await writeFeedbackAuditEvent({ requestId, actorId, eventType: "supporting_link_added" });
  return getFeedbackRequestById(requestId);
}

// The database preserves the giver for authorised operations, but API output
// must not reveal that identity to the requester, receiver, or selected viewers.
// The giver can still recognise their own request and submit their feedback.
export function redactFeedbackRequestForViewer(feedbackRequest, viewerId) {
  const hideDraft = (request) => Number(request?.draft?.giverId) === Number(viewerId)
    ? request
    : { ...request, draft: null };
  if (!feedbackRequest?.isAnonymous || Number(feedbackRequest.giverId) === Number(viewerId)) {
    return hideDraft(feedbackRequest);
  }

  const isGiver = (person) => Number(person?.authorId ?? person?.ownerId ?? person?.actorId) === Number(feedbackRequest.giverId);
  return hideDraft({
    ...feedbackRequest,
    giverName: "Anonymous",
    giverEmail: null,
    followUps: feedbackRequest.followUps?.map((followUp) => (
      isGiver(followUp) ? { ...followUp, ownerName: "Anonymous" } : followUp
    )),
    discussions: feedbackRequest.discussions?.map((discussion) => (
      isGiver(discussion) ? { ...discussion, authorName: "Anonymous" } : discussion
    )),
    auditLog: feedbackRequest.auditLog?.map((event) => (
      isGiver(event) ? { ...event, actorName: "Anonymous" } : event
    )),
  });
}

export async function createFeedbackDiscussion({ requestId, actorId, type, message, parentId = null, answerId = null }) {
  const normalizedMessage = typeof message === "string" ? message.trim() : "";
  if (normalizedMessage.length < 3) throw new ServiceError(400, "Message must be at least 3 characters");
  if (normalizedMessage.length > 1000) throw new ServiceError(400, "Message must be 1000 characters or less");

  const pool = getDatabasePool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[request]] = await connection.execute(
      `SELECT requester_id AS requesterId, giver_id AS giverId, receiver_id AS receiverId, status
       FROM feedback_requests WHERE id = ? FOR UPDATE`,
      [requestId],
    );
    if (!request) throw new ServiceError(404, "Feedback request not found");
    if (!["submitted", "acknowledged"].includes(request.status)) {
      throw new ServiceError(409, "Clarification is available after feedback is submitted and before it is closed");
    }

    if (answerId !== null) {
      const [[answer]] = await connection.execute(
        "SELECT id FROM feedback_answers WHERE id = ? AND request_id = ?",
        [answerId, requestId],
      );
      if (!answer) throw new ServiceError(400, "This answer does not belong to the selected feedback request");
    }

    if (actorId === request.receiverId) {
      if (parentId) throw new ServiceError(400, "Only the feedback giver can reply to a clarification");
      if (!["clarification", "disagreement", "support"].includes(type)) {
        throw new ServiceError(400, "type must be clarification, disagreement, or support");
      }
      await connection.execute(
        `INSERT INTO feedback_discussions (request_id, answer_id, author_id, type, message, status)
         VALUES (?, ?, ?, ?, ?, 'open')`,
        [requestId, answerId, actorId, type, normalizedMessage],
      );
    } else if (actorId === request.giverId) {
      if (type !== "response" || !parentId) {
        throw new ServiceError(400, "A feedback giver must reply to an open clarification");
      }
      const [[parent]] = await connection.execute(
        `SELECT id, author_id AS authorId, status, answer_id AS answerId
         FROM feedback_discussions
         WHERE id = ? AND request_id = ? AND parent_id IS NULL
         FOR UPDATE`,
        [parentId, requestId],
      );
      if (!parent || parent.authorId !== request.receiverId || parent.status !== "open") {
        throw new ServiceError(409, "This clarification is no longer open for a reply");
      }
      await connection.execute(
        `INSERT INTO feedback_discussions (request_id, parent_id, answer_id, author_id, type, message, status)
         VALUES (?, ?, ?, ?, 'response', ?, 'resolved')`,
        [requestId, parentId, parent.answerId, actorId, normalizedMessage],
      );
      await connection.execute(
        "UPDATE feedback_discussions SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP WHERE id = ?",
        [parentId],
      );
    } else {
      throw new ServiceError(403, "Only the feedback receiver can ask for clarification and only the giver can reply");
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const feedbackRequest = await getFeedbackRequestById(requestId);
  const isReply = actorId === feedbackRequest.giverId;
  await notifyUser({
    userId: isReply ? feedbackRequest.receiverId : feedbackRequest.giverId,
    requestId: feedbackRequest.id,
    type: isReply ? "feedback_reply" : "feedback_question",
    title: isReply ? "Reply to your feedback question" : "New question about feedback",
    message: isReply
      ? `${feedbackRequest.giverName} replied to your question.`
      : `${feedbackRequest.receiverName} asked a question about the feedback.`,
  });
  return feedbackRequest;
}

export async function createFollowUp({ requestId, actorId, details, ownerId, dueDate }) {
  const normalizedDueDate = normalizeDueDate(dueDate);
  const pool = getDatabasePool();
  const [[request]] = await pool.execute(
    "SELECT requester_id AS requesterId, giver_id AS giverId, receiver_id AS receiverId, status FROM feedback_requests WHERE id = ?",
    [requestId],
  );
  if (!request) throw new ServiceError(404, "Feedback request not found");
  if (![request.requesterId, request.receiverId].includes(actorId)) throw new ServiceError(403, "Only the requester or receiver can create a follow-up");
  if (!["acknowledged", "follow_up_needed"].includes(request.status)) throw new ServiceError(409, "Follow-ups can be created after feedback is acknowledged");
  if (!details?.trim()) throw new ServiceError(400, "Follow-up details are required");
  if (details.trim().length > 500) throw new ServiceError(400, "Follow-up details must be 500 characters or less");
  await requireUser(pool, ownerId, "Follow-up owner");
  if (![request.requesterId, request.giverId, request.receiverId].includes(ownerId)) {
    throw new ServiceError(400, "Follow-up owner must be part of this feedback request");
  }
  const connection = await pool.getConnection();
  let result;
  try {
    await connection.beginTransaction();
    [result] = await connection.execute(
      `INSERT INTO feedback_follow_ups (request_id, details, owner_id, due_date)
       VALUES (?, ?, ?, ?)`,
      [requestId, details.trim(), ownerId, normalizedDueDate],
    );
    await connection.execute("UPDATE feedback_requests SET status = 'follow_up_needed' WHERE id = ?", [requestId]);
    await writeFeedbackAuditEvent({ requestId, actorId, eventType: "follow_up_created", details: details.trim(), connection });
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  if (ownerId !== actorId) {
    await notifyUser({
      userId: ownerId,
      requestId,
      type: "follow_up_assigned",
      title: "You have a follow-up action",
      message: `Follow-up assigned: ${details.trim()}`,
    });
  }
  return getFollowUpById(result.insertId);
}

export async function updateFollowUp({ followUpId, actorId, status, progressNote }) {
  const pool = getDatabasePool();
  const [[followUp]] = await pool.execute(
    `SELECT follow_up.id, follow_up.owner_id AS ownerId, follow_up.request_id AS requestId,
            request.requester_id AS requesterId
     FROM feedback_follow_ups AS follow_up
     JOIN feedback_requests AS request ON request.id = follow_up.request_id
     WHERE follow_up.id = ?`,
    [followUpId],
  );
  if (!followUp) throw new ServiceError(404, "Follow-up not found");
  if (![followUp.ownerId, followUp.requesterId].includes(actorId)) {
    throw new ServiceError(403, "Only the follow-up owner or requester can update it");
  }
  if (!["open", "in_progress", "completed"].includes(status)) {
    throw new ServiceError(400, "Follow-up status must be open, in_progress, or completed");
  }
  if (progressNote !== undefined && typeof progressNote !== "string") {
    throw new ServiceError(400, "Progress note must be text");
  }
  if (progressNote?.trim().length > 500) throw new ServiceError(400, "Progress note must be 500 characters or less");
  await pool.execute(
    `UPDATE feedback_follow_ups
     SET status = ?, progress_note = ?, completed_at = CASE WHEN ? = 'completed' THEN CURRENT_TIMESTAMP ELSE NULL END
     WHERE id = ?`,
    [status, progressNote?.trim() || null, status, followUpId],
  );
  await writeFeedbackAuditEvent({
    requestId: followUp.requestId,
    actorId,
    eventType: `follow_up_${status}`,
    details: progressNote?.trim() || null,
  });
  const recipients = [followUp.ownerId, followUp.requesterId].filter((userId) => userId !== actorId);
  await Promise.all([...new Set(recipients)].map((userId) => notifyUser({
    userId,
    requestId: followUp.requestId,
    type: "follow_up_updated",
    title: "Follow-up updated",
    message: `A follow-up action is now ${status.replace("_", " ")}.`,
  })));
  return getFollowUpById(followUpId);
}

async function getFollowUpById(followUpId) {
  const pool = getDatabasePool();
  const [[followUp]] = await pool.execute(
    `SELECT follow_up.id, follow_up.request_id AS requestId, follow_up.details,
       follow_up.owner_id AS ownerId, owner.name AS ownerName, follow_up.due_date AS dueDate,
       follow_up.status,
       (follow_up.status != 'completed' AND follow_up.due_date IS NOT NULL AND follow_up.due_date < CURRENT_DATE()) AS isOverdue,
       CASE
         WHEN follow_up.status != 'completed' AND follow_up.due_date IS NOT NULL AND follow_up.due_date < CURRENT_DATE()
         THEN DATEDIFF(CURRENT_DATE(), follow_up.due_date)
         ELSE 0
       END AS overdueDays,
       follow_up.progress_note AS progressNote,
       follow_up.completed_at AS completedAt, follow_up.created_at AS createdAt
     FROM feedback_follow_ups AS follow_up
     JOIN users AS owner ON owner.id = follow_up.owner_id
     WHERE follow_up.id = ?`,
    [followUpId],
  );
  return followUp;
}

export async function updateFeedbackRequestStatus(requestId, status) {
  const pool = getDatabasePool();
  const [result] = await pool.execute(
    `UPDATE feedback_requests
     SET status = ?
     WHERE id = ?`,
    [status, requestId],
  );

  if (result.affectedRows === 0) {
    throw new ServiceError(404, "Feedback request not found");
  }

  return getFeedbackRequestById(requestId);
}

export async function updateFeedbackRequestDueDate(requestId, requesterId, dueDate) {
  const normalizedDueDate = normalizeDueDate(dueDate);
  const pool = getDatabasePool();
  const [[request]] = await pool.execute(
    "SELECT requester_id AS requesterId, status FROM feedback_requests WHERE id = ?",
    [requestId],
  );

  if (!request) {
    throw new ServiceError(404, "Feedback request not found");
  }

  if (request.requesterId !== requesterId) {
    throw new ServiceError(403, "Only the requester can change the due date");
  }

  if (!["requested", "in_progress", "overdue"].includes(request.status)) {
    throw new ServiceError(409, "Due date can only be changed before feedback is submitted");
  }

  await pool.execute(
    "UPDATE feedback_requests SET due_date = ?, status = 'requested' WHERE id = ?",
    [normalizedDueDate, requestId],
  );
  const feedbackRequest = await getFeedbackRequestById(requestId);
  await writeFeedbackAuditEvent({ requestId, actorId: requesterId, eventType: "due_date_changed", details: normalizedDueDate || "removed" });
  await notifyUser({
    userId: feedbackRequest.giverId,
    requestId,
    type: "feedback_due_date_changed",
    title: "Feedback due date changed",
    message: `${feedbackRequest.requesterName} changed the due date to ${normalizedDueDate || "no due date"}.`,
  });
  try {
    await sendFeedbackDueDateChangedNotification(feedbackRequest);
  } catch (error) {
    console.error("Mattermost due-date notification failed:", error.message);
  }
  return feedbackRequest;
}

const lifecycleActions = {
  start: {
    actorColumn: "giver_id",
    actorLabel: "selected feedback giver",
    from: ["requested", "overdue"],
    to: "in_progress",
  },
  decline: {
    actorColumn: "giver_id",
    actorLabel: "selected feedback giver",
    from: ["requested", "in_progress", "overdue"],
    to: "declined",
  },
  cancel: {
    actorColumn: "requester_id",
    actorLabel: "requester",
    from: ["requested", "in_progress", "overdue"],
    to: "cancelled",
  },
  acknowledge: {
    actorColumn: "receiver_id",
    actorLabel: "feedback receiver",
    from: "submitted",
    to: "acknowledged",
  },
  close: {
    actorColumn: "requester_or_receiver",
    actorLabel: "requester or feedback receiver",
    from: ["acknowledged", "follow_up_needed"],
    to: "closed",
  },
};

export async function performFeedbackRequestAction(
  requestId,
  actorId,
  action,
  acknowledgementComment = null,
  declineReason = null,
  alternateGiverId = null,
  moderationReason = null,
) {
  const rule = lifecycleActions[action];

  if (!rule && !["hide", "remove", "reopen"].includes(action)) {
    throw new ServiceError(400, "Unsupported feedback request action");
  }

  const pool = getDatabasePool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    if (["hide", "remove", "reopen"].includes(action)) {
      const [[actor]] = await connection.execute("SELECT role FROM users WHERE id = ?", [actorId]);
      if (!actor || !["admin", "hr", "sc"].includes(String(actor.role).toLowerCase())) throw new ServiceError(403, "Only SC, HR, or admin can moderate feedback records");
      const [[record]] = await connection.execute("SELECT id, status, removed_at AS removedAt FROM feedback_requests WHERE id = ? FOR UPDATE", [requestId]);
      if (!record) throw new ServiceError(404, "Feedback request not found");
      if (action === "hide") await connection.execute("UPDATE feedback_requests SET hidden_at = NOW(), hidden_by = ?, hidden_reason = ? WHERE id = ?", [actorId, moderationReason, requestId]);
      if (action === "remove") await connection.execute("UPDATE feedback_requests SET removed_at = NOW(), removed_by = ?, removed_reason = ? WHERE id = ?", [actorId, moderationReason, requestId]);
      if (action === "reopen") {
        if (record.status !== "closed") throw new ServiceError(409, "Only a closed feedback record can be reopened");
        await connection.execute("UPDATE feedback_requests SET status = 'acknowledged', hidden_at = NULL, removed_at = NULL WHERE id = ?", [requestId]);
      }
      const eventType = { hide: "record_hidden", remove: "record_removed", reopen: "record_reopened" }[action];
      await writeFeedbackAuditEvent({ requestId, actorId, eventType, details: moderationReason, connection });
      await connection.commit();
      return getFeedbackRequestById(requestId);
    }

    const [[request]] = await connection.execute(
      `SELECT id, requester_id AS requesterId, giver_id AS giverId, receiver_id AS receiverId, status
       FROM feedback_requests
       WHERE id = ?
       FOR UPDATE`,
      [requestId],
    );

    if (!request) {
      throw new ServiceError(404, "Feedback request not found");
    }

    const permitted = rule.actorColumn === "giver_id" ? actorId === request.giverId
      : rule.actorColumn === "receiver_id" ? actorId === request.receiverId
      : rule.actorColumn === "requester_or_receiver" ? [request.requesterId, request.receiverId].includes(actorId)
      : actorId === request.requesterId;
    if (!permitted) {
      throw new ServiceError(403, `Only the ${rule.actorLabel} can ${action} this request`);
    }

    const allowedCurrentStatuses = Array.isArray(rule.from) ? rule.from : [rule.from];
    if (!allowedCurrentStatuses.includes(request.status)) {
      throw new ServiceError(
        409,
        `This request is ${request.status}; it can only be ${action}d while it is ${allowedCurrentStatuses.join(" or ")}`,
      );
    }

    if (action === "close") {
      const [[openFollowUp]] = await connection.execute(
        `SELECT id FROM feedback_follow_ups
         WHERE request_id = ? AND status != 'completed'
         LIMIT 1`,
        [requestId],
      );
      if (openFollowUp) {
        throw new ServiceError(409, "Complete the open follow-up action before closing this request");
      }
      const [[openDiscussion]] = await connection.execute(
        `SELECT id FROM feedback_discussions
         WHERE request_id = ? AND parent_id IS NULL AND status = 'open'
         LIMIT 1`,
        [requestId],
      );
      if (openDiscussion) {
        throw new ServiceError(409, "Resolve the open clarification before closing this request");
      }
    }

    if (action === "acknowledge") {
      await connection.execute(
        `UPDATE feedback_requests
         SET status = ?, acknowledgement_comment = ?, acknowledged_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [rule.to, acknowledgementComment, requestId],
      );
    } else if (action === "decline") {
      if (alternateGiverId) {
        if ([request.requesterId, request.giverId].includes(alternateGiverId)) {
          throw new ServiceError(400, "The alternate reviewer must be someone else");
        }
        const [[alternateGiver]] = await connection.execute(
          "SELECT id FROM users WHERE id = ?",
          [alternateGiverId],
        );
        if (!alternateGiver) {
          throw new ServiceError(404, "Suggested alternate reviewer not found");
        }
      }
      await connection.execute(
        "UPDATE feedback_requests SET status = ?, decline_reason = ?, alternate_giver_id = ? WHERE id = ?",
        [rule.to, declineReason, alternateGiverId, requestId],
      );
    } else {
      await connection.execute(
        "UPDATE feedback_requests SET status = ? WHERE id = ?",
        [rule.to, requestId],
      );
    }

    await writeFeedbackAuditEvent({ requestId, actorId, eventType: action === "start" ? "feedback_started" : `request_${action}d`, details: action === "decline" ? declineReason : null, connection });

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const feedbackRequest = await getFeedbackRequestById(requestId);
  const recipients = action === "start"
    ? [feedbackRequest.requesterId, feedbackRequest.receiverId].filter((id) => id !== actorId)
    : action === "acknowledge"
      ? [feedbackRequest.giverId]
      : action === "decline"
        ? [feedbackRequest.requesterId]
        : action === "cancel"
          ? [feedbackRequest.giverId]
          : [feedbackRequest.requesterId, feedbackRequest.giverId, feedbackRequest.receiverId].filter((id) => id !== actorId);
  const actionTitle = { start: "Feedback started", acknowledge: "Feedback acknowledged", decline: "Feedback request declined", cancel: "Feedback request cancelled", close: "Feedback completed" }[action];
  await Promise.all([...new Set(recipients)].map((userId) => notifyUser({
    userId,
    requestId: feedbackRequest.id,
    type: `feedback_${action}`,
    title: actionTitle,
    message: action === "close" ? "This feedback process is complete." : action === "start" ? `${feedbackRequest.giverName} started preparing feedback.` : `${feedbackRequest.templateName} feedback request was ${action}d.`,
  })));
  return feedbackRequest;
}

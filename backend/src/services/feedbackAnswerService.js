import { getPrimaryFrontendOrigin } from "../config/frontendOrigin.js";
import { getDatabasePool } from "../db/connection.js";
import { sendFeedbackSubmittedNotification } from "../integrations/mattermost.js";
import { sendFeedbackEmail } from "../integrations/email.js";
import { getFeedbackRequestById } from "./feedbackRequestService.js";
import { ServiceError } from "./serviceError.js";
import { createInAppNotification } from "./notificationService.js";
import { writeFeedbackAuditEvent } from "./feedbackAuditService.js";
import { validateRespectfulFeedbackText } from "./feedbackContentPolicy.js";

function normalizeAnswers(answers, questions) {
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new ServiceError(400, "answers must be a non-empty array");
  }

  if (questions.length === 0) {
    throw new ServiceError(
      400,
      "The selected feedback template does not have questions",
    );
  }

  if (answers.length !== questions.length) {
    throw new ServiceError(
      400,
      "answers must include one answer for every template question",
    );
  }

  if (answers.every((answer) => typeof answer === "string")) {
    return answers.map((answer, index) => ({
      questionId: questions[index].id,
      answer: answer.trim(),
    }));
  }

  return answers.map((answer) => ({
    questionId: Number(answer?.questionId),
    answer: typeof answer?.answer === "string" ? answer.answer.trim() : "",
    rating: answer?.rating === null || answer?.rating === undefined || answer?.rating === "" ? null : Number(answer.rating),
  }));
}

function validateAnswers(normalizedAnswers, questions, requireText) {
  const validQuestionIds = new Set(questions.map((question) => question.id));
  const usedQuestionIds = new Set();
  for (const item of normalizedAnswers) {
    if (!validQuestionIds.has(item.questionId)) throw new ServiceError(400, "Every answer must reference a question from the selected template");
    if (usedQuestionIds.has(item.questionId)) throw new ServiceError(400, "A question can only be answered once");
    if (requireText && !item.answer) throw new ServiceError(400, "Answer text cannot be empty");
    validateRespectfulFeedbackText(item.answer);
    if (item.rating !== null && (!Number.isInteger(item.rating) || item.rating < 1 || item.rating > 5)) throw new ServiceError(400, "Rating must be between 1 and 5");
    usedQuestionIds.add(item.questionId);
  }
}

async function getQuestionsForRequest(executor, requestId, templateId) {
  const [snapshotQuestions] = await executor.execute(
    `SELECT template_question_id AS id
     FROM feedback_request_questions
     WHERE request_id = ?
     ORDER BY question_order, id`,
    [requestId],
  );
  if (snapshotQuestions.length) return snapshotQuestions;

  // Fallback for a request created before snapshots were introduced.
  const [templateQuestions] = await executor.execute(
    `SELECT id
     FROM template_questions
     WHERE template_id = ?
     ORDER BY question_order, id`,
    [templateId],
  );
  return templateQuestions;
}

export async function submitFeedbackAnswers(requestId, giverId, answers) {
  const pool = getDatabasePool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[request]] = await connection.execute(
      `SELECT id, giver_id AS giverId, template_id AS templateId, status
       FROM feedback_requests
       WHERE id = ?
       FOR UPDATE`,
      [requestId],
    );

    if (!request) {
      throw new ServiceError(404, "Feedback request not found");
    }

    if (giverId !== request.giverId) {
      throw new ServiceError(
        403,
        "Only the selected feedback giver can submit answers",
      );
    }

    if (!["requested", "in_progress", "overdue"].includes(request.status)) {
      throw new ServiceError(
        409,
        "Only an active feedback request can be submitted",
      );
    }

    const questions = await getQuestionsForRequest(connection, requestId, request.templateId);

    const normalizedAnswers = normalizeAnswers(answers, questions);
    validateAnswers(normalizedAnswers, questions, true);

    const [[existingAnswer]] = await connection.execute(
      "SELECT id FROM feedback_answers WHERE request_id = ? LIMIT 1",
      [requestId],
    );

    if (existingAnswer) {
      throw new ServiceError(409, "Feedback has already been submitted");
    }

    for (const item of normalizedAnswers) {
      await connection.execute(
        `INSERT INTO feedback_answers (request_id, question_id, answer, rating)
         VALUES (?, ?, ?, ?)`,
        [requestId, item.questionId, item.answer, item.rating],
      );
    }

    await connection.execute(
      `UPDATE feedback_requests
       SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [requestId],
    );
    await connection.execute("DELETE FROM feedback_answer_drafts WHERE request_id = ?", [requestId]);
    await writeFeedbackAuditEvent({ requestId, actorId: giverId, eventType: "feedback_submitted", connection });

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const feedbackRequest = await getFeedbackRequestById(requestId);
  const recipients = [...new Set([feedbackRequest.requesterId, feedbackRequest.receiverId])]
    .filter((userId) => userId !== giverId);
  await Promise.all(recipients.map((userId) => createInAppNotification({
    userId,
    requestId: feedbackRequest.id,
    type: "feedback_submitted",
    title: "Feedback received",
    message: `${feedbackRequest.isAnonymous ? "Anonymous feedback" : feedbackRequest.giverName} was submitted for ${feedbackRequest.templateName}.`,
  })));

  let notification = { sent: false, reason: "Mattermost notification was not sent" };
  try {
    notification = await sendFeedbackSubmittedNotification(feedbackRequest);
  } catch (error) {
    console.error("Mattermost notification failed:", error.message);
  }
  try {
    await sendFeedbackEmail({
      email: feedbackRequest.receiverEmail,
      name: feedbackRequest.receiverName,
      subject: "Feedback received",
      message: `${feedbackRequest.isAnonymous ? "Anonymous feedback" : `${feedbackRequest.giverName}'s feedback`} for ${feedbackRequest.templateName} is ready to review.`,
      actionUrl: getPrimaryFrontendOrigin(),
    });
  } catch (error) {
    console.error("Feedback submitted email failed:", error.message);
  }
  return { ...feedbackRequest, notification };
}

export async function saveFeedbackDraft(requestId, giverId, answers) {
  const pool = getDatabasePool();
  const [[request]] = await pool.execute(
    "SELECT giver_id AS giverId, template_id AS templateId, status FROM feedback_requests WHERE id = ?",
    [requestId],
  );
  if (!request) throw new ServiceError(404, "Feedback request not found");
  if (request.giverId !== giverId) throw new ServiceError(403, "Only the selected feedback giver can save a draft");
  if (!["requested", "in_progress", "overdue"].includes(request.status)) throw new ServiceError(409, "A draft can only be saved for an active request");
  const questions = await getQuestionsForRequest(pool, requestId, request.templateId);
  const normalizedAnswers = normalizeAnswers(answers, questions);
  validateAnswers(normalizedAnswers, questions, false);
  await pool.execute(
    `INSERT INTO feedback_answer_drafts (request_id, giver_id, answers)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE giver_id = VALUES(giver_id), answers = VALUES(answers), updated_at = CURRENT_TIMESTAMP`,
    [requestId, giverId, JSON.stringify(normalizedAnswers)],
  );
  await writeFeedbackAuditEvent({ requestId, actorId: giverId, eventType: "feedback_draft_saved" });
  return { answers: normalizedAnswers };
}

import { getDatabasePool } from "../db/connection.js";
import { sendFeedbackReportNotification } from "../integrations/mattermost.js";
import { sendSafetyReportEmail } from "../integrations/email.js";
import { ServiceError } from "./serviceError.js";
import { writeFeedbackAuditEvent } from "./feedbackAuditService.js";

// Safety reports are a confidential SC Team workflow, separate from ordinary
// feedback administration.
const reviewRoles = new Set(["sc"]);

async function requireReportAccess(pool, requestId, userId) {
  const [[request]] = await pool.execute(
    `SELECT request.id, request.status, request.is_anonymous AS isAnonymous, receiver.role AS receiverRole
     FROM feedback_requests AS request
     JOIN users AS receiver ON receiver.id = request.receiver_id
     WHERE request.id = ?
       AND request.receiver_id = ?`,
    [requestId, userId],
  );
  if (!request) throw new ServiceError(403, "Only the person who received this feedback can report it");
  if (!request.isAnonymous) {
    throw new ServiceError(403, "SC Report is available only for anonymous feedback");
  }
  if (!["submitted", "acknowledged", "closed"].includes(request.status)) {
    throw new ServiceError(409, "Feedback can be reported after it has been submitted");
  }
  return request;
}

export async function createFeedbackReport({ requestId, reporterId, reason, details }) {
  const pool = getDatabasePool();
  const request = await requireReportAccess(pool, requestId, reporterId);
  const requiresDualReview = String(request.receiverRole).toLowerCase() === "sc";
  try {
    const [result] = await pool.execute(
      `INSERT INTO feedback_reports (request_id, reporter_id, reason, details, requires_dual_review)
       VALUES (?, ?, ?, ?, ?)`,
      [requestId, reporterId, reason, details || null, requiresDualReview],
    );
    const report = { id: result.insertId, requestId, reason, details: details || null, status: "open", requiresDualReview };
    await writeFeedbackAuditEvent({ requestId, actorId: reporterId, eventType: "feedback_reported", details: reason });
    try {
      const [scTeamMembers] = await pool.execute(
        "SELECT email FROM users WHERE role = 'sc' AND is_active = TRUE",
      );
      await Promise.all([
        sendFeedbackReportNotification(report, scTeamMembers.map((member) => member.email)),
        sendSafetyReportEmail(report),
      ]);
    } catch (error) {
      // The report is already safely stored. A temporary notification problem
      // must not prevent a person from reporting harmful feedback.
      console.error("SC Team notification failed:", error.message);
    }
    return report;
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      throw new ServiceError(409, "You have already reported this feedback. It is being reviewed.");
    }
    throw error;
  }
}

async function getReviewer(pool, reviewerId) {
  const [[reviewer]] = await pool.execute("SELECT id, role, is_active AS isActive FROM users WHERE id = ?", [reviewerId]);
  if (!reviewer?.isActive) throw new ServiceError(403, "Only active reviewers can access confidential feedback reports");
  return reviewer;
}

export async function getFeedbackReports(reviewerId) {
  const pool = getDatabasePool();
  const reviewer = await getReviewer(pool, reviewerId);
  const isSC = reviewRoles.has(String(reviewer.role).toLowerCase());
  const [reports] = await pool.execute(
    `SELECT report.id, report.request_id AS requestId, report.reason, report.details,
       report.status, report.created_at AS createdAt, reporter.name AS reporterName,
       request.status AS requestStatus, request.giver_id AS giverId, request.receiver_id AS receiverId,
       template.name AS templateName, report.requires_dual_review AS requiresDualReview,
       report.sc_reviewer_id AS scReviewerId, report.internal_reviewer_id AS internalReviewerId,
       report.proposed_outcome AS proposedOutcome, report.sc_proposed_at AS scProposedAt,
       report.internal_decision AS internalDecision, report.internal_reviewed_at AS internalReviewedAt,
       report.resolution_note AS resolutionNote
     FROM feedback_reports AS report
     JOIN users AS reporter ON reporter.id = report.reporter_id
     JOIN feedback_requests AS request ON request.id = report.request_id
     JOIN feedback_templates AS template ON template.id = request.template_id
     ${isSC ? "" : "WHERE report.internal_reviewer_id = ?"}
     ORDER BY report.status = 'open' DESC, report.created_at DESC`,
    isSC ? [] : [reviewerId],
  );
  return reports;
}

export async function assignSpecialReportReviewers({ reportId, scReviewerId, internalReviewerId }) {
  const pool = getDatabasePool();
  const scReviewer = await getReviewer(pool, scReviewerId);
  if (!reviewRoles.has(String(scReviewer.role).toLowerCase())) throw new ServiceError(403, "An SC Team member must lead this review");
  const [[report]] = await pool.execute(
    `SELECT report.request_id AS requestId, report.reporter_id AS reporterId, report.requires_dual_review AS requiresDualReview,
       report.sc_reviewer_id AS scReviewerId, request.giver_id AS giverId, request.receiver_id AS receiverId
     FROM feedback_reports AS report JOIN feedback_requests AS request ON request.id = report.request_id WHERE report.id = ?`, [reportId],
  );
  if (!report) throw new ServiceError(404, "Feedback report not found");
  if (!report.requiresDualReview) throw new ServiceError(400, "This report follows the normal SC Team process");
  if (report.scReviewerId) throw new ServiceError(409, "Reviewers have already been assigned");
  if (Number(report.receiverId) === Number(scReviewerId)) throw new ServiceError(403, "The feedback receiver cannot review their own report");
  const internalReviewer = await getReviewer(pool, internalReviewerId);
  if (reviewRoles.has(String(internalReviewer.role).toLowerCase()) || [report.giverId, report.receiverId].some((id) => Number(id) === Number(internalReviewerId))) {
    throw new ServiceError(400, "Choose an active Justuju member who is not an SC member, feedback giver, or receiver");
  }
  await pool.execute("UPDATE feedback_reports SET sc_reviewer_id = ?, internal_reviewer_id = ?, assigned_at = CURRENT_TIMESTAMP, status = 'in_review' WHERE id = ?", [scReviewerId, internalReviewerId, reportId]);
  await writeFeedbackAuditEvent({ requestId: report.requestId, actorId: scReviewerId, eventType: "special_report_reviewers_assigned", details: JSON.stringify({ internalReviewerId }) });
}

export async function reviewFeedbackReport({ reportId, reviewerId, status, resolutionNote }) {
  const pool = getDatabasePool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const reviewer = await getReviewer(connection, reviewerId);
    const isSC = reviewRoles.has(String(reviewer.role).toLowerCase());
    const [[report]] = await connection.execute(
      `SELECT request_id AS requestId, status, requires_dual_review AS requiresDualReview,
         sc_reviewer_id AS scReviewerId, internal_reviewer_id AS internalReviewerId,
         proposed_outcome AS proposedOutcome
       FROM feedback_reports WHERE id = ? FOR UPDATE`,
      [reportId],
    );
    if (!report) throw new ServiceError(404, "Feedback report not found");

    if (!report.requiresDualReview) {
      if (!isSC) throw new ServiceError(403, "Only an SC Team member can review this report");
      if (!["open", "in_review"].includes(report.status) || !["resolved", "dismissed"].includes(status)) {
        throw new ServiceError(409, "This report is no longer awaiting a decision");
      }
      await connection.execute(
        `UPDATE feedback_reports
         SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, resolution_note = ?
         WHERE id = ?`,
        [status, reviewerId, resolutionNote || null, reportId],
      );
      await writeFeedbackAuditEvent({ requestId: report.requestId, actorId: reviewerId, eventType: `report_${status}`, connection });
      await connection.commit();
      return { status };
    }

    if (report.status !== "in_review") throw new ServiceError(409, "This special report is no longer awaiting review");

    if (Number(report.scReviewerId) === Number(reviewerId)) {
      if (!["resolved", "dismissed"].includes(status)) throw new ServiceError(400, "The SC reviewer must propose resolve or dismiss");
      if (report.proposedOutcome) throw new ServiceError(409, "The SC reviewer has already proposed an outcome");
      await connection.execute(
        `UPDATE feedback_reports
         SET proposed_outcome = ?, sc_proposed_at = CURRENT_TIMESTAMP, resolution_note = ?
         WHERE id = ?`,
        [status, resolutionNote || null, reportId],
      );
      await writeFeedbackAuditEvent({ requestId: report.requestId, actorId: reviewerId, eventType: `special_report_${status}_proposed`, connection });
      await connection.commit();
      return { status: "awaiting_internal_approval", proposedOutcome: status };
    }

    if (Number(report.internalReviewerId) !== Number(reviewerId)) throw new ServiceError(403, "You are not assigned to review this report");
    if (!report.proposedOutcome) throw new ServiceError(409, "Wait for the SC reviewer to propose an outcome first");

    if (status === "approved") {
      await connection.execute(
        `UPDATE feedback_reports
         SET status = ?, internal_decision = 'approved', internal_reviewed_at = CURRENT_TIMESTAMP,
             reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [report.proposedOutcome, reviewerId, reportId],
      );
      await writeFeedbackAuditEvent({ requestId: report.requestId, actorId: reviewerId, eventType: `special_report_${report.proposedOutcome}_approved`, connection });
      await connection.commit();
      return { status: report.proposedOutcome };
    }

    if (status === "disagreed") {
      await connection.execute(
        `UPDATE feedback_reports
         SET status = 'needs_escalation', internal_decision = 'disagreed', internal_reviewed_at = CURRENT_TIMESTAMP,
             reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [reviewerId, reportId],
      );
      await writeFeedbackAuditEvent({ requestId: report.requestId, actorId: reviewerId, eventType: "special_report_disagreed_needs_escalation", connection });
      await connection.commit();
      return { status: "needs_escalation" };
    }

    throw new ServiceError(400, "Choose approve or disagree with the SC proposal");
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

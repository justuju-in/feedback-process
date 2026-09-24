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
    `SELECT request.id, request.status
     FROM feedback_requests AS request
     WHERE request.id = ?
       AND request.receiver_id = ?`,
    [requestId, userId],
  );
  if (!request) throw new ServiceError(403, "Only the person who received this feedback can report it");
  if (!["submitted", "acknowledged", "closed"].includes(request.status)) {
    throw new ServiceError(409, "Feedback can be reported after it has been submitted");
  }
}

export async function createFeedbackReport({ requestId, reporterId, reason, details }) {
  const pool = getDatabasePool();
  await requireReportAccess(pool, requestId, reporterId);
  try {
    const [result] = await pool.execute(
      `INSERT INTO feedback_reports (request_id, reporter_id, reason, details)
       VALUES (?, ?, ?, ?)`,
      [requestId, reporterId, reason, details || null],
    );
    const report = { id: result.insertId, requestId, reason, details: details || null, status: "open" };
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

async function requireReviewer(pool, reviewerId) {
  const [[reviewer]] = await pool.execute("SELECT role FROM users WHERE id = ?", [reviewerId]);
  if (!reviewer || !reviewRoles.has(String(reviewer.role).toLowerCase())) {
    throw new ServiceError(403, "Only the SC Team can access confidential feedback reports");
  }
}

export async function getFeedbackReports(reviewerId) {
  const pool = getDatabasePool();
  await requireReviewer(pool, reviewerId);
  const [reports] = await pool.execute(
    `SELECT report.id, report.request_id AS requestId, report.reason, report.details,
       report.status, report.created_at AS createdAt, reporter.name AS reporterName,
       request.status AS requestStatus, template.name AS templateName
     FROM feedback_reports AS report
     JOIN users AS reporter ON reporter.id = report.reporter_id
     JOIN feedback_requests AS request ON request.id = report.request_id
     JOIN feedback_templates AS template ON template.id = request.template_id
     ORDER BY report.status = 'open' DESC, report.created_at DESC`,
  );
  return reports;
}

export async function reviewFeedbackReport({ reportId, reviewerId, status, resolutionNote }) {
  const pool = getDatabasePool();
  await requireReviewer(pool, reviewerId);
  const [result] = await pool.execute(
    `UPDATE feedback_reports
     SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, resolution_note = ?
     WHERE id = ?`,
    [status, reviewerId, resolutionNote || null, reportId],
  );
  if (!result.affectedRows) throw new ServiceError(404, "Feedback report not found");
  const [[report]] = await pool.execute("SELECT request_id AS requestId FROM feedback_reports WHERE id = ?", [reportId]);
  await writeFeedbackAuditEvent({ requestId: report.requestId, actorId: reviewerId, eventType: `report_${status}` });
}

import { getDatabasePool } from "../db/connection.js";
import { ServiceError } from "./serviceError.js";

const reviewerRoles = new Set(["admin"]);

export async function getFeedbackAnalytics(actorId) {
  const pool = getDatabasePool();
  const [[actor]] = await pool.execute("SELECT role FROM users WHERE id = ?", [actorId]);
  if (!actor || !reviewerRoles.has(String(actor.role).toLowerCase())) {
    throw new ServiceError(403, "Only an admin can view team analytics");
  }

  const [[summary]] = await pool.execute(
    `SELECT COUNT(*) AS totalRequests,
       SUM(status = 'closed') AS completedRequests,
       SUM(status IN ('requested', 'in_progress', 'overdue')) AS openRequests,
       AVG(CASE WHEN submitted_at IS NOT NULL THEN TIMESTAMPDIFF(HOUR, created_at, submitted_at) END) AS averageResponseHours
     FROM feedback_requests`,
  );
  const [byTemplate] = await pool.execute(
    `SELECT template.name AS templateName, COUNT(*) AS requestCount,
       SUM(request.status = 'closed') AS completedRequests
     FROM feedback_requests AS request
     JOIN feedback_templates AS template ON template.id = request.template_id
     GROUP BY template.id, template.name
     ORDER BY requestCount DESC, template.name ASC`,
  );
  const [byStatus] = await pool.execute(
    `SELECT status AS label, COUNT(*) AS requestCount
     FROM feedback_requests GROUP BY status ORDER BY requestCount DESC, status ASC`,
  );
  const totalRequests = Number(summary.totalRequests || 0);
  const completedRequests = Number(summary.completedRequests || 0);
  return {
    summary: {
      totalRequests,
      completedRequests,
      openRequests: Number(summary.openRequests || 0),
      completionRate: totalRequests ? Math.round((completedRequests / totalRequests) * 100) : 0,
      averageResponseHours: summary.averageResponseHours === null ? null : Math.round(Number(summary.averageResponseHours) * 10) / 10,
    },
    byTemplate: byTemplate.map((row) => ({ ...row, requestCount: Number(row.requestCount), completedRequests: Number(row.completedRequests) })),
    byStatus: byStatus.map((row) => ({ status: row.label, requestCount: Number(row.requestCount) })),
  };
}

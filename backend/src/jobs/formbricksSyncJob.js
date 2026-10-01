import { getDatabasePool } from "../db/connection.js";
import { formbricksConfig } from "../integrations/formbricks.js";
import { syncFormbricksSession } from "../services/formbricksService.js";

export function startFormbricksSyncJob() {
  if (!formbricksConfig().configured) return;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const [requests] = await getDatabasePool().execute(`SELECT request.id, request.giver_id AS giverId
        FROM formbricks_sessions AS session JOIN feedback_requests AS request ON request.id = session.request_id
        WHERE session.completed = FALSE AND request.status IN ('requested', 'in_progress', 'overdue')
        AND request.hidden_at IS NULL AND request.removed_at IS NULL
        ORDER BY COALESCE(session.last_checked_at, session.created_at) ASC LIMIT 25`);
      for (const request of requests) {
        try { await syncFormbricksSession(request.id, request.giverId); }
        catch {
          // Move failed invitations to the end of the queue so one broken survey cannot starve others.
          await getDatabasePool().execute("UPDATE formbricks_sessions SET last_checked_at = CURRENT_TIMESTAMP WHERE request_id = ? AND completed = FALSE", [request.id]);
          console.error("Formbricks background sync failed; retry from the request to see connection details");
        }
      }
    } catch { console.error("Formbricks background sync could not run"); }
    finally { running = false; }
  }, 60000);
  timer.unref();
}

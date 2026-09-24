import { getDatabasePool } from "../db/connection.js";

// Store only the event and time. The blocked text itself is intentionally never
// written to the audit database.
export async function writeFeedbackPolicyEvent({ actorId, requestId = null, eventType }) {
  await getDatabasePool().execute(
    `INSERT INTO feedback_policy_audit_log (actor_id, request_id, event_type)
     VALUES (?, ?, ?)`,
    [actorId, requestId, eventType],
  );
}

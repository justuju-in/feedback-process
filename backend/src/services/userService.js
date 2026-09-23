import { getDatabasePool } from "../db/connection.js";
import { ServiceError } from "./serviceError.js";
import { createInAppNotification } from "./notificationService.js";

export async function getAllUsers() {
  const pool = getDatabasePool();
  const [users] = await pool.query(
    `SELECT id, name, email, role, is_active AS isActive, created_at AS createdAt
     FROM users
     ORDER BY id`,
  );

  return users;
}

// Account access and role changes are administrative actions. SC Team members
// review confidential reports but must not be able to browse or change users.
const adminRoles = new Set(["admin"]);
// Feedback Process is an internal Justuju workspace. External collaborators
// are intentionally not an assignable role.
const assignableRoles = new Set(["member", "mentor", "lead", "manager", "sc", "hr", "admin"]);
const openStatuses = ["requested", "in_progress", "overdue", "submitted", "acknowledged", "follow_up_needed"];

/**
 * Deactivation is deliberately conservative: historical feedback stays intact,
 * while every open request involving the departing person stops immediately.
 * A request waiting for them as giver is declined; every other open request is
 * cancelled. The requester can then create a fresh request with a replacement.
 */
export async function setUserActive({ userId, actorId, isActive }) {
  const pool = getDatabasePool();
  const connection = await pool.getConnection();
  let affectedRequests = [];

  try {
    await connection.beginTransaction();
    const [[actor]] = await connection.execute("SELECT role FROM users WHERE id = ?", [actorId]);
    if (!actor || !adminRoles.has(String(actor.role).toLowerCase())) {
      throw new ServiceError(403, "Only SC Team, HR, or an admin can change account status");
    }
    if (Number(userId) === Number(actorId) && !isActive) {
      throw new ServiceError(400, "You cannot deactivate your own account");
    }

    const [[user]] = await connection.execute(
      "SELECT id, name, email, role, is_active AS isActive FROM users WHERE id = ? FOR UPDATE",
      [userId],
    );
    if (!user) throw new ServiceError(404, "User not found");

    await connection.execute("UPDATE users SET is_active = ? WHERE id = ?", [isActive, userId]);

    if (!isActive) {
      await connection.execute("UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL", [userId]);
      await connection.execute(
        "UPDATE feedback_request_schedules SET is_active = FALSE WHERE is_active = TRUE AND (requester_id = ? OR giver_id = ? OR receiver_id = ?)",
        [userId, userId, userId],
      );
      const placeholders = openStatuses.map(() => "?").join(", ");
      const [requests] = await connection.execute(
        `SELECT id, requester_id AS requesterId, giver_id AS giverId, receiver_id AS receiverId, status
         FROM feedback_requests
         WHERE (requester_id = ? OR giver_id = ? OR receiver_id = ?)
           AND status IN (${placeholders})
         FOR UPDATE`,
        [userId, userId, userId, ...openStatuses],
      );
      affectedRequests = requests;

      for (const request of requests) {
        const status = "cancelled";
        const reason = "This feedback request was cancelled because a participant account was deactivated.";
        await connection.execute(
          "UPDATE feedback_requests SET status = ?, decline_reason = ? WHERE id = ?",
          [status, reason, request.id],
        );
        await connection.execute(
          `INSERT INTO feedback_audit_log (request_id, actor_id, event_type, details)
           VALUES (?, ?, 'participant_deactivated', ?)`,
          [request.id, actorId, reason],
        );
      }
    }

    await connection.commit();
    const result = { ...user, isActive: Boolean(isActive), affectedRequestCount: affectedRequests.length };

    if (!isActive) {
      const notifiedUserIds = new Set();
      for (const request of affectedRequests) {
        for (const participantId of [request.requesterId, request.giverId, request.receiverId]) {
          if (Number(participantId) !== Number(userId)) notifiedUserIds.add(participantId);
        }
      }
      await Promise.all([...notifiedUserIds].map((participantId) => createInAppNotification({
        userId: participantId,
        type: "participant_deactivated",
        title: "Feedback request updated",
        message: `${user.name}'s account was deactivated, so an open feedback request was cancelled or needs a replacement giver.`,
      }).catch((error) => console.error("Account deactivation notification failed:", error.message))));
    }
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function setUserRole({ userId, actorId, role }) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (!assignableRoles.has(normalizedRole)) throw new ServiceError(400, "Choose a valid role");
  const pool = getDatabasePool();
  const [[actor]] = await pool.execute("SELECT role FROM users WHERE id = ?", [actorId]);
  if (!actor || !adminRoles.has(String(actor.role).toLowerCase())) {
    throw new ServiceError(403, "Only SC Team, HR, or an admin can change roles");
  }
  if (Number(userId) === Number(actorId) && !adminRoles.has(normalizedRole)) {
    throw new ServiceError(400, "You cannot remove your own reviewer access");
  }
  const [result] = await pool.execute("UPDATE users SET role = ? WHERE id = ?", [normalizedRole, userId]);
  if (!result.affectedRows) throw new ServiceError(404, "User not found");
  const [[user]] = await pool.execute("SELECT id, name, email, role, is_active AS isActive FROM users WHERE id = ?", [userId]);
  return user;
}

import { getDatabasePool } from "../db/connection.js";
import { sendFeedbackRequestNotification } from "../integrations/mattermost.js";
import { getFeedbackRequestById } from "./feedbackRequestService.js";
import { ServiceError } from "./serviceError.js";
import { createInAppNotification } from "./notificationService.js";

const allowedFrequencies = new Set(["once", "monthly", "quarterly"]);
const allowedPurposes = new Set(["growth", "project_improvement", "one_on_one", "appraisal"]);
const allowedVisibilities = new Set(["private", "mentor_lead", "selected_group"]);

function today() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDate(value, label, { allowEmpty = false } = {}) {
  if (allowEmpty && (value === undefined || value === null || value === "")) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ServiceError(400, `${label} must use YYYY-MM-DD format`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ServiceError(400, `${label} must be a valid calendar date`);
  }
  return value;
}

function nextDate(date, frequency) {
  if (frequency === "once") return null;
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1 + (frequency === "quarterly" ? 3 : 1), day));
  return result.toISOString().slice(0, 10);
}

function normalizeSchedule(payload, requesterId) {
  const giverId = Number(payload.giverId);
  const receiverId = Number(payload.receiverId);
  const templateId = Number(payload.templateId);
  const dueInDays = Number(payload.dueInDays);
  const frequency = payload.frequency;
  const scheduledTime = payload.scheduledTime || null;
  const startDate = normalizeDate(payload.startDate, "startDate");
  const endDate = normalizeDate(payload.endDate, "endDate", { allowEmpty: true });
  const viewerIds = Array.isArray(payload.viewerIds) ? [...new Set(payload.viewerIds.map(Number))] : [];
  const visibility = payload.visibility || "private";

  if (![giverId, receiverId, templateId].every((value) => Number.isInteger(value) && value > 0)) {
    throw new ServiceError(400, "giverId, receiverId and templateId must be positive integers");
  }
  if (giverId === requesterId) throw new ServiceError(400, "You cannot request feedback from yourself");
  if (!allowedFrequencies.has(frequency)) throw new ServiceError(400, "frequency must be once, monthly, or quarterly");
  if (scheduledTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduledTime)) throw new ServiceError(400, "scheduledTime must use HH:MM format");
  if (frequency === "once" && !scheduledTime) throw new ServiceError(400, "Choose a time for a one-time scheduled request");
  if (!Number.isInteger(dueInDays) || dueInDays < 1 || dueInDays > 90) throw new ServiceError(400, "dueInDays must be between 1 and 90");
  if (startDate < today()) throw new ServiceError(400, "startDate cannot be in the past");
  if (endDate && endDate < startDate) throw new ServiceError(400, "endDate cannot be before startDate");
  if (!allowedVisibilities.has(visibility)) throw new ServiceError(400, "Invalid visibility");
  if (payload.purpose && !allowedPurposes.has(payload.purpose)) throw new ServiceError(400, "Invalid feedback purpose");
  if (visibility === "private" && viewerIds.length) throw new ServiceError(400, "Private feedback cannot have extra viewers");
  if (visibility === "mentor_lead" && viewerIds.length !== 1) throw new ServiceError(400, "Select one mentor or lead viewer");
  if (visibility === "selected_group" && !viewerIds.length) throw new ServiceError(400, "Select at least one group viewer");
  if (viewerIds.some((id) => [requesterId, giverId, receiverId].includes(id))) {
    throw new ServiceError(400, "Requester, feedback giver, and receiver already have access");
  }

  return { giverId, receiverId, templateId, dueInDays, frequency, scheduledTime, startDate, endDate, viewerIds, visibility, purpose: payload.purpose || null, message: typeof payload.message === "string" ? payload.message.trim().slice(0, 500) : null };
}

async function requireExisting(pool, table, id, label) {
  const [[item]] = await pool.execute(`SELECT id FROM ${table} WHERE id = ?`, [id]);
  if (!item) throw new ServiceError(404, `${label} not found`);
}

export async function createFeedbackSchedule(payload, requesterId) {
  const schedule = normalizeSchedule(payload, requesterId);
  const pool = getDatabasePool();
  await Promise.all([
    requireExisting(pool, "users", schedule.giverId, "Feedback giver"),
    requireExisting(pool, "users", schedule.receiverId, "Feedback receiver"),
    requireExisting(pool, "feedback_templates", schedule.templateId, "Feedback template"),
    ...schedule.viewerIds.map((id) => requireExisting(pool, "users", id, "Selected viewer")),
  ]);

  const connection = await pool.getConnection();
  let scheduleId;
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `INSERT INTO feedback_request_schedules
       (requester_id, giver_id, receiver_id, template_id, message, purpose, visibility, frequency, scheduled_time, due_in_days, next_run_date, end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [requesterId, schedule.giverId, schedule.receiverId, schedule.templateId, schedule.message, schedule.purpose, schedule.visibility, schedule.frequency, schedule.scheduledTime, schedule.dueInDays, schedule.startDate, schedule.endDate],
    );
    scheduleId = result.insertId;
    for (const viewerId of schedule.viewerIds) {
      await connection.execute("INSERT INTO feedback_schedule_viewers (schedule_id, user_id) VALUES (?, ?)", [scheduleId, viewerId]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  // A schedule created for today should create the first request immediately.
  await runDueFeedbackSchedules();
  return getFeedbackScheduleById(scheduleId, requesterId);
}

export async function getFeedbackSchedules(requesterId) {
  const pool = getDatabasePool();
  const [schedules] = await pool.execute(
    `SELECT schedule.id, schedule.frequency, schedule.scheduled_time AS scheduledTime, schedule.due_in_days AS dueInDays,
       schedule.next_run_date AS nextRunDate, schedule.end_date AS endDate, schedule.is_active AS isActive,
       giver.name AS giverName, receiver.name AS receiverName, template.name AS templateName
     FROM feedback_request_schedules AS schedule
     JOIN users AS giver ON giver.id = schedule.giver_id
     JOIN users AS receiver ON receiver.id = schedule.receiver_id
     JOIN feedback_templates AS template ON template.id = schedule.template_id
     WHERE schedule.requester_id = ?
     ORDER BY schedule.is_active DESC, schedule.next_run_date ASC, schedule.id DESC`,
    [requesterId],
  );
  return schedules;
}

export async function updateFeedbackScheduleStatus(scheduleId, requesterId, isActive) {
  if (typeof isActive !== "boolean") throw new ServiceError(400, "isActive must be true or false");
  const pool = getDatabasePool();
  const [result] = await pool.execute(
    "UPDATE feedback_request_schedules SET is_active = ? WHERE id = ? AND requester_id = ?",
    [isActive, scheduleId, requesterId],
  );
  if (!result.affectedRows) throw new ServiceError(404, "Feedback schedule not found");
  return getFeedbackScheduleById(scheduleId, requesterId);
}

async function getFeedbackScheduleById(scheduleId, requesterId) {
  const schedules = await getFeedbackSchedules(requesterId);
  const schedule = schedules.find((item) => item.id === scheduleId);
  if (!schedule) throw new ServiceError(404, "Feedback schedule not found");
  return schedule;
}

export async function runDueFeedbackSchedules() {
  const pool = getDatabasePool();
  const [dueSchedules] = await pool.execute(
    "SELECT id FROM feedback_request_schedules WHERE is_active = TRUE AND (next_run_date < CURRENT_DATE() OR (next_run_date = CURRENT_DATE() AND (scheduled_time IS NULL OR scheduled_time <= CURRENT_TIME()))) ORDER BY next_run_date, id",
  );
  let created = 0;

  for (const { id } of dueSchedules) {
    const connection = await pool.getConnection();
    let requestId = null;
    try {
      await connection.beginTransaction();
      const [[schedule]] = await connection.execute(
        `SELECT * FROM feedback_request_schedules WHERE id = ? FOR UPDATE`,
        [id],
      );
      if (!schedule || !schedule.is_active || schedule.next_run_date > today() || (schedule.next_run_date === today() && schedule.scheduled_time && String(schedule.scheduled_time).slice(0, 5) > new Date().toTimeString().slice(0, 5))) {
        await connection.rollback();
        continue;
      }
      if (schedule.end_date && schedule.next_run_date > schedule.end_date) {
        await connection.execute("UPDATE feedback_request_schedules SET is_active = FALSE WHERE id = ?", [id]);
        await connection.commit();
        continue;
      }
      const [[openRequest]] = await connection.execute(
        `SELECT id FROM feedback_requests
         WHERE requester_id = ?
           AND giver_id = ?
           AND receiver_id = ?
           AND template_id = ?
           AND status IN ('requested', 'in_progress', 'overdue', 'submitted', 'acknowledged', 'follow_up_needed')
         LIMIT 1`,
        [schedule.requester_id, schedule.giver_id, schedule.receiver_id, schedule.template_id],
      );

      if (!openRequest) {
        const [inserted] = await connection.execute(
          `INSERT INTO feedback_requests
           (requester_id, giver_id, receiver_id, template_id, message, due_date, purpose, visibility, status)
           VALUES (?, ?, ?, ?, ?, DATE_ADD(CURRENT_DATE(), INTERVAL ? DAY), ?, ?, 'requested')`,
          [schedule.requester_id, schedule.giver_id, schedule.receiver_id, schedule.template_id, schedule.message, schedule.due_in_days, schedule.purpose, schedule.visibility],
        );
        requestId = inserted.insertId;
        const [viewers] = await connection.execute("SELECT user_id AS userId FROM feedback_schedule_viewers WHERE schedule_id = ?", [id]);
        for (const viewer of viewers) {
          await connection.execute("INSERT INTO feedback_request_viewers (request_id, user_id) VALUES (?, ?)", [requestId, viewer.userId]);
        }
      }
      const followingDate = nextDate(String(schedule.next_run_date).slice(0, 10), schedule.frequency);
      const isFinished = schedule.frequency === "once" || (schedule.end_date && followingDate > String(schedule.end_date).slice(0, 10));
      if (isFinished) {
        await connection.execute("UPDATE feedback_request_schedules SET is_active = FALSE WHERE id = ?", [id]);
      } else {
        await connection.execute(
          "UPDATE feedback_request_schedules SET next_run_date = ?, is_active = TRUE WHERE id = ?",
          [followingDate, id],
        );
      }
      await connection.commit();
      created += 1;
    } catch (error) {
      await connection.rollback();
      console.error("Scheduled feedback request failed:", error.message);
    } finally {
      connection.release();
    }
    if (requestId) {
      try {
        const feedbackRequest = await getFeedbackRequestById(requestId);
        await createInAppNotification({
          userId: feedbackRequest.giverId,
          requestId: feedbackRequest.id,
          type: "scheduled_feedback_request",
          title: "Scheduled feedback request",
          message: `${feedbackRequest.requesterName} scheduled ${feedbackRequest.templateName} feedback from you.`,
        });
        await sendFeedbackRequestNotification(feedbackRequest);
      } catch (error) {
        console.error("Scheduled feedback notification failed:", error.message);
      }
    }
  }
  return created;
}

import { submitFeedbackAnswers as saveFeedbackAnswers, saveFeedbackDraft as saveFeedbackDraftInDatabase } from "../services/feedbackAnswerService.js";
import {
  createFeedbackRequest as createFeedbackRequestInDatabase,
  getFeedbackRequestById as getFeedbackRequestByIdFromDatabase,
  getRequestsForUser as getRequestsForUserFromDatabase,
  getRequestsForGiver as getRequestsForGiverFromDatabase,
  getRequestsForReceiver as getRequestsForReceiverFromDatabase,
  getRequestsForRequester as getRequestsForRequesterFromDatabase,
  getRequestsVisibleTo as getRequestsVisibleToFromDatabase,
  performFeedbackRequestAction as performFeedbackRequestActionInDatabase,
  createFollowUp as createFollowUpInDatabase,
  createFeedbackDiscussion as createFeedbackDiscussionInDatabase,
  updateFollowUp as updateFollowUpInDatabase,
  updateFeedbackRequestDueDate as updateFeedbackRequestDueDateInDatabase,
  redactFeedbackRequestForViewer,
  addFeedbackAttachment as addFeedbackAttachmentInDatabase,
} from "../services/feedbackRequestService.js";
import { respondWithError } from "./respondWithError.js";
import { writeFeedbackAuditEvent } from "../services/feedbackAuditService.js";
import {
  createFeedbackSchedule as createFeedbackScheduleInDatabase,
  getFeedbackSchedules as getFeedbackSchedulesFromDatabase,
  updateFeedbackScheduleStatus as updateFeedbackScheduleStatusInDatabase,
} from "../services/feedbackScheduleService.js";

const allowedActions = ["start", "decline", "cancel", "acknowledge", "close", "hide", "remove", "reopen"];

function parsePositiveInteger(value) {
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : null;
}

const allowedListScopes = new Set(["all", "waiting", "sent", "received", "active", "history"]);
const allowedListStatuses = new Set(["requested", "in_progress", "overdue", "submitted", "acknowledged", "follow_up_needed", "closed", "cancelled", "declined"]);

export async function getFeedbackRequests(req, res) {
  const scope = String(req.query.scope || "all").toLowerCase();
  const status = String(req.query.status || "").toLowerCase();
  const search = String(req.query.search || "");
  const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;
  const page = hasPagination ? parsePositiveInteger(req.query.page || 1) : null;
  const limit = hasPagination ? parsePositiveInteger(req.query.limit || 25) : null;

  if (!allowedListScopes.has(scope)) {
    return res.status(400).json({ message: "Choose a valid request scope" });
  }
  if (status && !allowedListStatuses.has(status)) {
    return res.status(400).json({ message: "Choose a valid request status" });
  }
  if (search.length > 100) {
    return res.status(400).json({ message: "Search must be 100 characters or fewer" });
  }
  if (hasPagination && (!page || !limit || limit > 100)) {
    return res.status(400).json({ message: "Pagination requires a positive page and a limit between 1 and 100" });
  }

  try {
    const result = await getRequestsForUserFromDatabase({
      userId: req.auth.user.id,
      role: req.auth.user.role,
      search,
      status,
      scope,
      page,
      limit,
    });
    return res.status(200).json({ feedbackRequests: result.requests, pagination: result.pagination });
  } catch (error) {
    return respondWithError(res, error);
  }
}

export async function createFeedbackRequest(req, res) {
  const requesterId = req.auth.user.id;
  const giverId = parsePositiveInteger(req.body.giverId);
  const templateId = parsePositiveInteger(req.body.templateId);
  const { message, dueDate, purpose, visibility, viewerIds, isAnonymous } = req.body;

  if (req.auth.user.role === "external") {
    return res.status(403).json({ message: "External collaborators can only respond to feedback sent to them." });
  }
  if (!giverId || !templateId) {
    return res.status(400).json({
      message: "giverId and templateId must be positive integers",
    });
  }

  try {
    const feedbackRequest = await createFeedbackRequestInDatabase({
      requesterId,
      giverId,
      receiverId: requesterId,
      templateId,
      message,
      dueDate,
      purpose,
      visibility,
      viewerIds,
      isAnonymous,
    });

    return res.status(201).json({
      message: "Feedback request created",
      feedbackRequest,
    });
  } catch (error) {
    return respondWithError(res, error);
  }
}

export async function createFeedbackSchedule(req, res) {
  try {
    if (req.auth.user.role === "external") return res.status(403).json({ message: "External collaborators cannot create feedback schedules." });
    req.body.receiverId = req.auth.user.id;
    const schedule = await createFeedbackScheduleInDatabase(req.body, req.auth.user.id);
    return res.status(201).json({ message: "Recurring feedback schedule saved", schedule });
  } catch (error) {
    return respondWithError(res, error);
  }
}

export async function getFeedbackSchedules(req, res) {
  try {
    const schedules = await getFeedbackSchedulesFromDatabase(req.auth.user.id);
    return res.status(200).json({ schedules });
  } catch (error) {
    return respondWithError(res, error);
  }
}

export async function updateFeedbackScheduleStatus(req, res) {
  const scheduleId = parsePositiveInteger(req.params.scheduleId);
  if (!scheduleId) return res.status(400).json({ message: "Schedule ID must be a positive integer" });
  try {
    const schedule = await updateFeedbackScheduleStatusInDatabase(scheduleId, req.auth.user.id, req.body.isActive);
    return res.status(200).json({ message: "Recurring feedback schedule updated", schedule });
  } catch (error) {
    return respondWithError(res, error);
  }
}

export async function getRequestsForReceiver(req, res) {
  const receiverId = parsePositiveInteger(req.params.userId);
  if (!receiverId) return res.status(400).json({ message: "User ID must be a positive integer" });
  if (receiverId !== req.auth.user.id) return res.status(403).json({ message: "You can only view feedback requests received by you" });
  try {
    const feedbackRequests = await getRequestsForReceiverFromDatabase(receiverId);
    return res.status(200).json({ feedbackRequests: feedbackRequests.map((request) => redactFeedbackRequestForViewer(request, req.auth.user.id)) });
  } catch (error) { return respondWithError(res, error); }
}

export async function getRequestsForGiver(req, res) {
  const giverId = parsePositiveInteger(req.params.userId);

  if (!giverId) {
    return res.status(400).json({
      message: "User ID must be a positive integer",
    });
  }

  if (giverId !== req.auth.user.id) {
    return res.status(403).json({ message: "You can only view feedback requests assigned to you" });
  }

  try {
    const feedbackRequests = await getRequestsForGiverFromDatabase(giverId);
    return res.status(200).json({ feedbackRequests: feedbackRequests.map((request) => redactFeedbackRequestForViewer(request, req.auth.user.id)) });
  } catch (error) {
    return respondWithError(res, error);
  }
}

export async function getRequestsForRequester(req, res) {
  const requesterId = parsePositiveInteger(req.params.userId);

  if (!requesterId) {
    return res.status(400).json({
      message: "User ID must be a positive integer",
    });
  }

  if (requesterId !== req.auth.user.id) {
    return res.status(403).json({ message: "You can only view feedback requests created by you" });
  }
  if (req.auth.user.role === "external") return res.status(403).json({ message: "External collaborators cannot browse feedback history." });

  try {
    const feedbackRequests =
      await getRequestsForRequesterFromDatabase(requesterId);
    return res.status(200).json({ feedbackRequests: feedbackRequests.map((request) => redactFeedbackRequestForViewer(request, req.auth.user.id)) });
  } catch (error) {
    return respondWithError(res, error);
  }
}

export async function getRequestsVisibleTo(req, res) {
  const viewerId = parsePositiveInteger(req.params.userId);
  if (!viewerId) return res.status(400).json({ message: "User ID must be a positive integer" });
  if (viewerId !== req.auth.user.id) return res.status(403).json({ message: "You can only view requests shared with you" });
  if (req.auth.user.role === "external") return res.status(403).json({ message: "External collaborators cannot browse shared feedback." });
  try {
    const feedbackRequests = await getRequestsVisibleToFromDatabase(viewerId);
    return res.status(200).json({ feedbackRequests: feedbackRequests.map((request) => redactFeedbackRequestForViewer(request, req.auth.user.id)) });
  } catch (error) {
    return respondWithError(res, error);
  }
}

export async function getFeedbackRequestById(req, res) {
  const requestId = parsePositiveInteger(req.params.id);

  if (!requestId) {
    return res.status(400).json({
      message: "Request ID must be a positive integer",
    });
  }

  try {
    const feedbackRequest =
      await getFeedbackRequestByIdFromDatabase(requestId);

    const hasViewerAccess = feedbackRequest.viewers.some((viewer) => viewer.userId === req.auth.user.id);
    const isModerator = ["admin", "hr", "sc"].includes(String(req.auth.user.role).toLowerCase());
    if (feedbackRequest.requesterId !== req.auth.user.id && feedbackRequest.giverId !== req.auth.user.id && feedbackRequest.receiverId !== req.auth.user.id && !hasViewerAccess && !isModerator) {
      return res.status(403).json({ message: "You do not have access to this feedback request" });
    }
    // The client marks only deliberate opens. Background refreshes must never
    // create a noisy, misleading view history.
    if (req.query.recordView === "true") {
      await writeFeedbackAuditEvent({ requestId, actorId: req.auth.user.id, eventType: "feedback_viewed" });
    }
    return res.status(200).json({ feedbackRequest: redactFeedbackRequestForViewer(feedbackRequest, req.auth.user.id) });
  } catch (error) {
    return respondWithError(res, error);
  }
}

export async function submitFeedbackAnswers(req, res) {
  const requestId = parsePositiveInteger(req.params.id);
  const { answers } = req.body;

  if (!requestId) {
    return res.status(400).json({
      message: "Request ID must be a positive integer",
    });
  }

  try {
    const feedbackRequest = await saveFeedbackAnswers(
      requestId,
      req.auth.user.id,
      answers,
    );

    return res.status(200).json({
      message: "Feedback submitted",
      feedbackRequest,
    });
  } catch (error) {
    return respondWithError(res, error);
  }
}

export async function saveFeedbackDraft(req, res) {
  const requestId = parsePositiveInteger(req.params.id);
  if (!requestId) return res.status(400).json({ message: "Request ID must be a positive integer" });
  try {
    const draft = await saveFeedbackDraftInDatabase(requestId, req.auth.user.id, req.body.answers);
    return res.status(200).json({ message: "Draft saved", draft });
  } catch (error) {
    return respondWithError(res, error);
  }
}

export async function addFeedbackAttachment(req, res) {
  const requestId = parsePositiveInteger(req.params.id);
  if (!requestId) return res.status(400).json({ message: "Request ID must be a positive integer" });
  try {
    const feedbackRequest = await addFeedbackAttachmentInDatabase({ requestId, actorId: req.auth.user.id, label: req.body.label, url: req.body.url });
    return res.status(201).json({ message: "Supporting link added", feedbackRequest });
  } catch (error) { return respondWithError(res, error); }
}

export async function updateFeedbackRequestDueDate(req, res) {
  const requestId = parsePositiveInteger(req.params.id);
  const { dueDate } = req.body;

  if (!requestId) {
    return res.status(400).json({ message: "Request ID must be a positive integer" });
  }

  try {
    const feedbackRequest = await updateFeedbackRequestDueDateInDatabase(
      requestId,
      req.auth.user.id,
      dueDate,
    );
    return res.status(200).json({ message: "Due date updated", feedbackRequest });
  } catch (error) {
    return respondWithError(res, error);
  }
}

export async function createFollowUp(req, res) {
  const requestId = parsePositiveInteger(req.params.id);
  const ownerId = parsePositiveInteger(req.body.ownerId);
  const { details, dueDate } = req.body;
  if (!requestId || !ownerId) return res.status(400).json({ message: "Request ID and owner ID must be positive integers" });
  try {
    const followUp = await createFollowUpInDatabase({ requestId, actorId: req.auth.user.id, details, ownerId, dueDate });
    return res.status(201).json({ message: "Follow-up created", followUp });
  } catch (error) {
    return respondWithError(res, error);
  }
}

export async function createFeedbackDiscussion(req, res) {
  const requestId = parsePositiveInteger(req.params.id);
  const { type, message, parentId, answerId } = req.body;
  const normalizedParentId = parentId === undefined || parentId === null || parentId === "" ? null : parsePositiveInteger(parentId);
  const normalizedAnswerId = answerId === undefined || answerId === null || answerId === "" ? null : parsePositiveInteger(answerId);
  if (!requestId) return res.status(400).json({ message: "Request ID must be a positive integer" });
  if (parentId !== undefined && parentId !== null && parentId !== "" && !normalizedParentId) {
    return res.status(400).json({ message: "parentId must be a positive integer" });
  }
  if (answerId !== undefined && answerId !== null && answerId !== "" && !normalizedAnswerId) return res.status(400).json({ message: "answerId must be a positive integer" });
  try {
    const feedbackRequest = await createFeedbackDiscussionInDatabase({
      requestId,
      actorId: req.auth.user.id,
      type,
      message,
      parentId: normalizedParentId,
      answerId: normalizedAnswerId,
    });
    return res.status(201).json({ message: "Feedback discussion saved", feedbackRequest });
  } catch (error) {
    return respondWithError(res, error);
  }
}

export async function updateFollowUp(req, res) {
  const followUpId = parsePositiveInteger(req.params.followUpId);
  const { status, progressNote } = req.body;
  if (!followUpId) return res.status(400).json({ message: "Follow-up ID must be a positive integer" });
  try {
    const followUp = await updateFollowUpInDatabase({ followUpId, actorId: req.auth.user.id, status, progressNote });
    return res.status(200).json({ message: "Follow-up updated", followUp });
  } catch (error) {
    return respondWithError(res, error);
  }
}

export async function performFeedbackRequestAction(req, res) {
  const requestId = parsePositiveInteger(req.params.id);
  const { action, acknowledgementComment, declineReason, moderationReason, alternateGiverId: submittedAlternateGiverId } = req.body;
  const alternateGiverId = submittedAlternateGiverId === undefined || submittedAlternateGiverId === null || submittedAlternateGiverId === ""
    ? null
    : parsePositiveInteger(submittedAlternateGiverId);

  if (!requestId) {
    return res.status(400).json({
      message: "Request ID must be a positive integer",
    });
  }

  if (!allowedActions.includes(action)) {
    return res.status(400).json({
      message: "action must be start, decline, cancel, acknowledge, or close",
    });
  }

  if (submittedAlternateGiverId !== undefined && submittedAlternateGiverId !== null && submittedAlternateGiverId !== "" && !alternateGiverId) {
    return res.status(400).json({ message: "alternateGiverId must be a positive integer" });
  }

  if (acknowledgementComment !== undefined && typeof acknowledgementComment !== "string") {
    return res.status(400).json({ message: "acknowledgementComment must be text" });
  }

  if (acknowledgementComment && acknowledgementComment.trim().length > 500) {
    return res.status(400).json({ message: "Acknowledgement comment must be 500 characters or less" });
  }

  if (declineReason !== undefined && typeof declineReason !== "string") {
    return res.status(400).json({ message: "Decline reason must be text" });
  }

  if (action === "decline" && declineReason?.trim().length < 3) {
    return res.status(400).json({ message: "Please provide a decline reason of at least 3 characters" });
  }
  if (["hide", "remove", "reopen"].includes(action) && (!moderationReason || moderationReason.trim().length < 3)) {
    return res.status(400).json({ message: "Please provide a reason of at least 3 characters" });
  }

  if (declineReason && declineReason.trim().length > 500) {
    return res.status(400).json({ message: "Decline reason must be 500 characters or less" });
  }

  try {
    const feedbackRequest = await performFeedbackRequestActionInDatabase(
      requestId,
      req.auth.user.id,
      action,
      acknowledgementComment?.trim() || null,
      declineReason?.trim() || null,
      alternateGiverId,
      moderationReason?.trim() || null,
    );

    return res.status(200).json({
      message: `Feedback request ${action}d`,
      feedbackRequest,
    });
  } catch (error) {
    return respondWithError(res, error);
  }
}

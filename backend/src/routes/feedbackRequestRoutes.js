import { Router } from "express";

import {
  createFeedbackRequest,
  createFeedbackSchedule,
  createFeedbackDiscussion,
  createFollowUp,
  getFeedbackRequestById,
  getFeedbackSchedules,
  updateFeedbackScheduleStatus,
  getRequestsForGiver,
  getRequestsForReceiver,
  getRequestsForRequester,
  getRequestsVisibleTo,
  performFeedbackRequestAction,
  saveFeedbackDraft,
  addFeedbackAttachment,
  submitFeedbackAnswers,
  updateFeedbackRequestDueDate,
  updateFollowUp,
} from "../controllers/feedbackRequestController.js";
import { requireAuth } from "../controllers/authController.js";
import { reportFeedback } from "../controllers/feedbackReportController.js";

const router = Router();

// Feedback data is private, so every request needs a valid login session.
router.use(requireAuth);

router.post("/", createFeedbackRequest);
router.post("/schedules", createFeedbackSchedule);
router.get("/schedules", getFeedbackSchedules);
router.patch("/schedules/:scheduleId", updateFeedbackScheduleStatus);
router.get("/giver/:userId", getRequestsForGiver);
router.get("/receiver/:userId", getRequestsForReceiver);
router.get("/requester/:userId", getRequestsForRequester);
router.get("/visible/:userId", getRequestsVisibleTo);
router.get("/:id", getFeedbackRequestById);
router.post("/:id/reports", reportFeedback);
router.patch("/:id/due-date", updateFeedbackRequestDueDate);
router.post("/:id/discussions", createFeedbackDiscussion);
router.post("/:id/follow-ups", createFollowUp);
router.patch("/:id/follow-ups/:followUpId", updateFollowUp);
router.post("/:id/answers", submitFeedbackAnswers);
router.put("/:id/draft", saveFeedbackDraft);
router.post("/:id/attachments", addFeedbackAttachment);
router.post("/:id/actions", performFeedbackRequestAction);

export default router;

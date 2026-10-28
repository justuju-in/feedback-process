import { Router } from "express";
import { requireAuth } from "../controllers/authController.js";
import { assignReportReviewers, listFeedbackReports, reviewReport } from "../controllers/feedbackReportController.js";

const router = Router();
router.use(requireAuth);
router.get("/", listFeedbackReports);
router.post("/:id/assign-reviewers", assignReportReviewers);
router.patch("/:id", reviewReport);

export default router;

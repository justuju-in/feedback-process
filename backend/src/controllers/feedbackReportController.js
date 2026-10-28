import { respondWithError } from "./respondWithError.js";
import { assignSpecialReportReviewers, createFeedbackReport, getFeedbackReports, reviewFeedbackReport } from "../services/feedbackReportService.js";

const reasons = new Set(["rude", "harassment", "discrimination", "inappropriate", "other"]);
const reviewStatuses = new Set(["resolved", "dismissed", "approved", "disagreed"]);

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function reportFeedback(req, res) {
  const requestId = parseId(req.params.id);
  const { reason, details } = req.body;
  if (!requestId) return res.status(400).json({ message: "Request ID must be a positive integer" });
  if (!reasons.has(reason)) return res.status(400).json({ message: "Please select a valid report reason" });
  if (details !== undefined && typeof details !== "string") return res.status(400).json({ message: "Report details must be text" });
  if (details?.trim().length > 1000) return res.status(400).json({ message: "Report details must be 1000 characters or less" });
  try {
    const report = await createFeedbackReport({ requestId, reporterId: req.auth.user.id, reason, details: details?.trim() });
    return res.status(201).json({ message: "Feedback reported for review", report });
  } catch (error) { return respondWithError(res, error); }
}

export async function listFeedbackReports(req, res) {
  try {
    const reports = await getFeedbackReports(req.auth.user.id);
    return res.status(200).json({ reports });
  } catch (error) { return respondWithError(res, error); }
}

export async function reviewReport(req, res) {
  const reportId = parseId(req.params.id);
  const { status, resolutionNote } = req.body;
  if (!reportId) return res.status(400).json({ message: "Report ID must be a positive integer" });
  if (!reviewStatuses.has(status)) return res.status(400).json({ message: "Choose a valid review action" });
  if (resolutionNote !== undefined && typeof resolutionNote !== "string") return res.status(400).json({ message: "Resolution note must be text" });
  if (resolutionNote?.trim().length > 1000) return res.status(400).json({ message: "Resolution note must be 1000 characters or less" });
  try {
    await reviewFeedbackReport({ reportId, reviewerId: req.auth.user.id, status, resolutionNote: resolutionNote?.trim() });
    return res.status(200).json({ message: "Feedback report reviewed" });
  } catch (error) { return respondWithError(res, error); }
}

export async function assignReportReviewers(req, res) {
  const reportId = parseId(req.params.id);
  const internalReviewerId = parseId(req.body.internalReviewerId);
  if (!reportId || !internalReviewerId) return res.status(400).json({ message: "A valid internal reviewer is required" });
  try {
    await assignSpecialReportReviewers({ reportId, scReviewerId: req.auth.user.id, internalReviewerId });
    return res.status(200).json({ message: "SC and internal reviewers assigned" });
  } catch (error) { return respondWithError(res, error); }
}

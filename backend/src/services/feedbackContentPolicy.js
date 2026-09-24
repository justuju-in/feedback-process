import { ServiceError } from "./serviceError.js";

// This is intentionally a small, high-confidence list. It prevents clearly
// abusive language without trying to judge normal constructive feedback.
const blockedTerms = [
  "asshole",
  "bastard",
  "bhosdike",
  "bitch",
  "chutiya",
  "dumbass",
  "fuck",
  "fucking",
  "gandu",
  "madarchod",
  "randi",
  "shit",
];

const blockedTermPattern = new RegExp(`\\b(${blockedTerms.join("|")})\\b`, "i");
const threatPattern = /\\b(kill you|hurt you|i will kill|maar dunga|mar dunga|jaan se maar)\\b/i;

export const FEEDBACK_CONTENT_POLICY_VIOLATION = "feedback_content_policy_violation";

export function validateRespectfulFeedbackText(text) {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value) return;

  if (blockedTermPattern.test(value) || threatPattern.test(value)) {
    throw new ServiceError(
      400,
      "Please rewrite this feedback respectfully. Abusive, threatening, or discriminatory language is not allowed. For a serious concern, use Report feedback so the SC Team can review it privately.",
      FEEDBACK_CONTENT_POLICY_VIOLATION,
    );
  }
}

export function validateAnonymousFeedbackText(text) {
  const value = typeof text === "string" ? text.trim() : "";
  if (value.length < 20) {
    throw new ServiceError(
      400,
      "Anonymous feedback needs at least 20 characters so it is useful and actionable.",
      FEEDBACK_CONTENT_POLICY_VIOLATION,
    );
  }
  validateRespectfulFeedbackText(value);
}

export function validateDirectFeedbackAnswers(answers, isAnonymous) {
  if (!Array.isArray(answers)) return;
  for (const item of answers) {
    const answer = typeof item === "string" ? item : item?.answer;
    if (isAnonymous) validateAnonymousFeedbackText(answer);
    else validateRespectfulFeedbackText(answer);
  }
}

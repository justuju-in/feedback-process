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

export function validateRespectfulFeedbackText(text) {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value) return;

  if (blockedTermPattern.test(value) || threatPattern.test(value)) {
    throw new ServiceError(
      400,
      "Please rewrite this feedback respectfully. Abusive, threatening, or discriminatory language is not allowed. For a serious concern, use Report feedback so the SC Team can review it privately.",
    );
  }
}

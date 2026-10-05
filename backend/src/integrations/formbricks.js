import { createHash } from "node:crypto";
import { ServiceError } from "../services/serviceError.js";

export const LOCAL_FORMBRICKS_ORIGIN = "local-feedback-process";

export function formbricksConfig(env = process.env) {
  const value = env.FORMBRICKS_URL || "https://app.formbricks.com";
  let url;
  try { url = new URL(value); } catch { throw new ServiceError(503, "Formbricks server URL is invalid"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new ServiceError(503, "Formbricks URL must be an HTTPS origin (HTTP is allowed only on localhost)");
  }
  return { origin: url.origin, apiKey: env.FORMBRICKS_API_KEY || "", configured: Boolean(env.FORMBRICKS_API_KEY) };
}

export function surveyIdFromInput(input, origin) {
  const value = String(input || "").trim();
  let id = value;
  if (value.startsWith("http")) {
    let url;
    try { url = new URL(value); } catch { throw new ServiceError(400, "Enter a survey ID or a valid survey link"); }
    if (url.origin !== origin || url.username || url.password) throw new ServiceError(400, "Survey link must belong to the configured Formbricks server");
    const match = url.pathname.match(/^\/s\/([a-zA-Z0-9_-]+)\/?$/);
    id = match?.[1] || "";
  }
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new ServiceError(400, "Enter a valid Formbricks survey ID or /s/ survey link");
  return id;
}

export async function formbricksGet(path, { fetchImpl = fetch, config = formbricksConfig(), method = "GET", body: requestBody } = {}) {
  if (!config.configured) throw new ServiceError(503, "Formbricks is not connected. Ask an administrator to configure the server connection.");
  let response;
  try {
    response = await fetchImpl(`${config.origin}/api/v1/management/${path}`, {
      method,
      headers: { "x-api-key": config.apiKey, Accept: "application/json", ...(requestBody ? { "Content-Type": "application/json" } : {}) },
      ...(requestBody ? { body: JSON.stringify(requestBody) } : {}),
      signal: AbortSignal.timeout(15000), redirect: "error",
    });
  } catch { throw new ServiceError(502, "Formbricks could not be reached. Please retry."); }
  if (!response.ok) {
    const messages = { 401: "Formbricks API key is invalid", 403: "Formbricks API key needs workspace read/write access", 404: "Survey was not found in Formbricks", 429: "Formbricks is rate limiting requests. Please retry later." };
    throw new ServiceError(502, messages[response.status] || "Formbricks rejected the request. Check the survey settings and plan.");
  }
  let body;
  try { body = await response.json(); } catch { throw new ServiceError(502, "Formbricks returned an invalid response"); }
  if (!body || !Object.hasOwn(body, "data")) throw new ServiceError(502, "Formbricks returned an invalid response");
  return body.data;
}

export function surveyQuestions(survey) {
  return Array.isArray(survey.questions) && survey.questions.length
    ? survey.questions : (survey.blocks || []).flatMap((block) => block.elements || []);
}
export function surveySnapshot(survey) {
  // Retain rendering/logic settings, not remote contacts or response metadata.
  return { questions: surveyQuestions(survey), blocks: survey.blocks || [], languages: survey.languages || [], hiddenFields: survey.hiddenFields || null, variables: survey.variables || [] };
}
export function snapshotHash(snapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}
export function validateSurvey(survey, id) {
  if (!survey || survey.id !== id || survey.type !== "link") throw new ServiceError(400, "Choose a Formbricks link survey");
  if (survey.status !== "inProgress") throw new ServiceError(409, "Publish the survey in Formbricks before connecting it");
  if (!survey.singleUse?.enabled || survey.singleUse.isEncrypted !== false) throw new ServiceError(409, "Enable single-use links and turn URL encryption off in Formbricks. The API will issue signed links for each feedback request.");
  if (!surveyQuestions(survey).length) throw new ServiceError(400, "The survey needs at least one question");
}
export function parseSingleUseLink(links, origin, surveyId) {
  let url;
  try { url = new URL(links?.[0]); } catch { throw new ServiceError(502, "Formbricks did not return a survey invitation"); }
  if (url.origin !== origin || url.pathname !== `/s/${surveyId}` || url.username || url.password || !url.searchParams.get("suId")) {
    throw new ServiceError(502, "Formbricks returned an invalid survey invitation");
  }
  const singleUseId = url.searchParams.get("suId");
  if (singleUseId.length > 255) throw new ServiceError(502, "The single-use ID is too long. Disable URL encryption in the survey settings.");
  return { link: url.toString(), singleUseId };
}
export function matchesSession(response, session) {
  return response?.surveyId === session.surveyId && response?.singleUseId === session.singleUseId;
}
export async function findSessionResponse(session, get = formbricksGet) {
  if (session.responseId) {
    const response = await get(`responses/${encodeURIComponent(session.responseId)}`);
    if (!matchesSession(response, session)) throw new ServiceError(502, "Formbricks response does not match this feedback request");
    return response;
  }
  for (let skip = 0; skip < 5000; skip += 250) {
    const page = await get(`responses?surveyId=${encodeURIComponent(session.surveyId)}&limit=250&skip=${skip}`);
    if (!Array.isArray(page)) throw new ServiceError(502, "Formbricks returned an invalid response list");
    const match = page.find((response) => matchesSession(response, session));
    if (match) return match;
    if (page.length < 250) return null;
  }
  throw new ServiceError(502, "The survey has too many responses to scan. Use a dedicated feedback survey.");
}
export function responseAnswers(response, snapshot) {
  if (!response?.data || typeof response.data !== "object" || Array.isArray(response.data)) throw new ServiceError(502, "Formbricks returned invalid answer data");
  if (typeof response.id !== "string" || !response.id || response.id.length > 128 || typeof response.finished !== "boolean") throw new ServiceError(502, "Formbricks returned invalid response identifiers or completion status");
  // Never copy respondent metadata, hidden fields or contact identifiers to the feedback receiver.
  const ids = new Set(snapshot.questions.map((question) => question.id));
  return Object.fromEntries(Object.entries(response.data).filter(([id]) => ids.has(id)));
}

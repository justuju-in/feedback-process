import {
  createTemplate as createTemplateInDatabase,
  getAllTemplates,
  getTemplateQuestions as getTemplateQuestionsFromDatabase,
  setTemplateActive as setTemplateActiveInDatabase,
  updateTemplate as updateTemplateInDatabase,
} from "../services/templateService.js";
import { respondWithError } from "./respondWithError.js";

export async function getTemplates(_req, res) {
  try {
    const templates = await getAllTemplates();
    return res.status(200).json({ templates });
  } catch (error) {
    return respondWithError(res, error);
  }
}

export async function createTemplate(req, res) {
  try {
    const template = await createTemplateInDatabase({ ...req.body, actorId: req.auth.user.id });
    return res.status(201).json({ template });
  } catch (error) {
    return respondWithError(res, error);
  }
}

export async function getTemplatesForManagement(req, res) {
  try {
    const templates = await getAllTemplates({ includeInactive: true });
    const isModerator = String(req.auth.user.role).toLowerCase() === "admin";
    return res.status(200).json({ templates: isModerator ? templates : templates.filter((template) => template.createdBy === req.auth.user.id) });
  } catch (error) { return respondWithError(res, error); }
}

export async function updateTemplate(req, res) {
  const templateId = Number(req.params.id);
  if (!Number.isInteger(templateId) || templateId <= 0) return res.status(400).json({ message: "Template ID must be a positive integer" });
  try {
    const template = await updateTemplateInDatabase({ ...req.body, templateId, actorId: req.auth.user.id, actorRole: req.auth.user.role });
    return res.status(200).json({ template });
  } catch (error) { return respondWithError(res, error); }
}

export async function setTemplateActive(req, res) {
  const templateId = Number(req.params.id);
  if (!Number.isInteger(templateId) || templateId <= 0) return res.status(400).json({ message: "Template ID must be a positive integer" });
  try {
    const template = await setTemplateActiveInDatabase({ templateId, isActive: req.body.isActive, actorId: req.auth.user.id, actorRole: req.auth.user.role });
    return res.status(200).json({ template });
  } catch (error) { return respondWithError(res, error); }
}

export async function getTemplateQuestions(req, res) {
  const templateId = Number(req.params.id);

  if (!Number.isInteger(templateId) || templateId <= 0) {
    return res.status(400).json({
      message: "Template ID must be a positive integer",
    });
  }

  try {
    const template = await getTemplateQuestionsFromDatabase(templateId);
    return res.status(200).json(template);
  } catch (error) {
    return respondWithError(res, error);
  }
}

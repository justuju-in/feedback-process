import { getDatabasePool } from "../db/connection.js";
import { ServiceError } from "./serviceError.js";

const moderatorRoles = new Set(["admin"]);

function canModerate(role) {
  return moderatorRoles.has(String(role || "").toLowerCase());
}

function normalizeTemplateDetails({ name, description, questions }) {
  const templateName = String(name || "").trim();
  const templateDescription = String(description || "").trim() || null;
  const normalizedQuestions = normalizeTemplateQuestions(questions);

  if (templateName.length < 3) {
    throw new ServiceError(400, "Template name must contain at least 3 characters");
  }

  return { templateName, templateDescription, normalizedQuestions };
}

export async function getAllTemplates({ includeInactive = false } = {}) {
  const pool = getDatabasePool();
  const [templates] = await pool.query(
    `SELECT template.id, template.name, template.description,
        template.created_by AS createdBy, template.is_active AS isActive,
        template.created_at AS createdAt, creator.name AS createdByName
     FROM feedback_templates AS template
     LEFT JOIN users AS creator ON creator.id = template.created_by
     ${includeInactive ? "" : "WHERE template.is_active = TRUE"}
     ORDER BY template.is_active DESC, template.id`,
  );

  return templates;
}

function normalizeTemplateQuestions(questions) {
  if (!Array.isArray(questions)) {
    throw new ServiceError(400, "questions must be an array");
  }

  const normalizedQuestions = questions
    .map((question) => String(question || "").trim())
    .filter(Boolean);

  if (normalizedQuestions.length < 1) {
    throw new ServiceError(400, "At least one template question is required");
  }

  if (normalizedQuestions.length > 10) {
    throw new ServiceError(400, "A template can have maximum 10 questions");
  }

  return normalizedQuestions;
}

export async function createTemplate({ name, description, questions, actorId }) {
  const { templateName, templateDescription, normalizedQuestions } = normalizeTemplateDetails({ name, description, questions });

  const pool = getDatabasePool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[existingTemplate]] = await connection.execute(
      "SELECT id FROM feedback_templates WHERE name = ?",
      [templateName],
    );

    if (existingTemplate) {
      throw new ServiceError(409, "A feedback template with this name already exists");
    }

    const [templateResult] = await connection.execute(
      `INSERT INTO feedback_templates (name, description, created_by)
       VALUES (?, ?, ?)`,
      [templateName, templateDescription, actorId],
    );

    const templateId = templateResult.insertId;

    for (const [index, questionText] of normalizedQuestions.entries()) {
      await connection.execute(
        `INSERT INTO template_questions (template_id, question_text, question_order)
         VALUES (?, ?, ?)`,
        [templateId, questionText, index + 1],
      );
    }

    await connection.commit();

    return {
      id: templateId,
      name: templateName,
      description: templateDescription,
      createdBy: actorId,
      isActive: true,
      questions: normalizedQuestions.map((questionText, index) => ({
        questionText,
        questionOrder: index + 1,
      })),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function findTemplateForManagement(connection, templateId) {
  const [[template]] = await connection.execute(
    `SELECT id, name, description, created_by AS createdBy, is_active AS isActive
     FROM feedback_templates WHERE id = ?`,
    [templateId],
  );
  if (!template) throw new ServiceError(404, "Feedback template not found");
  return template;
}

function assertCanManageTemplate(template, actorId, actorRole) {
  if (canModerate(actorRole)) return;
  if (template.createdBy === actorId) return;
  throw new ServiceError(403, "You can manage only templates you created");
}

export async function updateTemplate({ templateId, name, description, questions, actorId, actorRole }) {
  const { templateName, templateDescription, normalizedQuestions } = normalizeTemplateDetails({ name, description, questions });
  const pool = getDatabasePool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const template = await findTemplateForManagement(connection, templateId);
    assertCanManageTemplate(template, actorId, actorRole);

    const [[duplicate]] = await connection.execute(
      "SELECT id FROM feedback_templates WHERE name = ? AND id != ?",
      [templateName, templateId],
    );
    if (duplicate) throw new ServiceError(409, "A feedback template with this name already exists");

    const [[usage]] = await connection.execute(
      "SELECT COUNT(*) AS count FROM feedback_requests WHERE template_id = ?",
      [templateId],
    );
    if (Number(usage.count) > 0) {
      throw new ServiceError(409, "This template has already been used. Create a new template instead so old feedback stays unchanged.");
    }

    await connection.execute(
      "UPDATE feedback_templates SET name = ?, description = ? WHERE id = ?",
      [templateName, templateDescription, templateId],
    );
    await connection.execute("DELETE FROM template_questions WHERE template_id = ?", [templateId]);
    for (const [index, questionText] of normalizedQuestions.entries()) {
      await connection.execute(
        "INSERT INTO template_questions (template_id, question_text, question_order) VALUES (?, ?, ?)",
        [templateId, questionText, index + 1],
      );
    }
    await connection.commit();
    return { id: templateId, name: templateName, description: templateDescription, createdBy: template.createdBy, isActive: template.isActive, questions: normalizedQuestions.map((questionText, index) => ({ questionText, questionOrder: index + 1 })) };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function setTemplateActive({ templateId, isActive, actorId, actorRole }) {
  if (typeof isActive !== "boolean") throw new ServiceError(400, "isActive must be true or false");
  const pool = getDatabasePool();
  const connection = await pool.getConnection();
  try {
    const template = await findTemplateForManagement(connection, templateId);
    assertCanManageTemplate(template, actorId, actorRole);
    await connection.execute("UPDATE feedback_templates SET is_active = ? WHERE id = ?", [isActive, templateId]);
    return { ...template, isActive };
  } finally {
    connection.release();
  }
}

export async function getTemplateQuestions(templateId) {
  const pool = getDatabasePool();
  const [[template]] = await pool.execute(
    `SELECT id, name
     FROM feedback_templates
     WHERE id = ?`,
    [templateId],
  );

  if (!template) {
    throw new ServiceError(404, "Feedback template not found");
  }

  const [questions] = await pool.execute(
    `SELECT id, question_text AS questionText, question_order AS questionOrder
     FROM template_questions
     WHERE template_id = ?
     ORDER BY question_order, id`,
    [templateId],
  );

  return {
    templateId: template.id,
    templateName: template.name,
    questions,
  };
}

import { getDatabasePool } from "../db/connection.js";
import { ServiceError } from "./serviceError.js";

const moderatorRoles = new Set(["admin"]);

const builtInTemplates = [
  {
    name: "Learning Feedback",
    description: "Feedback about learning progress, understanding, and improvement areas",
    questions: ["What did the person learn well?", "Where can the person improve?", "What should the person practise next?"],
  },
  {
    name: "Project Completion Feedback",
    description: "Feedback after completing a project or task",
    questions: ["What went well in the project?", "What challenges came during the project?", "What can be improved in the next project?"],
  },
  {
    name: "Written Feedback",
    description: "Structured written feedback about work, behaviour, and next steps",
    questions: ["What work or behaviour would you like to recognise?", "What could be improved?", "What is one practical next step?"],
  },
  {
    name: "Peer Feedback",
    description: "Feedback from a colleague about collaboration and contribution",
    questions: ["How did the person collaborate with others?", "What strengths did you observe?", "What would improve working together next time?"],
  },
  {
    name: "Growth Feedback",
    description: "Feedback about professional growth, strengths, and development",
    questions: ["What progress or growth have you observed?", "Which skill or area should the person focus on next?", "What support would help their growth?"],
  },
  {
    name: "One-on-One Feedback",
    description: "Feedback to support a focused one-on-one conversation",
    questions: ["What would you like to discuss?", "What is going well?", "What support or next step would help?"],
  },
  {
    name: "Group Feedback",
    description: "Feedback about team or group collaboration and outcomes",
    questions: ["What did the group do well?", "What challenge should the group address?", "What action should the group take next?"],
  },
];

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

export async function getAllTemplates({ includeInactive = false, userId = null } = {}) {
  const pool = getDatabasePool();
  const visibilityFilter = userId ? " AND (template.created_by IS NULL OR template.created_by = ?)" : "";
  const [templates] = await pool.query(
    `SELECT template.id, template.name, template.description,
        template.created_by AS createdBy, template.is_active AS isActive,
        template.created_at AS createdAt, creator.name AS createdByName
     FROM feedback_templates AS template
     LEFT JOIN users AS creator ON creator.id = template.created_by
     ${includeInactive ? "WHERE 1 = 1" : "WHERE template.is_active = TRUE"}
     ${visibilityFilter}
     ORDER BY template.is_active DESC, template.created_by IS NOT NULL, template.id`,
    userId ? [userId] : [],
  );

  return templates;
}

export async function ensureBuiltInTemplates() {
  const pool = getDatabasePool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const template of builtInTemplates) {
      const [[existing]] = await connection.execute(
        "SELECT id FROM feedback_templates WHERE name = ? LIMIT 1",
        [template.name],
      );
      const templateId = existing?.id || (await connection.execute(
        "INSERT INTO feedback_templates (name, description, created_by, is_active) VALUES (?, ?, NULL, TRUE)",
        [template.name, template.description],
      ))[0].insertId;

      for (const [index, question] of template.questions.entries()) {
        await connection.execute(
          `INSERT INTO template_questions (template_id, question_text, question_order)
           SELECT ?, ?, ? WHERE NOT EXISTS (
             SELECT 1 FROM template_questions WHERE template_id = ? AND question_order = ?
           )`,
          [templateId, question, index + 1, templateId, index + 1],
        );
      }
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
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
  if (template.createdBy == null) {
    throw new ServiceError(403, "Built-in feedback types cannot be changed");
  }
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

import { getDatabasePool } from "../db/connection.js";
import { ServiceError } from "./serviceError.js";

const moderatorRoles = new Set(["admin"]);
const questionTypes = new Set(["short_text", "long_text", "dropdown", "radio", "checkbox", "rating", "yes_no"]);
const optionQuestionTypes = new Set(["dropdown", "radio", "checkbox"]);

function question(questionText, questionType = "long_text", options = [], isRequired = true) {
  return { questionText, questionType, options, isRequired };
}

const builtInTemplates = [
  {
    name: "Learning Feedback",
    description: "Feedback about learning progress, understanding, and next steps",
    questions: [
      "What is this person doing well in their learning?",
      "Which area should they focus on improving?",
      "What practical step would help them improve next?",
      "Can you share one example to make this feedback clear?",
    ],
  },
  {
    name: "Project Completion Feedback",
    description: "Feedback after completing a project or task",
    questions: [
      "What went well in this project?",
      "What challenge or issue could be improved next time?",
      "What should we do differently in the next project?",
      "How well did the person communicate and collaborate during the project?",
    ],
  },
  {
    name: "Written Feedback",
    description: "Structured written feedback about work, behaviour, and next steps",
    questions: [
      "What work or behaviour would you like to appreciate?",
      "What could be improved?",
      "What is one clear next step?",
      "Can you share one example to make the feedback clear?",
    ],
  },
  {
    name: "Peer Feedback",
    description: "Feedback from a colleague about collaboration and contribution",
    questions: [
      "How did this person collaborate with others?",
      "What strength did you notice in their work?",
      "What would make working together even better?",
      "How reliable and responsive was this person?",
    ],
  },
  {
    name: "Growth Feedback",
    description: "Feedback about professional growth, strengths, and development needs",
    questions: [
      "What progress or growth have you noticed?",
      "Which skill should this person develop next?",
      "What support or opportunity would help their growth?",
      "Which strength should this person continue building on?",
    ],
  },
  {
    name: "Custom Learning Check-in",
    description: "Example custom template with dropdown, radio, checkbox, rating, and text fields",
    questions: [
      question("Which learning area is this feedback about?", "dropdown", ["Frontend", "Backend", "Database", "Communication", "Project work"]),
      question("Current confidence level", "radio", ["Low", "Medium", "High"]),
      question("Which skills should be practised next?", "checkbox", ["Concept clarity", "Hands-on practice", "Debugging", "Communication", "Documentation"]),
      question("How would you rate the current progress?", "rating"),
      question("What should be the next clear action?", "long_text"),
    ],
  },
  {
    name: "One-on-One Feedback",
    description: "Feedback to support a focused one-on-one conversation",
    questions: [
      "What is going well right now?",
      "What challenge or support do you need?",
      "What is one goal or next step for the coming period?",
      "What should we continue, stop, or start doing?",
    ],
  },
  {
    name: "Group Feedback",
    description: "Feedback about team or group collaboration and outcomes",
    questions: [
      "What did the group do well?",
      "What challenge should the group improve?",
      "What action should the group take next?",
      "Did everyone get a fair chance to contribute?",
    ],
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

      await connection.execute(
        "UPDATE feedback_templates SET description = ?, is_active = TRUE WHERE id = ?",
        [template.description, templateId],
      );

      for (const [index, question] of template.questions.entries()) {
        const questionDetails = normalizeTemplateQuestions([question])[0];
        const [[existingQuestion]] = await connection.execute(
          `SELECT id FROM template_questions
           WHERE template_id = ? AND question_order = ?
           ORDER BY id
           LIMIT 1`,
          [templateId, index + 1],
        );

        if (existingQuestion) {
          await connection.execute(
            "UPDATE template_questions SET question_text = ?, question_type = ?, options_json = ?, is_required = ? WHERE id = ?",
            [
              questionDetails.questionText,
              questionDetails.questionType,
              JSON.stringify(questionDetails.options),
              questionDetails.isRequired,
              existingQuestion.id,
            ],
          );
        } else {
          await connection.execute(
            `INSERT INTO template_questions
               (template_id, question_text, question_type, options_json, is_required, question_order)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              templateId,
              questionDetails.questionText,
              questionDetails.questionType,
              JSON.stringify(questionDetails.options),
              questionDetails.isRequired,
              index + 1,
            ],
          );
        }
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
    .map((item) => {
      const isObjectQuestion = item && typeof item === "object" && !Array.isArray(item);
      const questionText = String(isObjectQuestion ? item.questionText ?? item.text ?? item.label ?? "" : item || "").trim();
      if (!questionText) return null;

      const questionType = String(isObjectQuestion ? item.questionType ?? item.type ?? "long_text" : "long_text").trim() || "long_text";
      if (!questionTypes.has(questionType)) {
        throw new ServiceError(400, `Unsupported question type: ${questionType}`);
      }

      const options = Array.isArray(item?.options)
        ? item.options.map((option) => String(option || "").trim()).filter(Boolean)
        : [];
      if (optionQuestionTypes.has(questionType) && options.length < 2) {
        throw new ServiceError(400, `${questionType} questions need at least 2 options`);
      }

      return {
        questionText,
        questionType,
        options: optionQuestionTypes.has(questionType) ? options.slice(0, 20) : [],
        isRequired: isObjectQuestion && typeof item.isRequired === "boolean" ? item.isRequired : true,
      };
    })
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

    for (const [index, questionDetails] of normalizedQuestions.entries()) {
      await connection.execute(
        `INSERT INTO template_questions
           (template_id, question_text, question_type, options_json, is_required, question_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          templateId,
          questionDetails.questionText,
          questionDetails.questionType,
          JSON.stringify(questionDetails.options),
          questionDetails.isRequired,
          index + 1,
        ],
      );
    }

    await connection.commit();

    return {
      id: templateId,
      name: templateName,
      description: templateDescription,
      createdBy: actorId,
      isActive: true,
      questions: normalizedQuestions.map((questionDetails, index) => ({
        ...questionDetails,
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
    for (const [index, questionDetails] of normalizedQuestions.entries()) {
      await connection.execute(
        `INSERT INTO template_questions
           (template_id, question_text, question_type, options_json, is_required, question_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          templateId,
          questionDetails.questionText,
          questionDetails.questionType,
          JSON.stringify(questionDetails.options),
          questionDetails.isRequired,
          index + 1,
        ],
      );
    }
    await connection.commit();
    return {
      id: templateId,
      name: templateName,
      description: templateDescription,
      createdBy: template.createdBy,
      isActive: template.isActive,
      questions: normalizedQuestions.map((questionDetails, index) => ({ ...questionDetails, questionOrder: index + 1 })),
    };
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
    `SELECT id, question_text AS questionText, question_type AS questionType,
        options_json AS options, is_required AS isRequired, question_order AS questionOrder
     FROM template_questions
     WHERE template_id = ?
     ORDER BY question_order, id`,
    [templateId],
  );

  return {
    templateId: template.id,
    templateName: template.name,
    questions: questions.map((item) => ({
      ...item,
      options: typeof item.options === "string" ? JSON.parse(item.options || "[]") : item.options || [],
      isRequired: Boolean(item.isRequired),
    })),
  };
}

// Starter templates from the previous Form.io local testing flow.
export async function seedLocalTemplates(db) {
  const templates = [
    ["Growth Feedback", "Feedback about professional growth, strengths, and development", ["What progress or growth have you observed?", "Which skill or area should the person focus on next?", "What support would help their growth?"]],
    ["Learning Feedback", "Feedback about learning progress, understanding, and improvement areas", ["What did the person learn well?", "Where can the person improve?", "What should the person practice next?"]],
  ];
  await db.beginTransaction();
  try {
    for (const [name, description, questions] of templates) {
      const [existing] = await db.execute("SELECT id FROM feedback_templates WHERE name = ?", [name]);
      if (existing.length) continue; // Preserve existing questions and answers.
      const [created] = await db.execute("INSERT INTO feedback_templates (name, description) VALUES (?, ?)", [name, description]);
      for (const [index, question] of questions.entries()) {
        await db.execute("INSERT INTO template_questions (template_id, question_text, question_order) VALUES (?, ?, ?)", [created.insertId, question, index + 1]);
      }
    }
    await db.execute("UPDATE feedback_templates SET is_active = FALSE WHERE name = 'Local test feedback' AND created_by IS NULL");
    await db.commit();
  } catch (error) { await db.rollback(); throw error; }
}

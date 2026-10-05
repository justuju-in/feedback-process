const decode = (value) => typeof value === "string" ? JSON.parse(value) : value;

export async function getFormbricksFeedback(pool, requestId, templateId) {
  const [[template]] = await pool.execute("SELECT snapshot FROM formbricks_templates WHERE template_id = ?", [templateId]);
  if (!template) return null;
  const [[session]] = await pool.execute("SELECT answers, completed FROM formbricks_sessions WHERE request_id = ?", [requestId]);
  // Keep partial responses and invitation credentials private, including for moderators.
  return { questions: decode(template.snapshot).questions, completed: Boolean(session?.completed), answers: session?.completed ? decode(session.answers) : null };
}

export async function ensureFormbricksSchema(pool) {
  await pool.execute(`CREATE TABLE IF NOT EXISTS formbricks_templates (
    template_id INT PRIMARY KEY,
    survey_id VARCHAR(128) NOT NULL,
    origin VARCHAR(255) NOT NULL,
    snapshot JSON NOT NULL,
    snapshot_hash CHAR(64) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (template_id) REFERENCES feedback_templates(id)
  )`);
  await pool.execute(`CREATE TABLE IF NOT EXISTS formbricks_sessions (
    request_id INT PRIMARY KEY,
    survey_id VARCHAR(128) NOT NULL,
    origin VARCHAR(255) NOT NULL,
    single_use_id VARCHAR(255) NOT NULL,
    invitation_url TEXT NOT NULL,
    response_id VARCHAR(128) NULL,
    answers JSON NULL,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    last_checked_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_formbricks_response (response_id),
    UNIQUE KEY unique_formbricks_invitation (survey_id, single_use_id),
    FOREIGN KEY (request_id) REFERENCES feedback_requests(id)
  )`);
}

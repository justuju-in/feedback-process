CREATE DATABASE IF NOT EXISTS feedback_process;

USE feedback_process;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  role VARCHAR(50) DEFAULT 'member',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

SET @add_password_hash_column = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL AFTER email',
    'DO 0'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'users'
    AND column_name = 'password_hash'
);
PREPARE add_password_hash_column_statement FROM @add_password_hash_column;
EXECUTE add_password_hash_column_statement;
DEALLOCATE PREPARE add_password_hash_column_statement;

UPDATE users
SET password_hash = '$2b$10$eHi2aDoc688CFSOfXkmvtuE3hV/1Ll9wHg2eok7mXrz3lhufUcvom'
WHERE password_hash IS NULL OR password_hash = '';

ALTER TABLE users
  MODIFY COLUMN password_hash VARCHAR(255) NOT NULL;

SET @add_is_active_column = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE AFTER password_hash',
    'DO 0'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'users'
    AND column_name = 'is_active'
);
PREPARE add_is_active_column_statement FROM @add_is_active_column;
EXECUTE add_is_active_column_statement;
DEALLOCATE PREPARE add_is_active_column_statement;

SET @add_updated_at_column = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE users ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at',
    'DO 0'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'users'
    AND column_name = 'updated_at'
);
PREPARE add_updated_at_column_statement FROM @add_updated_at_column;
EXECUTE add_updated_at_column_statement;
DEALLOCATE PREPARE add_updated_at_column_statement;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id CHAR(36) PRIMARY KEY,
  user_id INT NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id CHAR(36) PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Passwords stored here cannot be selected again during a later password reset.
CREATE TABLE IF NOT EXISTS password_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_password_history_user_id (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id CHAR(36) PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

SET @add_email_verified_at_column = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE users ADD COLUMN email_verified_at DATETIME NULL AFTER is_active',
    'DO 0')
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'email_verified_at'
);
PREPARE add_email_verified_at_column_statement FROM @add_email_verified_at_column;
EXECUTE add_email_verified_at_column_statement;
DEALLOCATE PREPARE add_email_verified_at_column_statement;

CREATE TABLE IF NOT EXISTS feedback_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  created_by INT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

SET @add_template_created_by_column = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE feedback_templates ADD COLUMN created_by INT NULL AFTER description',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'feedback_templates'
    AND column_name = 'created_by'
);
PREPARE add_template_created_by_column_statement FROM @add_template_created_by_column;
EXECUTE add_template_created_by_column_statement;
DEALLOCATE PREPARE add_template_created_by_column_statement;

SET @add_template_is_active_column = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE feedback_templates ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE AFTER description',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'feedback_templates'
    AND column_name = 'is_active'
);
PREPARE add_template_is_active_column_statement FROM @add_template_is_active_column;
EXECUTE add_template_is_active_column_statement;
DEALLOCATE PREPARE add_template_is_active_column_statement;

CREATE TABLE IF NOT EXISTS template_questions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT NOT NULL,
  question_text TEXT NOT NULL,
  question_type VARCHAR(30) NOT NULL DEFAULT 'long_text',
  options_json JSON NULL,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  validation_json JSON NULL,
  question_order INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (template_id) REFERENCES feedback_templates(id)
);

SET @add_template_question_type_column = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE template_questions ADD COLUMN question_type VARCHAR(30) NOT NULL DEFAULT ''long_text'' AFTER question_text',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'template_questions'
    AND column_name = 'question_type'
);
PREPARE add_template_question_type_column_statement FROM @add_template_question_type_column;
EXECUTE add_template_question_type_column_statement;
DEALLOCATE PREPARE add_template_question_type_column_statement;

SET @add_template_question_options_column = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE template_questions ADD COLUMN options_json JSON NULL AFTER question_type',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'template_questions'
    AND column_name = 'options_json'
);
PREPARE add_template_question_options_column_statement FROM @add_template_question_options_column;
EXECUTE add_template_question_options_column_statement;
DEALLOCATE PREPARE add_template_question_options_column_statement;

SET @add_template_question_required_column = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE template_questions ADD COLUMN is_required BOOLEAN NOT NULL DEFAULT TRUE AFTER options_json',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'template_questions'
    AND column_name = 'is_required'
);
PREPARE add_template_question_required_column_statement FROM @add_template_question_required_column;
EXECUTE add_template_question_required_column_statement;
DEALLOCATE PREPARE add_template_question_required_column_statement;

SET @add_template_question_validation_column = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE template_questions ADD COLUMN validation_json JSON NULL AFTER is_required',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'template_questions'
    AND column_name = 'validation_json'
);
PREPARE add_template_question_validation_column_statement FROM @add_template_question_validation_column;
EXECUTE add_template_question_validation_column_statement;
DEALLOCATE PREPARE add_template_question_validation_column_statement;

CREATE TABLE IF NOT EXISTS feedback_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  requester_id INT NOT NULL,
  giver_id INT NOT NULL,
  receiver_id INT NOT NULL,
  template_id INT NOT NULL,
  message TEXT,
  due_date DATE NULL,
  purpose VARCHAR(40) NULL,
  visibility VARCHAR(30) NOT NULL DEFAULT 'private',
  is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  alternate_giver_id INT NULL,
  hidden_at TIMESTAMP NULL,
  hidden_by INT NULL,
  hidden_reason TEXT NULL,
  removed_at TIMESTAMP NULL,
  removed_by INT NULL,
  removed_reason TEXT NULL,
  status VARCHAR(30) DEFAULT 'requested',
  submitted_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (requester_id) REFERENCES users(id),
  FOREIGN KEY (giver_id) REFERENCES users(id),
  FOREIGN KEY (receiver_id) REFERENCES users(id),
  FOREIGN KEY (alternate_giver_id) REFERENCES users(id),
  FOREIGN KEY (template_id) REFERENCES feedback_templates(id)
);

SET @add_submitted_at_column = (
  SELECT IF(COUNT(*) = 0, 'ALTER TABLE feedback_requests ADD COLUMN submitted_at TIMESTAMP NULL AFTER status', 'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'feedback_requests' AND column_name = 'submitted_at'
);
PREPARE add_submitted_at_column_statement FROM @add_submitted_at_column;
EXECUTE add_submitted_at_column_statement;
DEALLOCATE PREPARE add_submitted_at_column_statement;

-- Moderation is a soft action: the original feedback is retained for audit.
SET @add_hidden_at_column = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE feedback_requests ADD COLUMN hidden_at TIMESTAMP NULL', 'DO 0') FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'feedback_requests' AND column_name = 'hidden_at');
PREPARE add_hidden_at_column_statement FROM @add_hidden_at_column; EXECUTE add_hidden_at_column_statement; DEALLOCATE PREPARE add_hidden_at_column_statement;
SET @add_removed_at_column = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE feedback_requests ADD COLUMN removed_at TIMESTAMP NULL', 'DO 0') FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'feedback_requests' AND column_name = 'removed_at');
PREPARE add_removed_at_column_statement FROM @add_removed_at_column; EXECUTE add_removed_at_column_statement; DEALLOCATE PREPARE add_removed_at_column_statement;
SET @add_hidden_by_column = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE feedback_requests ADD COLUMN hidden_by INT NULL', 'DO 0') FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'feedback_requests' AND column_name = 'hidden_by');
PREPARE add_hidden_by_column_statement FROM @add_hidden_by_column; EXECUTE add_hidden_by_column_statement; DEALLOCATE PREPARE add_hidden_by_column_statement;
SET @add_hidden_reason_column = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE feedback_requests ADD COLUMN hidden_reason TEXT NULL', 'DO 0') FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'feedback_requests' AND column_name = 'hidden_reason');
PREPARE add_hidden_reason_column_statement FROM @add_hidden_reason_column; EXECUTE add_hidden_reason_column_statement; DEALLOCATE PREPARE add_hidden_reason_column_statement;
SET @add_removed_by_column = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE feedback_requests ADD COLUMN removed_by INT NULL', 'DO 0') FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'feedback_requests' AND column_name = 'removed_by');
PREPARE add_removed_by_column_statement FROM @add_removed_by_column; EXECUTE add_removed_by_column_statement; DEALLOCATE PREPARE add_removed_by_column_statement;
SET @add_removed_reason_column = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE feedback_requests ADD COLUMN removed_reason TEXT NULL', 'DO 0') FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'feedback_requests' AND column_name = 'removed_reason');
PREPARE add_removed_reason_column_statement FROM @add_removed_reason_column; EXECUTE add_removed_reason_column_statement; DEALLOCATE PREPARE add_removed_reason_column_statement;

SET @add_due_date_column = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE feedback_requests ADD COLUMN due_date DATE NULL AFTER message',
    'DO 0'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'feedback_requests'
    AND column_name = 'due_date'
);
PREPARE add_due_date_column_statement FROM @add_due_date_column;
EXECUTE add_due_date_column_statement;
DEALLOCATE PREPARE add_due_date_column_statement;

SET @add_purpose_column = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE feedback_requests ADD COLUMN purpose VARCHAR(40) NULL AFTER due_date',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'feedback_requests'
    AND column_name = 'purpose'
);
PREPARE add_purpose_column_statement FROM @add_purpose_column;
EXECUTE add_purpose_column_statement;
DEALLOCATE PREPARE add_purpose_column_statement;

SET @add_is_anonymous_column = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE feedback_requests ADD COLUMN is_anonymous BOOLEAN NOT NULL DEFAULT FALSE AFTER visibility',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'feedback_requests'
    AND column_name = 'is_anonymous'
);
PREPARE add_is_anonymous_column_statement FROM @add_is_anonymous_column;
EXECUTE add_is_anonymous_column_statement;
DEALLOCATE PREPARE add_is_anonymous_column_statement;

SET @add_receiver_id_column = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE feedback_requests ADD COLUMN receiver_id INT NULL AFTER giver_id',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'feedback_requests' AND column_name = 'receiver_id'
);
PREPARE add_receiver_id_column_statement FROM @add_receiver_id_column;
EXECUTE add_receiver_id_column_statement;
DEALLOCATE PREPARE add_receiver_id_column_statement;
UPDATE feedback_requests SET receiver_id = requester_id WHERE receiver_id IS NULL;

SET @add_visibility_column = (
  SELECT IF(
    COUNT(*) = 0,
    "ALTER TABLE feedback_requests ADD COLUMN visibility VARCHAR(30) NOT NULL DEFAULT 'private' AFTER purpose",
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'feedback_requests'
    AND column_name = 'visibility'
);
PREPARE add_visibility_column_statement FROM @add_visibility_column;
EXECUTE add_visibility_column_statement;
DEALLOCATE PREPARE add_visibility_column_statement;

SET @add_request_updated_at_column = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE feedback_requests ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'feedback_requests'
    AND column_name = 'updated_at'
);
PREPARE add_request_updated_at_column_statement FROM @add_request_updated_at_column;
EXECUTE add_request_updated_at_column_statement;
DEALLOCATE PREPARE add_request_updated_at_column_statement;

SET @add_acknowledgement_comment_column = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE feedback_requests ADD COLUMN acknowledgement_comment TEXT NULL AFTER status',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'feedback_requests'
    AND column_name = 'acknowledgement_comment'
);
PREPARE add_acknowledgement_comment_column_statement FROM @add_acknowledgement_comment_column;
EXECUTE add_acknowledgement_comment_column_statement;
DEALLOCATE PREPARE add_acknowledgement_comment_column_statement;

SET @add_decline_reason_column = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE feedback_requests ADD COLUMN decline_reason TEXT NULL AFTER status',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'feedback_requests'
    AND column_name = 'decline_reason'
);
PREPARE add_decline_reason_column_statement FROM @add_decline_reason_column;
EXECUTE add_decline_reason_column_statement;
DEALLOCATE PREPARE add_decline_reason_column_statement;

SET @add_alternate_giver_id_column = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE feedback_requests ADD COLUMN alternate_giver_id INT NULL AFTER decline_reason',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'feedback_requests'
    AND column_name = 'alternate_giver_id'
);
PREPARE add_alternate_giver_id_column_statement FROM @add_alternate_giver_id_column;
EXECUTE add_alternate_giver_id_column_statement;
DEALLOCATE PREPARE add_alternate_giver_id_column_statement;

SET @add_acknowledged_at_column = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE feedback_requests ADD COLUMN acknowledged_at TIMESTAMP NULL AFTER acknowledgement_comment',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'feedback_requests'
    AND column_name = 'acknowledged_at'
);
PREPARE add_acknowledged_at_column_statement FROM @add_acknowledged_at_column;
EXECUTE add_acknowledged_at_column_statement;
DEALLOCATE PREPARE add_acknowledged_at_column_statement;

-- Keeps automated reminders idempotent: restarting the API must not send the
-- same due-date reminder or overdue alert again.
CREATE TABLE IF NOT EXISTS feedback_notification_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  notification_key VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_feedback_notification (request_id, notification_key),
  FOREIGN KEY (request_id) REFERENCES feedback_requests(id)
);

CREATE TABLE IF NOT EXISTS feedback_request_schedules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  requester_id INT NOT NULL,
  giver_id INT NOT NULL,
  receiver_id INT NOT NULL,
  template_id INT NOT NULL,
  message TEXT NULL,
  purpose VARCHAR(40) NULL,
  visibility VARCHAR(30) NOT NULL DEFAULT 'private',
  frequency VARCHAR(20) NOT NULL,
  scheduled_time TIME NULL,
  due_in_days INT NOT NULL DEFAULT 7,
  next_run_date DATE NOT NULL,
  end_date DATE NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (requester_id) REFERENCES users(id),
  FOREIGN KEY (giver_id) REFERENCES users(id),
  FOREIGN KEY (receiver_id) REFERENCES users(id),
  FOREIGN KEY (template_id) REFERENCES feedback_templates(id)
);

SET @add_scheduled_time_column = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE feedback_request_schedules ADD COLUMN scheduled_time TIME NULL AFTER frequency',
    'DO 0')
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'feedback_request_schedules' AND column_name = 'scheduled_time'
);
PREPARE add_scheduled_time_column_statement FROM @add_scheduled_time_column;
EXECUTE add_scheduled_time_column_statement;
DEALLOCATE PREPARE add_scheduled_time_column_statement;

CREATE TABLE IF NOT EXISTS feedback_schedule_viewers (
  schedule_id INT NOT NULL,
  user_id INT NOT NULL,
  PRIMARY KEY (schedule_id, user_id),
  FOREIGN KEY (schedule_id) REFERENCES feedback_request_schedules(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS user_notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  request_id INT NULL,
  type VARCHAR(40) NOT NULL,
  title VARCHAR(160) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (request_id) REFERENCES feedback_requests(id),
  INDEX user_notifications_inbox (user_id, is_read, created_at)
);

-- A private safety record. The feedback itself remains unchanged while an
-- SC Team reviewer investigates the confidential report.
CREATE TABLE IF NOT EXISTS feedback_reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  reporter_id INT NOT NULL,
  reason VARCHAR(40) NOT NULL,
  details TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  reviewed_by INT NULL,
  reviewed_at TIMESTAMP NULL,
  resolution_note TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_feedback_reporter (request_id, reporter_id),
  INDEX feedback_reports_review_queue (status, created_at),
  FOREIGN KEY (request_id) REFERENCES feedback_requests(id),
  FOREIGN KEY (reporter_id) REFERENCES users(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS feedback_audit_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  actor_id INT NULL,
  event_type VARCHAR(60) NOT NULL,
  details TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX feedback_audit_request (request_id, created_at),
  FOREIGN KEY (request_id) REFERENCES feedback_requests(id),
  FOREIGN KEY (actor_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS feedback_answers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  question_id INT NOT NULL,
  answer TEXT NOT NULL,
  rating TINYINT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (request_id) REFERENCES feedback_requests(id),
  FOREIGN KEY (question_id) REFERENCES template_questions(id)
);

-- This table refers to feedback_answers, so it must be created after the
-- answers table. Keeping that order lets a brand-new MySQL database start
-- cleanly in Docker as well as on a regular server.
CREATE TABLE IF NOT EXISTS feedback_discussions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  answer_id INT NULL,
  parent_id INT NULL,
  author_id INT NOT NULL,
  type VARCHAR(30) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  resolved_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES feedback_requests(id),
  FOREIGN KEY (answer_id) REFERENCES feedback_answers(id),
  FOREIGN KEY (parent_id) REFERENCES feedback_discussions(id),
  FOREIGN KEY (author_id) REFERENCES users(id)
);

SET @add_discussion_answer_id_column = (
  SELECT IF(COUNT(*) = 0, 'ALTER TABLE feedback_discussions ADD COLUMN answer_id INT NULL AFTER request_id', 'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'feedback_discussions' AND column_name = 'answer_id'
);
PREPARE add_discussion_answer_id_column_statement FROM @add_discussion_answer_id_column;
EXECUTE add_discussion_answer_id_column_statement;
DEALLOCATE PREPARE add_discussion_answer_id_column_statement;

CREATE TABLE IF NOT EXISTS feedback_answer_drafts (
  request_id INT NOT NULL PRIMARY KEY,
  giver_id INT NOT NULL,
  answers JSON NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES feedback_requests(id),
  FOREIGN KEY (giver_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS feedback_request_attachments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  added_by INT NOT NULL,
  label VARCHAR(160) NOT NULL,
  url VARCHAR(2048) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES feedback_requests(id),
  FOREIGN KEY (added_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS feedback_follow_ups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  details TEXT NOT NULL,
  owner_id INT NOT NULL,
  due_date DATE NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  progress_note TEXT NULL,
  completed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES feedback_requests(id),
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS feedback_follow_up_participants (
  follow_up_id INT NOT NULL,
  user_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (follow_up_id, user_id),
  FOREIGN KEY (follow_up_id) REFERENCES feedback_follow_ups(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS feedback_request_viewers (
  request_id INT NOT NULL,
  user_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (request_id, user_id),
  FOREIGN KEY (request_id) REFERENCES feedback_requests(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE OR REPLACE VIEW feedback_request_details AS
SELECT
  request.id,
  requester.name AS requester_name,
  giver.name AS giver_name,
  template.name AS feedback_type,
  request.message,
  request.due_date,
  request.purpose,
  request.visibility,
  request.status,
  request.created_at
FROM feedback_requests AS request
JOIN users AS requester ON requester.id = request.requester_id
JOIN users AS giver ON giver.id = request.giver_id
JOIN feedback_templates AS template ON template.id = request.template_id;

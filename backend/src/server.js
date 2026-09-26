import "dotenv/config";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";

import healthRouter from "./routes/healthRoutes.js";
import authRouter from "./routes/authRoutes.js";
import feedbackRequestRouter from "./routes/feedbackRequestRoutes.js";
import templateRouter from "./routes/templateRoutes.js";
import userRouter from "./routes/userRoutes.js";
import notificationRouter from "./routes/notificationRoutes.js";
import feedbackReportRouter from "./routes/feedbackReportRoutes.js";
import feedbackAnalyticsRouter from "./routes/feedbackAnalyticsRoutes.js";
import { startFeedbackReminderJob } from "./jobs/feedbackReminderJob.js";
import { getDatabasePool } from "./db/connection.js";
import { ensureBuiltInTemplates } from "./services/templateService.js";

const app = express();
const port = process.env.PORT || 5000;
// Allow the local Next.js dev server even if it automatically uses 3001/3002
// because another development server is already running. Production should set
// FRONTEND_ORIGIN to its exact deployed URL.
const localDevelopmentOrigins = Array.from(
  { length: 11 },
  (_, index) => `http://localhost:${3000 + index}`,
);
const configuredOrigins = [
  ...localDevelopmentOrigins,
  ...(process.env.FRONTEND_ORIGIN || "").split(","),
]
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || configuredOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("This frontend origin is not allowed by CORS."));
    },
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json());

app.use("/health", healthRouter);
app.use("/auth", authRouter);
app.use("/users", userRouter);
app.use("/notifications", notificationRouter);
app.use("/feedback-reports", feedbackReportRouter);
app.use("/feedback-analytics", feedbackAnalyticsRouter);
app.use("/templates", templateRouter);
app.use("/feedback-requests", feedbackRequestRouter);

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

async function startServer() {
  // Keep the password-reuse safeguard available for both new and existing databases.
  await getDatabasePool().execute(
    `CREATE TABLE IF NOT EXISTS password_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_password_history_user_id (user_id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
  );

  // Drafts never change a request into submitted feedback.
  await getDatabasePool().execute(
    `CREATE TABLE IF NOT EXISTS feedback_answer_drafts (
      request_id INT NOT NULL PRIMARY KEY,
      giver_id INT NOT NULL,
      answers JSON NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (request_id) REFERENCES feedback_requests(id),
      FOREIGN KEY (giver_id) REFERENCES users(id)
    )`,
  );

  // Blocked content attempts are tracked without storing the private text.
  await getDatabasePool().execute(
    `CREATE TABLE IF NOT EXISTS feedback_policy_audit_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      actor_id INT NOT NULL,
      request_id INT NULL,
      event_type VARCHAR(100) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_policy_audit_actor (actor_id),
      INDEX idx_policy_audit_request (request_id),
      FOREIGN KEY (actor_id) REFERENCES users(id),
      FOREIGN KEY (request_id) REFERENCES feedback_requests(id)
    )`,
  );

  // A request keeps the exact questions that were selected when it was created.
  // Later template improvements must apply only to future requests.
  await getDatabasePool().execute(
    `CREATE TABLE IF NOT EXISTS feedback_request_questions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      request_id INT NOT NULL,
      template_question_id INT NOT NULL,
      question_text TEXT NOT NULL,
      question_type VARCHAR(30) NOT NULL DEFAULT 'long_text',
      options_json JSON NULL,
      is_required BOOLEAN NOT NULL DEFAULT TRUE,
      validation_json JSON NULL,
      question_order INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_request_question (request_id, template_question_id),
      INDEX idx_request_question_order (request_id, question_order),
      FOREIGN KEY (request_id) REFERENCES feedback_requests(id),
      FOREIGN KEY (template_question_id) REFERENCES template_questions(id)
    )`,
  );

  for (const [columnName, alterSql] of [
    ["question_type", "ALTER TABLE template_questions ADD COLUMN question_type VARCHAR(30) NOT NULL DEFAULT 'long_text' AFTER question_text"],
    ["options_json", "ALTER TABLE template_questions ADD COLUMN options_json JSON NULL AFTER question_type"],
    ["is_required", "ALTER TABLE template_questions ADD COLUMN is_required BOOLEAN NOT NULL DEFAULT TRUE AFTER options_json"],
    ["validation_json", "ALTER TABLE template_questions ADD COLUMN validation_json JSON NULL AFTER is_required"],
  ]) {
    const [[column]] = await getDatabasePool().execute(
      `SELECT COUNT(*) AS count FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'template_questions' AND column_name = ?`,
      [columnName],
    );
    if (!column.count) await getDatabasePool().execute(alterSql);
  }

  for (const [columnName, alterSql] of [
    ["question_type", "ALTER TABLE feedback_request_questions ADD COLUMN question_type VARCHAR(30) NOT NULL DEFAULT 'long_text' AFTER question_text"],
    ["options_json", "ALTER TABLE feedback_request_questions ADD COLUMN options_json JSON NULL AFTER question_type"],
    ["is_required", "ALTER TABLE feedback_request_questions ADD COLUMN is_required BOOLEAN NOT NULL DEFAULT TRUE AFTER options_json"],
    ["validation_json", "ALTER TABLE feedback_request_questions ADD COLUMN validation_json JSON NULL AFTER is_required"],
  ]) {
    const [[column]] = await getDatabasePool().execute(
      `SELECT COUNT(*) AS count FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'feedback_request_questions' AND column_name = ?`,
      [columnName],
    );
    if (!column.count) await getDatabasePool().execute(alterSql);
  }

  // Requests created before question snapshots were introduced keep their
  // already-existing questions. This runs before built-in templates are updated.
  await getDatabasePool().execute(
    `INSERT INTO feedback_request_questions
       (request_id, template_question_id, question_text, question_type, options_json, is_required, validation_json, question_order)
     SELECT request.id, question.id, question.question_text, question.question_type, question.options_json, question.is_required, question.validation_json, question.question_order
     FROM feedback_requests AS request
     JOIN template_questions AS question ON question.template_id = request.template_id
     WHERE NOT EXISTS (
       SELECT 1 FROM feedback_request_questions AS snapshot
       WHERE snapshot.request_id = request.id
     )`,
  );

  const [[ratingColumn]] = await getDatabasePool().execute(
    `SELECT COUNT(*) AS count FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'feedback_answers' AND column_name = 'rating'`,
  );
  if (!ratingColumn.count) {
    await getDatabasePool().execute("ALTER TABLE feedback_answers ADD COLUMN rating TINYINT NULL AFTER answer");
  }

  const [[submittedAtColumn]] = await getDatabasePool().execute(
    `SELECT COUNT(*) AS count FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'feedback_requests' AND column_name = 'submitted_at'`,
  );
  if (!submittedAtColumn.count) {
    await getDatabasePool().execute("ALTER TABLE feedback_requests ADD COLUMN submitted_at TIMESTAMP NULL AFTER status");
  }

  const [[directFeedbackColumn]] = await getDatabasePool().execute(
    `SELECT COUNT(*) AS count FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'feedback_requests' AND column_name = 'is_direct'`,
  );
  if (!directFeedbackColumn.count) {
    await getDatabasePool().execute("ALTER TABLE feedback_requests ADD COLUMN is_direct BOOLEAN NOT NULL DEFAULT FALSE AFTER is_anonymous");
  }

  const [[discussionAnswerColumn]] = await getDatabasePool().execute(
    `SELECT COUNT(*) AS count FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'feedback_discussions' AND column_name = 'answer_id'`,
  );
  if (!discussionAnswerColumn.count) {
    await getDatabasePool().execute("ALTER TABLE feedback_discussions ADD COLUMN answer_id INT NULL AFTER request_id");
  }

  await getDatabasePool().execute(
    `CREATE TABLE IF NOT EXISTS feedback_request_attachments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      request_id INT NOT NULL,
      added_by INT NOT NULL,
      label VARCHAR(160) NOT NULL,
      url VARCHAR(2048) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (request_id) REFERENCES feedback_requests(id),
      FOREIGN KEY (added_by) REFERENCES users(id)
    )`,
  );

  // Built-in templates have no owner. Templates made through the app keep their
  // creator so that people can manage only their own reusable templates.
  const [[templateOwnerColumn]] = await getDatabasePool().execute(
    `SELECT COUNT(*) AS count FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'feedback_templates' AND column_name = 'created_by'`,
  );
  if (!templateOwnerColumn.count) {
    await getDatabasePool().execute("ALTER TABLE feedback_templates ADD COLUMN created_by INT NULL AFTER description");
  }

  await ensureBuiltInTemplates();

  app.listen(port, () => {
    console.log(`Feedback Process API running at http://localhost:${port}`);
    startFeedbackReminderJob();
  });
}

startServer().catch((error) => {
  console.error("Feedback Process API could not start:", error);
  process.exitCode = 1;
});

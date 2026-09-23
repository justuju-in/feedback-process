import nodemailer from "nodemailer";

import { ServiceError } from "../services/serviceError.js";

function getEmailConfiguration() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM || user;

  if (!host || !user || !password || !from) {
    throw new ServiceError(500, "Email service is not configured on the server");
  }

  return { host, port, user, password, from };
}

function createEmailTransporter(configuration) {
  return nodemailer.createTransport({
    host: configuration.host,
    port: configuration.port,
    secure: configuration.port === 465,
    auth: {
      user: configuration.user,
      pass: configuration.password,
    },
  });
}

export async function sendPasswordResetEmail({ email, name, resetUrl }) {
  const configuration = getEmailConfiguration();
  const transporter = createEmailTransporter(configuration);

  await transporter.sendMail({
    from: `Feedback Process <${configuration.from}>`,
    to: email,
    subject: "Reset your Feedback Process password",
    text: `Hi ${name || "there"},\n\nUse this link to reset your password:\n${resetUrl}\n\nThis link expires in 15 minutes and can be used only once. If you did not request this, you can ignore this email.`,
    html: `
      <p>Hi ${name || "there"},</p>
      <p>Use the link below to reset your Feedback password:</p>
      <p><a href="${resetUrl}">Reset your password</a></p>
      <p>This link expires in 15 minutes and can be used only once.</p>
      <p>If you did not request this, you can ignore this email.</p>
    `,
  });
}

export async function sendEmailVerificationEmail({ email, name, verificationUrl }) {
  const configuration = getEmailConfiguration();
  const transporter = createEmailTransporter(configuration);
  await transporter.sendMail({
    from: `Feedback <${configuration.from}>`,
    to: email,
    subject: "Verify your Feedback email address",
    text: `Hi ${name || "there"},\n\nVerify your email to activate your Feedback account:\n${verificationUrl}\n\nThis link expires in 24 hours.`,
    html: `<p>Hi ${name || "there"},</p><p>Verify your email to activate your Feedback account.</p><p><a href="${verificationUrl}">Verify email</a></p><p>This link expires in 24 hours.</p>`,
  });
}

// Operational feedback emails are deliberately best-effort. A temporary SMTP
// problem must never prevent a person from creating or completing feedback.
export async function sendFeedbackEmail({ email, name, subject, message, actionUrl }) {
  const configuration = getEmailConfiguration();
  const transporter = createEmailTransporter(configuration);
  const safeMessage = String(message || "");
  const linkMarkup = actionUrl ? `<p><a href="${actionUrl}">Open Feedback Process</a></p>` : "";
  await transporter.sendMail({
    from: `Feedback Process <${configuration.from}>`,
    to: email,
    subject,
    text: `Hi ${name || "there"},\n\n${safeMessage}${actionUrl ? `\n\nOpen Feedback Process: ${actionUrl}` : ""}`,
    html: `<p>Hi ${name || "there"},</p><p>${safeMessage}</p>${linkMarkup}`,
  });
}


export async function sendSafetyReportEmail({ id, requestId, reason }) {
  const recipient = process.env.SC_REPORT_EMAIL;
  if (!recipient) {
    return { sent: false, reason: "SC_REPORT_EMAIL is not configured" };
  }

  const configuration = getEmailConfiguration();
  const transporter = createEmailTransporter(configuration);
  await transporter.sendMail({
    from: `Feedback Process <${configuration.from}>`,
    to: recipient,
    subject: `[Action required] Feedback safety report #${id}`,
    text: `A confidential feedback safety report requires review.\n\nReport: #${id}\nFeedback request: #${requestId}\nCategory: ${reason}\n\nSign in to Feedback Process to review it. This alert intentionally does not include private feedback answers.`,
  });
  return { sent: true };
}

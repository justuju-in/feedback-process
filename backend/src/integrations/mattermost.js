import { getPrimaryFrontendOrigin } from "../config/frontendOrigin.js";

function getMattermostUsername(name) {
  const username = name?.trim().split(/\s+/)[0]?.toLowerCase();
  return username ? username.replace(/[^a-zA-Z0-9._-]/g, "") : null;
}

function getFeedbackRequestLink(feedbackRequest) {
  if (!feedbackRequest?.id) return null;
  return `${getPrimaryFrontendOrigin().replace(/\/$/, "")}/?requestId=${encodeURIComponent(feedbackRequest.id)}`;
}

function addFeedbackRequestLink(message, feedbackRequest) {
  const requestLink = getFeedbackRequestLink(feedbackRequest);
  return requestLink ? `${message}\n\n[Open feedback request](${requestLink})` : message;
}

function getMattermostApiConfig() {
  const baseUrl = process.env.MATTERMOST_URL?.trim().replace(/\/$/, "");
  const token = process.env.MATTERMOST_BOT_TOKEN?.trim();
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

function hasMattermostBotSettings() {
  return Boolean(
    process.env.MATTERMOST_URL?.trim() || process.env.MATTERMOST_BOT_TOKEN?.trim(),
  );
}

let botUserId;
const userIdByEmail = new Map();

async function callMattermostApi(config, path, options = {}) {
  const response = await fetch(`${config.baseUrl}/api/v4${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Mattermost bot API failed (${response.status}): ${responseText}`);
  }

  return response.json();
}

async function getBotUserId(config) {
  if (botUserId) return botUserId;
  const bot = await callMattermostApi(config, "/users/me");
  botUserId = bot.id;
  return botUserId;
}

async function getMattermostUserIdByEmail(config, email) {
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error("Feedback user has no email address for Mattermost DM");
  }
  if (userIdByEmail.has(normalizedEmail)) return userIdByEmail.get(normalizedEmail);

  const user = await callMattermostApi(
    config,
    `/users/email/${encodeURIComponent(normalizedEmail)}`,
  );
  userIdByEmail.set(normalizedEmail, user.id);
  return user.id;
}

async function sendPrivateMattermostMessage({ email, text }) {
  const config = getMattermostApiConfig();
  if (!config) {
    // Once private delivery has been selected, never expose a notification in
    // the old shared channel because a token was missing or misconfigured.
    if (hasMattermostBotSettings()) {
      throw new Error("Mattermost private bot settings are incomplete");
    }
    return null;
  }

  const [botId, userId] = await Promise.all([
    getBotUserId(config),
    getMattermostUserIdByEmail(config, email),
  ]);
  const directChannel = await callMattermostApi(config, "/channels/direct", {
    method: "POST",
    body: JSON.stringify([botId, userId]),
  });
  await callMattermostApi(config, "/posts", {
    method: "POST",
    body: JSON.stringify({ channel_id: directChannel.id, message: text }),
  });
  return { sent: true, delivery: "direct-message" };
}

async function sendMattermostMessage(text, webhookUrl = process.env.MATTERMOST_WEBHOOK_URL) {

  if (!webhookUrl) {
    return { sent: false, reason: "MATTERMOST_WEBHOOK_URL is not configured" };
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Mattermost webhook failed (${response.status}): ${responseText}`,
    );
  }

  return { sent: true };
}

export async function sendFeedbackReportNotification(report, scRecipientEmails = []) {
  const reasonLabels = {
    rude: "Rude or disrespectful",
    harassment: "Harassment or bullying",
    discrimination: "Discrimination",
    inappropriate: "Inappropriate content",
    other: "Other concern",
  };
  const message =
    `:warning: **Feedback safety report received**\n` +
      `Report #${report.id} · Feedback request #${report.requestId}\n` +
      `Reason: **${reasonLabels[report.reason] || report.reason}**\n` +
      "Please review this privately in Feedback Process → SC Team Review. " +
      "This alert does not include feedback answers.";

  // When the private Mattermost bot is configured, reports must go only to
  // active SC Team reviewers—not a shared channel, admins, or other members.
  if (getMattermostApiConfig()) {
    const recipientEmails = [...new Set(scRecipientEmails
      .map((email) => email?.trim().toLowerCase())
      .filter(Boolean))];
    if (!recipientEmails.length) {
      return { sent: false, reason: "No active SC Team recipients are configured" };
    }

    const deliveries = await Promise.allSettled(recipientEmails.map((email) =>
      sendPrivateMattermostMessage({ email, text: message }),
    ));
    const sentCount = deliveries.filter((delivery) => delivery.status === "fulfilled").length;
    if (!sentCount) {
      const firstFailure = deliveries.find((delivery) => delivery.status === "rejected");
      throw firstFailure?.reason || new Error("SC Team Mattermost notification failed");
    }
    return { sent: true, delivery: "direct-message", recipientCount: sentCount };
  }

  const webhookUrl = process.env.SC_MATTERMOST_WEBHOOK_URL;
  if (!webhookUrl) {
    return { sent: false, reason: "SC Mattermost notifications are not configured" };
  }
  return sendMattermostMessage(message, webhookUrl);
}

export async function sendFeedbackRequestNotification(feedbackRequest) {
  const message = addFeedbackRequestLink(
    `**${feedbackRequest.requesterName}** requested **${feedbackRequest.templateName}** from you.`,
    feedbackRequest,
  );
  const directMessage = await sendPrivateMattermostMessage({
    email: feedbackRequest.giverEmail,
    text: message,
  });
  if (directMessage) return directMessage;

  const giverUsername = getMattermostUsername(feedbackRequest.giverName);

  if (!giverUsername) {
    return { sent: false, reason: "Feedback giver has no Mattermost username" };
  }

  return sendMattermostMessage(
    `@${giverUsername}, ${message}`,
  );
}

export async function sendFeedbackSubmittedNotification(feedbackRequest) {
  // A direct-feedback giver is also stored as the requester for audit/history,
  // but the person who must be alerted is the feedback receiver.
  const notificationRecipientName = feedbackRequest.isDirect
    ? feedbackRequest.receiverName
    : feedbackRequest.requesterName;
  const notificationRecipientEmail = feedbackRequest.isDirect
    ? feedbackRequest.receiverEmail
    : feedbackRequest.requesterEmail;
  const message = addFeedbackRequestLink(
    `**${feedbackRequest.isAnonymous ? "Anonymous feedback" : feedbackRequest.giverName}** was submitted for your ` +
      `**${feedbackRequest.templateName}**.`,
    feedbackRequest,
  );
  const directMessage = await sendPrivateMattermostMessage({
    email: notificationRecipientEmail,
    text: message,
  });
  if (directMessage) return directMessage;

  const requesterUsername = getMattermostUsername(notificationRecipientName);

  if (!requesterUsername) {
    return { sent: false, reason: "Requester has no Mattermost username" };
  }

  return sendMattermostMessage(
    `@${requesterUsername}, ${message}`,
  );
}

export async function sendFeedbackDueSoonNotification(feedbackRequest) {
  const message = addFeedbackRequestLink(
    `Reminder: **${feedbackRequest.templateName}** feedback for ` +
      `**${feedbackRequest.receiverName}** is due tomorrow (${feedbackRequest.dueDate}).`,
    feedbackRequest,
  );
  const directMessage = await sendPrivateMattermostMessage({
    email: feedbackRequest.giverEmail,
    text: message,
  });
  if (directMessage) return directMessage;

  const giverUsername = getMattermostUsername(feedbackRequest.giverName);
  if (!giverUsername) {
    return { sent: false, reason: "Feedback giver has no Mattermost username" };
  }

  return sendMattermostMessage(
    `@${giverUsername}, ${message}`,
  );
}

export async function sendFeedbackDueTodayNotification(feedbackRequest) {
  const message = addFeedbackRequestLink(
    `Reminder: **${feedbackRequest.templateName}** feedback for ` +
      `**${feedbackRequest.receiverName}** is due today (${feedbackRequest.dueDate}).`,
    feedbackRequest,
  );
  const directMessage = await sendPrivateMattermostMessage({
    email: feedbackRequest.giverEmail,
    text: message,
  });
  if (directMessage) return directMessage;

  const giverUsername = getMattermostUsername(feedbackRequest.giverName);
  if (!giverUsername) {
    return { sent: false, reason: "Feedback giver has no Mattermost username" };
  }

  return sendMattermostMessage(
    `@${giverUsername}, ${message}`,
  );
}

export async function sendFeedbackDueDateChangedNotification(feedbackRequest) {
  const deadline = feedbackRequest.dueDate || "no due date";
  const message = addFeedbackRequestLink(
    `**${feedbackRequest.requesterName}** changed the deadline for ` +
      `**${feedbackRequest.templateName}** feedback to **${deadline}**.`,
    feedbackRequest,
  );
  const directMessage = await sendPrivateMattermostMessage({
    email: feedbackRequest.giverEmail,
    text: message,
  });
  if (directMessage) return directMessage;

  const giverUsername = getMattermostUsername(feedbackRequest.giverName);
  if (!giverUsername) {
    return { sent: false, reason: "Feedback giver has no Mattermost username" };
  }

  return sendMattermostMessage(
    `@${giverUsername}, ${message}`,
  );
}

export async function sendFeedbackOverdueNotification(feedbackRequest) {
  const message = addFeedbackRequestLink(
    `**${feedbackRequest.templateName}** feedback for ` +
      `**${feedbackRequest.receiverName}** is overdue (due ${feedbackRequest.dueDate}). ` +
      "Please submit it or contact the requester.",
    feedbackRequest,
  );
  const directMessage = await sendPrivateMattermostMessage({
    email: feedbackRequest.giverEmail,
    text: message,
  });
  if (directMessage) return directMessage;

  const giverUsername = getMattermostUsername(feedbackRequest.giverName);
  if (!giverUsername) {
    return { sent: false, reason: "Feedback giver has no Mattermost username" };
  }

  return sendMattermostMessage(
    `@${giverUsername}, ${message}`,
  );
}

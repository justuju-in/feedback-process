function getMattermostUsername(name) {
  const username = name?.trim().split(/\s+/)[0]?.toLowerCase();
  return username ? username.replace(/[^a-zA-Z0-9._-]/g, "") : null;
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

export async function sendFeedbackReportNotification(report) {
  const webhookUrl = process.env.SC_MATTERMOST_WEBHOOK_URL;
  if (!webhookUrl) {
    return { sent: false, reason: "SC_MATTERMOST_WEBHOOK_URL is not configured" };
  }

  const reasonLabels = {
    rude: "Rude or disrespectful",
    harassment: "Harassment or bullying",
    discrimination: "Discrimination",
    inappropriate: "Inappropriate content",
    other: "Other concern",
  };
  return sendMattermostMessage(
    `:warning: **Feedback safety report received**\n` +
      `Report #${report.id} · Feedback request #${report.requestId}\n` +
      `Reason: **${reasonLabels[report.reason] || report.reason}**\n` +
      `Please review this privately in Feedback.`,
    webhookUrl,
  );
}

export async function sendFeedbackRequestNotification(feedbackRequest) {
  const giverUsername = getMattermostUsername(feedbackRequest.giverName);

  if (!giverUsername) {
    return { sent: false, reason: "Feedback giver has no Mattermost username" };
  }

  return sendMattermostMessage(
    `@${giverUsername}, **${feedbackRequest.requesterName}** requested ` +
      `**${feedbackRequest.templateName}** from you.`,
  );
}

export async function sendFeedbackSubmittedNotification(feedbackRequest) {
  // A direct-feedback giver is also stored as the requester for audit/history,
  // but the person who must be alerted is the feedback receiver.
  const notificationRecipientName = feedbackRequest.isDirect
    ? feedbackRequest.receiverName
    : feedbackRequest.requesterName;
  const requesterUsername = getMattermostUsername(notificationRecipientName);

  if (!requesterUsername) {
    return { sent: false, reason: "Requester has no Mattermost username" };
  }

  return sendMattermostMessage(
    `@${requesterUsername}, **${feedbackRequest.isAnonymous ? "Anonymous feedback" : feedbackRequest.giverName}** was submitted for your ` +
      `**${feedbackRequest.templateName}**. Open Feedback and select ` +
      `**View** to read the feedback.`,
  );
}

export async function sendFeedbackDueSoonNotification(feedbackRequest) {
  const giverUsername = getMattermostUsername(feedbackRequest.giverName);
  if (!giverUsername) {
    return { sent: false, reason: "Feedback giver has no Mattermost username" };
  }

  return sendMattermostMessage(
    `@${giverUsername}, reminder: **${feedbackRequest.templateName}** feedback for ` +
      `**${feedbackRequest.receiverName}** is due tomorrow (${feedbackRequest.dueDate}).`,
  );
}

export async function sendFeedbackDueTodayNotification(feedbackRequest) {
  const giverUsername = getMattermostUsername(feedbackRequest.giverName);
  if (!giverUsername) {
    return { sent: false, reason: "Feedback giver has no Mattermost username" };
  }

  return sendMattermostMessage(
    `@${giverUsername}, reminder: **${feedbackRequest.templateName}** feedback for ` +
      `**${feedbackRequest.receiverName}** is due today (${feedbackRequest.dueDate}).`,
  );
}

export async function sendFeedbackDueDateChangedNotification(feedbackRequest) {
  const giverUsername = getMattermostUsername(feedbackRequest.giverName);
  if (!giverUsername) {
    return { sent: false, reason: "Feedback giver has no Mattermost username" };
  }

  const deadline = feedbackRequest.dueDate || "no due date";
  return sendMattermostMessage(
    `@${giverUsername}, **${feedbackRequest.requesterName}** changed the deadline for ` +
      `**${feedbackRequest.templateName}** feedback to **${deadline}**.`,
  );
}

export async function sendFeedbackOverdueNotification(feedbackRequest) {
  const giverUsername = getMattermostUsername(feedbackRequest.giverName);
  if (!giverUsername) {
    return { sent: false, reason: "Feedback giver has no Mattermost username" };
  }

  return sendMattermostMessage(
    `@${giverUsername}, **${feedbackRequest.templateName}** feedback for ` +
      `**${feedbackRequest.receiverName}** is overdue (due ${feedbackRequest.dueDate}). Please submit it or contact the requester.`,
  );
}

/**
 * Dispatch in-app notifications using admin-configured routing rules.
 */
const routingConfig = require("./notification-routing-config");
const notifyStore = require("./notify-store");

async function dispatchNotification({
  actionKey,
  title,
  body,
  entityType,
  entityId,
  actor,
  context,
  type,
}) {
  const users = await routingConfig.getRecipients(actionKey, { actor, context });
  if (!users.length) return [];
  return notifyStore.createNotificationsForUsers(users, {
    type: type || actionKey,
    title,
    body: body || "",
    entityType: entityType || actionKey,
    entityId: entityId || "",
  });
}

module.exports = { dispatchNotification };

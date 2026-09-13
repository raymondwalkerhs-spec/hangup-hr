const { dispatchNotification } = require("./notify-dispatch");

async function notifyOfficePo(actionKey, { title, body, entityId, actor, company }) {
  try {
    await dispatchNotification({
      actionKey,
      title,
      body,
      entityType: "office_po",
      entityId: entityId || null,
      actor: actor || null,
      context: { company: company || "hangup" },
    });
  } catch (err) {
    console.warn("[office-po-notify]", actionKey, err.message);
  }
}

module.exports = {
  notifyOfficePo,
};

/**
 * Audit notification routing — Raymond receives unusual edits; Mark never notified.
 */
const notify = require("./notify-store");
const { getSupabaseAdmin } = require("./supabase-client");

const AUDIT_ADMIN = "raymond";
const CEO_USERNAME = "mark";
const HR_DIRECTOR = "phoebe";
const HR_OFFICERS = ["eva", "aurora"];

const HR_DOMAIN_ACTIONS = new Set([
  "leave_edit",
  "leave_delete",
  "leave_late",
  "leave_tl_request",
  "employee_stub_delete",
  "position_delete",
  "holiday_import",
]);

function uniqueUsers(list) {
  return [...new Set(list.map((u) => String(u || "").trim().toLowerCase()).filter(Boolean))];
}

function auditRecipients({ actor, action, includeHr = false }) {
  const a = String(actor || "").trim().toLowerCase();
  const recipients = [AUDIT_ADMIN];
  if (includeHr || HR_DOMAIN_ACTIONS.has(action)) {
    recipients.push(HR_DIRECTOR, ...HR_OFFICERS);
  }
  return uniqueUsers(recipients).filter((u) => u !== a && u !== CEO_USERNAME);
}

async function auditNotify({ actor, action, title, body, entityType, entityId, includeHr = false }) {
  const users = auditRecipients({ actor, action, includeHr });
  if (!users.length) return;
  await notify.createNotificationsForUsers(users, {
    type: "audit",
    title: title || "System audit",
    body: body || "",
    entityType: entityType || action,
    entityId: entityId || "",
  });
}

async function hrWarning({ actor, title, body, entityType, entityId }) {
  const users = uniqueUsers([HR_DIRECTOR, ...HR_OFFICERS, AUDIT_ADMIN]).filter(
    (u) => u !== String(actor || "").toLowerCase() && u !== CEO_USERNAME
  );
  if (!users.length) return;
  await notify.createNotificationsForUsers(users, {
    type: "hr_warning",
    title,
    body,
    entityType,
    entityId,
  });
}

async function resolveUsernamesForEmployees(employeeIds = []) {
  const ids = [...new Set((employeeIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await getSupabaseAdmin()
    .from("app_users")
    .select("username, employee_id")
    .in("employee_id", ids);
  if (error) return [];
  return [...new Set((data || []).map((r) => String(r.username || "").trim().toLowerCase()).filter(Boolean))];
}

async function notifySaleAssignment({ sale, type, title, body, employeeIds = [] }) {
  const users = await resolveUsernamesForEmployees(employeeIds);
  if (!users.length) return;
  await notify.createNotificationsForUsers(users, {
    type,
    title,
    body,
    entityType: "sale",
    entityId: sale.id,
  });
}

module.exports = {
  auditNotify,
  hrWarning,
  auditRecipients,
  AUDIT_ADMIN,
  CEO_USERNAME,
  resolveUsernamesForEmployees,
  notifySaleAssignment,
};

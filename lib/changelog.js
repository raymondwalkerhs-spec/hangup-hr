const { useSupabase } = require("./backend");
const { getSupabaseAdmin } = require("./supabase-client");
const sheets = require("./sheets");
const logSheet = require("./log-sheet");

const CHANGE_LOG_HEADERS = [
  "timestamp",
  "username",
  "entity",
  "entity_id",
  "action",
  "field",
  "old_value",
  "new_value",
  "summary",
];

const TAB = "Change_Log";

async function ensureChangeLogTab() {
  await sheets.ensureTabPublic(TAB, CHANGE_LOG_HEADERS);
}

async function logChange(entry) {
  const row = {
    timestamp: entry.timestamp || new Date().toISOString(),
    username: entry.username || "system",
    entity: entry.entity || "",
    entity_id: entry.entityId || "",
    action: entry.action || "update",
    field: entry.field || "*",
    old_value: entry.oldValue != null ? String(entry.oldValue) : "",
    new_value: entry.newValue != null ? String(entry.newValue) : "",
    summary: entry.summary || "",
  };

  if (useSupabase()) {
    const { error } = await getSupabaseAdmin().from("change_log").insert(row);
    if (error) console.warn("Supabase change_log write failed:", error.message);
    return;
  }

  await ensureChangeLogTab();
  const a = await sheets.getAuthClient();
  const client = sheets.getSheetsApi(a);
  await client.spreadsheets.values.append({
    spreadsheetId: sheets.SHEET_ID,
    range: `${TAB}!A:I`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [
        [
          row.timestamp,
          row.username,
          row.entity,
          row.entity_id,
          row.action,
          row.field,
          row.old_value,
          row.new_value,
          row.summary,
        ],
      ],
    },
  });
  await logSheet.appendLogEntry({
    timestamp: row.timestamp,
    username: row.username,
    entity: row.entity,
    entityId: row.entity_id,
    action: row.action,
    field: row.field,
    oldValue: row.old_value,
    newValue: row.new_value,
    summary: row.summary,
  });
}

async function logEmployeeChange(username, action, emp, oldEmp, field) {
  const summary =
    action === "create"
      ? `Created employee ${emp.id} (${emp.american_name || emp.arabic_name || ""})`
      : action === "delete"
        ? `Removed employee ${emp.id}`
        : `Updated employee ${emp.id}: ${field} ${oldEmp?.[field] ?? ""} → ${emp[field] ?? ""}`;
  await logChange({
    username,
    entity: "employee",
    entityId: emp.id,
    action,
    field: field || "*",
    oldValue: oldEmp ? oldEmp[field] : "",
    newValue: emp[field],
    summary,
  });
}

async function logAttendanceChange(username, action, record, oldStatus) {
  const key = `${record.employeeId}|${record.date}`;
  await logChange({
    username,
    entity: "attendance",
    entityId: key,
    action,
    field: "status",
    oldValue: oldStatus || "",
    newValue: record.status || "",
    summary: `${action} attendance ${key}: ${oldStatus || "—"} → ${record.status || "—"}`,
  });
}

async function logBonusChange(username, action, record) {
  await logChange({
    username,
    entity: "bonus",
    entityId: `${record.employeeId}|${record.date}|${record.type}`,
    action,
    field: "amount",
    newValue: record.amount,
    summary: `${action} bonus ${record.type} ${record.amount} EGP for ${record.employeeId}`,
  });
}

async function logDeductionChange(username, action, record) {
  await logChange({
    username,
    entity: "deduction",
    entityId: `${record.employeeId}|${record.date}|${record.type}`,
    action,
    field: "amount",
    newValue: record.amount,
    summary: `${action} deduction ${record.type} ${record.amount} EGP for ${record.employeeId}`,
  });
}

async function logConfigChange(username, key, oldVal, newVal) {
  await logChange({
    username,
    entity: "config",
    entityId: key,
    action: "update",
    field: key,
    oldValue: typeof oldVal === "object" ? JSON.stringify(oldVal) : oldVal,
    newValue: typeof newVal === "object" ? JSON.stringify(newVal) : newVal,
    summary: `Config ${key} updated`,
  });
}

async function logWarningChange(username, action, warning) {
  await logChange({
    username,
    entity: "warning",
    entityId: `${warning.employeeId}|${warning.id}`,
    action,
    field: "content",
    newValue: warning.content,
    summary: `${action} ${warning.type} for ${warning.employeeId}: ${warning.title}`,
  });
}

async function logMonthProfileChange(username, action, profile, field) {
  await logChange({
    username,
    entity: "month_profile",
    entityId: `${profile.employeeId}|${profile.yearMonth}`,
    action,
    field: field || "*",
    newValue: typeof profile === "object" ? JSON.stringify(profile) : profile,
    summary: `${action} month profile ${profile.employeeId} ${profile.yearMonth}`,
  });
}

async function readChangeLog(opts) {
  if (useSupabase()) {
    return readChangeLogFromSupabase(opts);
  }
  const fromLogSheet = await logSheet.readLogEntries(opts);
  if (fromLogSheet.length) return fromLogSheet;
  return readChangeLogFromMain(opts);
}

async function readChangeLogFromSupabase({ limit = 100, entity, username, month } = {}) {
  let q = getSupabaseAdmin().from("change_log").select("*").order("timestamp", { ascending: false }).limit(limit);
  const { data, error } = await q;
  if (error) {
    console.warn("readChangeLog:", error.message);
    return [];
  }
  let list = data || [];
  if (entity) list = list.filter((r) => r.entity === entity);
  if (username) list = list.filter((r) => r.username === username);
  if (month) list = list.filter((r) => String(r.timestamp || "").startsWith(month));
  return list.map((r) => ({
    timestamp: r.timestamp,
    username: r.username,
    entity: r.entity,
    entity_id: r.entity_id,
    action: r.action,
    field: r.field,
    old_value: r.old_value,
    new_value: r.new_value,
    summary: r.summary,
  }));
}

async function readChangeLogFromMain({ limit = 100, entity, username, month } = {}) {
  await ensureChangeLogTab();
  const rows = await sheets.readTabPublic(TAB);
  let filtered = rows;
  if (entity) filtered = filtered.filter((r) => r.entity === entity);
  if (username) filtered = filtered.filter((r) => r.username === username);
  if (month) filtered = filtered.filter((r) => String(r.timestamp || "").startsWith(month));
  return filtered.slice(-limit).reverse();
}

module.exports = {
  logChange,
  logEmployeeChange,
  logAttendanceChange,
  logBonusChange,
  logDeductionChange,
  logConfigChange,
  logWarningChange,
  logMonthProfileChange,
  readChangeLog,
};

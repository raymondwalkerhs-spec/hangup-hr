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
  await ensureChangeLogTab();
  const row = [
    entry.timestamp || new Date().toISOString(),
    entry.username || "system",
    entry.entity || "",
    entry.entityId || "",
    entry.action || "update",
    entry.field || "*",
    entry.oldValue != null ? String(entry.oldValue) : "",
    entry.newValue != null ? String(entry.newValue) : "",
    entry.summary || "",
  ];
  const a = await sheets.getAuthClient();
  const client = sheets.getSheetsApi(a);
  await client.spreadsheets.values.append({
    spreadsheetId: sheets.SHEET_ID,
    range: `${TAB}!A:I`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
  await logSheet.appendLogEntry({
    timestamp: row[0],
    username: row[1],
    entity: row[2],
    entityId: row[3],
    action: row[4],
    field: row[5],
    oldValue: row[6],
    newValue: row[7],
    summary: row[8],
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
  const fromLogSheet = await logSheet.readLogEntries(opts);
  if (fromLogSheet.length) return fromLogSheet;
  return readChangeLogFromMain(opts);
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

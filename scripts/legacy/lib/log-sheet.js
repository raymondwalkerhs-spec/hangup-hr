const { getSheetsAuth, getSheetsClient } = require("./google-auth");

const LOG_SHEET_ID = process.env.LOG_SHEET_ID || "14vcc32AvyXI6PEUPbCd5IBoTfhEirAorGX1xMI75h9Y";
const LOG_TAB = process.env.LOG_SHEET_TAB || "Change_Log";

const LOG_HEADERS = [
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

async function ensureLogTab() {
  if (!LOG_SHEET_ID) return false;
  const auth = await getSheetsAuth();
  const sheets = getSheetsClient(auth);
  const meta = await sheets.spreadsheets.get({ spreadsheetId: LOG_SHEET_ID });
  const exists = meta.data.sheets.some((s) => s.properties.title === LOG_TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: LOG_SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: LOG_TAB } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: LOG_SHEET_ID,
      range: `${LOG_TAB}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [LOG_HEADERS] },
    });
  }
  return true;
}

async function appendLogEntry(entry) {
  if (!LOG_SHEET_ID) return;
  try {
    await ensureLogTab();
    const auth = await getSheetsAuth();
    const sheets = getSheetsClient(auth);
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
    await sheets.spreadsheets.values.append({
      spreadsheetId: LOG_SHEET_ID,
      range: `${LOG_TAB}!A:I`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
  } catch (err) {
    console.warn("Log sheet write failed:", err.message);
  }
}

async function readLogEntries({ limit = 200, entity, username, month } = {}) {
  if (!LOG_SHEET_ID) return [];
  try {
    await ensureLogTab();
    const auth = await getSheetsAuth();
    const sheets = getSheetsClient(auth);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: LOG_SHEET_ID,
      range: `${LOG_TAB}!A:I`,
    });
    const rows = res.data.values || [];
    if (rows.length < 2) return [];
    const headers = rows[0].map((h) => String(h).trim());
    let list = rows.slice(1).map((row) => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] !== undefined ? row[i] : null;
      });
      return obj;
    });
    if (entity) list = list.filter((r) => r.entity === entity);
    if (username) list = list.filter((r) => r.username === username);
    if (month) list = list.filter((r) => String(r.timestamp || "").startsWith(month));
    return list.slice(-limit).reverse();
  } catch {
    return [];
  }
}

module.exports = {
  LOG_SHEET_ID,
  LOG_TAB,
  appendLogEntry,
  readLogEntries,
  ensureLogTab,
};

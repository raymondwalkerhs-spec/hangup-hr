/**
 * Canonical MLA Airtable column order from Asset/MLA AIRTABLE SHOULD BE LIKE THIS.csv
 * Template columns first; Portal extras after (never before).
 */
const fs = require("fs");
const path = require("path");
const { CSV_ATTACHMENT_COLUMNS } = require("./sales-attachment-import-config");

const TEMPLATE_CSV = path.join(__dirname, "..", "Asset", "MLA AIRTABLE SHOULD BE LIKE THIS.csv");

function parseCsvHeaderLine(line) {
  const cols = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      cols.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cols.push(cur.trim());
  return cols.filter(Boolean);
}

function loadTemplateColumns() {
  const raw = fs.readFileSync(TEMPLATE_CSV, "utf8");
  const firstLine = raw.split(/\r?\n/)[0] || "";
  return parseCsvHeaderLine(firstLine);
}

const TEMPLATE_COLUMNS = loadTemplateColumns();

/** Airtable field type specs for provisioning (template columns). */
const TEMPLATE_FIELD_TYPES = {
  "Submission Date": { type: "dateTime", options: { dateFormat: { name: "local", format: "l" }, timeFormat: { name: "12hour", format: "h:mma" }, timeZone: "client" } },
  "Date Of Birth": { type: "date", options: { dateFormat: { name: "local", format: "l" } } },
  "Monthly Billing Date": { type: "date", options: { dateFormat: { name: "local", format: "l" } } },
  "Billing Date ( If Postponed Payment": { type: "date", options: { dateFormat: { name: "local", format: "l" } } },
  "Charge Amount ( Monthly Subscription Fees ) ": { type: "singleLineText" },
  Recordings: { type: "multipleAttachments" },
  "Receipt Attachment": { type: "multipleAttachments" },
};

function fieldSpecForTemplateColumn(name) {
  if (TEMPLATE_FIELD_TYPES[name]) return { name, ...TEMPLATE_FIELD_TYPES[name] };
  if (CSV_ATTACHMENT_COLUMNS.some((c) => c.headerMatch === name)) {
    return { name, type: "multipleAttachments" };
  }
  return { name, type: "singleLineText" };
}

const PORTAL_EXTRA_COLUMNS = [
  { name: "Portal Sale ID", type: "singleLineText" },
  { name: "Routing Number", type: "singleLineText" },
  { name: "Bank Name", type: "singleLineText" },
  { name: "Bank Account Number", type: "singleLineText" },
  { name: "Bank Address", type: "multilineText" },
  { name: "Price", type: "number", options: { precision: 2 } },
  { name: "Price tier", type: "singleLineText" },
  { name: "Workflow status", type: "singleLineText" },
  { name: "Effective date", type: "date", options: { dateFormat: { name: "iso", format: "YYYY-MM-DD" } } },
  { name: "Feedback", type: "multilineText" },
  ...CSV_ATTACHMENT_COLUMNS.filter(
    (c) => !TEMPLATE_COLUMNS.includes(c.headerMatch)
  ).map((c) => ({ name: c.headerMatch, type: "multipleAttachments" })),
];

function allProvisionFields() {
  const template = TEMPLATE_COLUMNS.map(fieldSpecForTemplateColumn);
  const existing = new Set(template.map((f) => f.name));
  const extras = PORTAL_EXTRA_COLUMNS.filter((f) => !existing.has(f.name));
  return [...template, ...extras];
}

module.exports = {
  TEMPLATE_CSV,
  TEMPLATE_COLUMNS,
  PORTAL_EXTRA_COLUMNS,
  fieldSpecForTemplateColumn,
  allProvisionFields,
  parseCsvHeaderLine,
};

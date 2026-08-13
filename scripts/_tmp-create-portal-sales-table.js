#!/usr/bin/env node
/**
 * One-shot: create Portal Sales table + provision all fields.
 * Run: node scripts/_tmp-create-portal-sales-table.js
 */
require("dotenv").config();
const { CSV_TO_FORM } = require("../lib/airtable-sales-field-map");
const { CSV_ATTACHMENT_COLUMNS } = require("../lib/sales-attachment-import-config");

const META_ROOT = "https://api.airtable.com/v0/meta";
const BASE_ID = process.env.AIRTABLE_BASE_ID || "appUgvbjLhLN6SHC7";
const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || "NEW MLA";
const key = process.env.AIRTABLE_API_KEY;

const OVERRIDE_COLS = new Set([
  "If no, Is the service currently active or no? Mention the company name",
  "Alternative Phone Number",
  "Charge Amount ( Monthly Subscription Fees ) ",
  "Do you have any Medical Conditions?",
  "Assign Verifier ",
]);

function uniqueAirtableColumns() {
  const seen = new Set();
  const cols = [];
  for (const [col] of CSV_TO_FORM) {
    if (seen.has(col)) continue;
    seen.add(col);
    cols.push(col);
  }
  for (const col of OVERRIDE_COLS) {
    if (!seen.has(col)) {
      seen.add(col);
      cols.push(col);
    }
  }
  return cols;
}

function guessType(name) {
  const n = name.toLowerCase();
  if (name === "Submission Date") return { type: "dateTime", options: { timeZone: "utc", dateFormat: { name: "iso", format: "YYYY-MM-DD" }, timeFormat: { name: "24hour", format: "HH:mm" } } };
  if (name === "Date Of Birth" || name === "Effective date") return { type: "date", options: { dateFormat: { name: "iso", format: "YYYY-MM-DD" } } };
  if (name === "Billing Date") return { type: "date", options: { dateFormat: { name: "iso", format: "YYYY-MM-DD" } } };
  if (name === "Monthly Billing Date") return { type: "singleLineText" };
  if (n.includes("phone")) return { type: "phoneNumber" };
  if (name === "Card Number") return { type: "number", options: { precision: 0 } };
  if (name === "Price" || name === "Charge Amount" || name.includes("Charge Amount")) return { type: "number", options: { precision: 2 } };
  if (name === "Notes" || name === "Feedback" || name === "Quality Comments" || name === "Bank Address" || name.includes("Medical Conditions")) return { type: "multilineText" };
  if (CSV_ATTACHMENT_COLUMNS.some((c) => c.headerMatch === name)) return { type: "multipleAttachments" };
  return { type: "singleLineText" };
}

function buildFieldSpecs() {
  const specs = [{ name: "Portal Sale ID", type: "singleLineText" }];
  const cols = uniqueAirtableColumns();
  for (const col of cols) {
    if (col === "Portal Sale ID") continue;
    const def = guessType(col);
    specs.push({ name: col, ...def });
  }
  const extras = [
    { name: "Routing Number", type: "singleLineText" },
    { name: "Bank Name", type: "singleLineText" },
    { name: "Bank Account Number", type: "singleLineText" },
    { name: "Bank Address", type: "multilineText" },
    { name: "Price", type: "number", options: { precision: 2 } },
    { name: "Workflow status", type: "singleLineText" },
    { name: "Effective date", type: "date", options: { dateFormat: { name: "iso", format: "YYYY-MM-DD" } } },
    { name: "Feedback", type: "multilineText" },
    { name: "Reviewer", type: "singleLineText" },
    { name: "Assign Verifier ", type: "singleLineText" },
  ];
  for (const e of extras) {
    if (!specs.some((s) => s.name === e.name)) specs.push(e);
  }
  for (const { headerMatch } of CSV_ATTACHMENT_COLUMNS) {
    if (!specs.some((s) => s.name === headerMatch)) {
      specs.push({ name: headerMatch, type: "multipleAttachments" });
    }
  }
  return specs;
}

async function meta(method, path, body) {
  const res = await fetch(`${META_ROOT}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${data?.error?.message || res.statusText}`);
  return data;
}

async function main() {
  const tables = await meta("GET", `/bases/${BASE_ID}/tables`);
  let table = (tables.tables || []).find((t) => t.name === TABLE_NAME);

  if (!table) {
    const specs = buildFieldSpecs();
    const initial = specs.slice(0, 20);
    console.log(`Creating table "${TABLE_NAME}" with ${initial.length} initial fields...`);
    const created = await meta("POST", `/bases/${BASE_ID}/tables`, {
      name: TABLE_NAME,
      fields: initial.map((f) => {
        const out = { name: f.name, type: f.type };
        if (f.options) out.options = f.options;
        return out;
      }),
    });
    table = created;
    console.log(`Created table id=${table.id}`);

    const existing = new Set((table.fields || []).map((f) => f.name));
    const remaining = specs.filter((f) => !existing.has(f.name));
    for (const spec of remaining) {
      const body = { name: spec.name, type: spec.type };
      if (spec.options) body.options = spec.options;
      try {
        await meta("POST", `/bases/${BASE_ID}/tables/${table.id}/fields`, body);
        console.log(`  added: ${spec.name}`);
      } catch (err) {
        console.warn(`  skip ${spec.name}: ${err.message}`);
      }
    }
  } else {
    console.log(`Table "${TABLE_NAME}" already exists (${table.id})`);
    const existing = new Set((table.fields || []).map((f) => f.name));
    const specs = buildFieldSpecs();
    for (const spec of specs) {
      if (existing.has(spec.name)) {
        console.log(`  exists: ${spec.name}`);
        continue;
      }
      const body = { name: spec.name, type: spec.type };
      if (spec.options) body.options = spec.options;
      try {
        await meta("POST", `/bases/${BASE_ID}/tables/${table.id}/fields`, body);
        console.log(`  added: ${spec.name}`);
        existing.add(spec.name);
      } catch (err) {
        console.warn(`  skip ${spec.name}: ${err.message}`);
      }
    }
  }

  const final = await meta("GET", `/bases/${BASE_ID}/tables`);
  const t = (final.tables || []).find((x) => x.name === TABLE_NAME);
  console.log(`\nDone. Base=${BASE_ID} Table="${TABLE_NAME}" id=${t?.id} fields=${t?.fields?.length}`);
  console.log("Field names:", (t?.fields || []).map((f) => f.name).join(", "));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

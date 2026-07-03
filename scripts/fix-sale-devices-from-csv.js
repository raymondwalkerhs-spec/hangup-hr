#!/usr/bin/env node
/**
 * Fix sale.device + form_data.deviceType from Asset/Sales All Data.csv
 * Usage: node scripts/fix-sale-devices-from-csv.js [--dry-run]
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getSupabaseAdmin } = require("../lib/supabase-client");
const { mapDevice, parseSubmissionDate, norm, buildEmployeeIndex, findEmployee } = require("../lib/sales-import-helpers");

const CSV_PATH = path.join(__dirname, "..", "Asset", "Sales All Data.csv");
const DRY = process.argv.includes("--dry-run");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"';
        i++;
      } else if (c === '"') inQuotes = false;
      else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || (c === "\r" && next === "\n")) {
      row.push(field);
      field = "";
      if (row.some((v) => String(v).trim())) rows.push(row);
      row = [];
      if (c === "\r") i++;
    } else if (c !== "\r") field += c;
  }
  if (field || row.length) {
    row.push(field);
    if (row.some((v) => String(v).trim())) rows.push(row);
  }
  return rows;
}

function col(headers, row, name) {
  const i = headers.findIndex((h) => norm(h).includes(norm(name)));
  return i >= 0 ? row[i] : "";
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) throw new Error(`CSV not found: ${CSV_PATH}`);
  const db = getSupabaseAdmin();
  const table = parseCsv(fs.readFileSync(CSV_PATH, "utf8"));
  const headers = table[0];

  const { data: sales } = await db.from("sales").select("id,phone_number,agent_id,submission_date,device,form_data");
  const { data: employees } = await db.from("employees").select("id,american_name");
  const byName = buildEmployeeIndex(employees || []);
  const byKey = new Map();
  for (const s of sales || []) {
    const key = `${String(s.phone_number || "").replace(/\D/g, "")}|${s.agent_id}|${s.submission_date}`;
    byKey.set(key, s);
  }

  let fixed = 0;
  let unmatched = 0;

  for (const row of table.slice(1)) {
    const phone = String(col(headers, row, "Phone Number")).trim();
    const agentName = String(col(headers, row, "Agent Name")).trim();
    if (!phone || !agentName) continue;
    const emp = findEmployee(byName, employees || [], agentName);
    if (!emp) continue;
    const sub =
      parseSubmissionDate(col(headers, row, "Submission Date")) ||
      parseSubmissionDate(col(headers, row, "Billing Date"));
    if (!sub) continue;
    const deviceRaw = col(headers, row, "Device Type");
    const device = mapDevice(deviceRaw);
    const key = `${phone.replace(/\D/g, "")}|${emp.id}|${sub}`;
    const sale = byKey.get(key);
    if (!sale) {
      unmatched += 1;
      continue;
    }
    const fd = sale.form_data && typeof sale.form_data === "object" ? { ...sale.form_data } : {};
    const needsFix = sale.device !== device || fd.deviceType !== device;
    if (!needsFix) continue;
    fd.deviceType = device;
    if (!DRY) {
      await db.from("sales").update({ device, form_data: fd }).eq("id", sale.id);
    }
    fixed += 1;
    console.log(`Fix ${sale.id}: ${sale.device || fd.deviceType} → ${device} (${deviceRaw})`);
  }

  console.log(DRY ? "[dry-run] " : "", `Fixed ${fixed} sales. Unmatched CSV rows: ${unmatched}.`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

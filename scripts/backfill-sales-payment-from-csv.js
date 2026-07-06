#!/usr/bin/env node
/**
 * Backfill missing payment / card / bank fields on sales from
 * Asset/NEW Sales  - confirmation Links for migration.csv
 *
 * Matches by normalized phone + submission_date (same as import scripts).
 *
 * Usage:
 *   node scripts/backfill-sales-payment-from-csv.js --dry-run
 *   node scripts/backfill-sales-payment-from-csv.js --fix-missing-method --fix-from-notes
 *   node scripts/backfill-sales-payment-from-csv.js --overwrite --report
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getSupabaseAdmin } = require("../lib/supabase-client");
const { parseSubmissionDate } = require("../lib/sales-import-helpers");

const CSV_PATH = path.join(
  __dirname,
  "..",
  "Asset",
  "NEW Sales  - confirmation Links for migration.csv"
);
const DRY_RUN = process.argv.includes("--dry-run");
const FIX_MISSING_METHOD = process.argv.includes("--fix-missing-method");
const FIX_FROM_NOTES = process.argv.includes("--fix-from-notes");
const OVERWRITE = process.argv.includes("--overwrite");
const REPORT = process.argv.includes("--report");
const STRIP_BANK_CHOSEN = process.argv.includes("--strip-bank-chosen");
const LOG_PATH = path.join(__dirname, "..", "backfill-sales-payment-log.txt");
const AUDIT_PATH = path.join(__dirname, "..", "backfill-sales-payment-audit.txt");

const PAYMENT_FIELDS = [
  "paymentMethod",
  "cardType",
  "cardNumber",
  "cardExpDate",
  "cvv",
  "billingDate",
  "payerName",
  "routingNumber",
  "bankName",
  "bankAccountNumber",
  "bankAddress",
];

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
  if (field.length || row.length) {
    row.push(field);
    if (row.some((v) => String(v).trim())) rows.push(row);
  }
  return rows;
}

function normPhone(p) {
  return String(p || "").replace(/\D/g, "").slice(-10);
}

function mapPaymentMethod(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s || s === ".") return "";
  if (s.includes("bank card") || s === "card" || s.includes("credit") || s.includes("debit")) return "Card";
  if (s.includes("bank account") || (s.includes("bank") && !s.includes("card"))) return "Bank account";
  return "";
}

function parseBankFromNotes(notes) {
  const text = String(notes || "");
  const out = {};
  const routing = text.match(/(?:routing|routoing)\s*#?\s*:?\s*(\d{6,9})/i);
  if (routing) out.routingNumber = routing[1];
  const acct = text.match(/account\s*#?\s*:?\s*(\d{4,17})/i);
  if (acct) out.bankAccountNumber = acct[1];
  const bank = text.match(/bank\s*name\s*:?\s*([^\n,]+)/i);
  if (bank) out.bankName = bank[1].trim();
  const looseRouting = text.match(/\b(\d{9})\b(?:\s*(?:routing|routoing))?/i);
  if (!out.routingNumber && looseRouting) out.routingNumber = looseRouting[1];
  return out;
}

function inferMethodFromRow(headers, row, get) {
  let paymentMethod = mapPaymentMethod(get("Payment method"));
  if (!paymentMethod) paymentMethod = mapPaymentMethod(get("Notes"));
  const cardNumber = get("Card Number").replace(/\s/g, "");
  const cvv = get("CVV");
  if (!paymentMethod && (cardNumber || cvv)) paymentMethod = "Card";
  const notesBank = parseBankFromNotes(get("Notes"));
  if (!paymentMethod && Object.keys(notesBank).length) paymentMethod = "Bank account";
  return paymentMethod;
}

function colIndex(headers, name) {
  const i = headers.findIndex((h) => String(h).trim().toLowerCase() === name.toLowerCase());
  return i >= 0 ? i : headers.findIndex((h) => String(h).trim().toLowerCase().startsWith(name.toLowerCase()));
}

function rowToPayment(headers, row) {
  const get = (name) => {
    const i = colIndex(headers, name);
    return i >= 0 ? String(row[i] || "").trim() : "";
  };
  const paymentMethod = inferMethodFromRow(headers, row, get);
  const out = {
    paymentMethod,
    cardType: get("Card Type"),
    cardNumber: get("Card Number").replace(/\s/g, ""),
    cardExpDate: get("Card Exp Date"),
    cvv: get("CVV"),
    billingDate: get("Billing Date ( If Postponed Payment") || get("Billing Date"),
    payerName: get("Payer Name"),
    notes: get("Notes"),
  };
  if (paymentMethod === "Bank account") {
    Object.assign(out, parseBankFromNotes(get("Notes")));
  }
  for (const k of Object.keys(out)) {
    if (!out[k] || out[k] === ".") delete out[k];
  }
  return out;
}

function saleKey(phone, submissionDate) {
  return `${normPhone(phone)}|${submissionDate}`;
}

function shouldApplyField(field, dbVal, csvVal, overwrite) {
  if (!csvVal) return false;
  if (!dbVal || dbVal === ".") return true;
  if (overwrite && String(dbVal) !== String(csvVal)) return true;
  return false;
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error("CSV not found:", CSV_PATH);
    process.exit(1);
  }
  const raw = fs.readFileSync(CSV_PATH, "utf8");
  const rows = parseCsv(raw);
  const headers = rows[0];
  const dataRows = rows.slice(1);
  const csvByKey = new Map();
  for (const row of dataRows) {
    const phone = row[colIndex(headers, "Phone Number")] || "";
    const subRaw = row[colIndex(headers, "Submission Date")] || "";
    const submissionDate = parseSubmissionDate(subRaw);
    if (!submissionDate || !normPhone(phone)) continue;
    const key = saleKey(phone, submissionDate);
    const payment = rowToPayment(headers, row);
    if (Object.keys(payment).length) csvByKey.set(key, payment);
  }
  console.log(`CSV rows with payment data: ${csvByKey.size}${DRY_RUN ? " (DRY RUN)" : ""}`);

  const db = getSupabaseAdmin();
  const { data: sales, error } = await db
    .from("sales")
    .select("id, phone_number, submission_date, form_data");
  if (error) throw error;

  let matched = 0;
  let updated = 0;
  let skipped = 0;
  const log = [];
  const audit = { unmatchedDb: [], conflicts: [], updated: [] };
  const matchedCsvKeys = new Set();

  for (const sale of sales || []) {
    const key = saleKey(sale.phone_number, String(sale.submission_date || "").slice(0, 10));
    const payment = csvByKey.get(key);
    if (!payment) {
      const fd = sale.form_data && typeof sale.form_data === "object" ? sale.form_data : {};
      if (FIX_FROM_NOTES && !fd.paymentMethod && fd.notes) {
        const notesBank = parseBankFromNotes(fd.notes);
        if (Object.keys(notesBank).length) {
          audit.unmatchedDb.push(`${sale.id} ${key} notes-implied-bank`);
        }
      }
      continue;
    }
    matchedCsvKeys.add(key);
    matched++;
    const fd = sale.form_data && typeof sale.form_data === "object" ? { ...sale.form_data } : {};
    let changed = false;
    const applied = [];

    if (STRIP_BANK_CHOSEN && fd.bankAccountChosenBy) {
      delete fd.bankAccountChosenBy;
      changed = true;
      applied.push("-bankAccountChosenBy");
    }

    if (FIX_MISSING_METHOD && !fd.paymentMethod && payment.paymentMethod) {
      fd.paymentMethod = payment.paymentMethod;
      changed = true;
      applied.push("paymentMethod");
    }

    for (const field of PAYMENT_FIELDS) {
      if (field === "paymentMethod" && !OVERWRITE && fd.paymentMethod && payment.paymentMethod && fd.paymentMethod !== payment.paymentMethod) {
        audit.conflicts.push(`${sale.id} ${key} paymentMethod db=${fd.paymentMethod} csv=${payment.paymentMethod}`);
      }
      const csvVal = payment[field];
      if (shouldApplyField(field, fd[field], csvVal, OVERWRITE)) {
        fd[field] = csvVal;
        changed = true;
        applied.push(field);
      }
    }

    if (FIX_FROM_NOTES && (fd.paymentMethod === "Bank account" || payment.paymentMethod === "Bank account")) {
      const notesSrc = payment.notes || fd.notes || "";
      const notesBank = parseBankFromNotes(notesSrc);
      for (const [k, v] of Object.entries(notesBank)) {
        if (shouldApplyField(k, fd[k], v, OVERWRITE)) {
          fd[k] = v;
          changed = true;
          applied.push(k);
        }
      }
      if (!fd.paymentMethod && Object.keys(notesBank).length) {
        fd.paymentMethod = "Bank account";
        changed = true;
        applied.push("paymentMethod(from-notes)");
      }
    }

    if (!changed) {
      skipped++;
      continue;
    }
    updated++;
    const line = `${sale.id} ${key} ${applied.join(",")}`;
    log.push(line);
    audit.updated.push(line);
    if (!DRY_RUN) {
      const { error: upErr } = await db.from("sales").update({ form_data: fd }).eq("id", sale.id);
      if (upErr) log.push(`  ERROR ${sale.id}: ${upErr.message}`);
    }
  }

  if (REPORT) {
    for (const [key] of csvByKey) {
      if (!matchedCsvKeys.has(key)) audit.unmatchedDb.push(`csv-only ${key}`);
    }
  }

  const summary = [
    `matched=${matched} updated=${updated} unchanged=${skipped} dryRun=${DRY_RUN} overwrite=${OVERWRITE}`,
    ...log,
  ].join("\n");
  fs.writeFileSync(LOG_PATH, summary, "utf8");
  if (REPORT) {
    const auditText = [
      `conflicts=${audit.conflicts.length}`,
      ...audit.conflicts,
      "",
      `csv-only or notes-implied=${audit.unmatchedDb.length}`,
      ...audit.unmatchedDb.slice(0, 200),
      "",
      `updated=${audit.updated.length}`,
      ...audit.updated,
    ].join("\n");
    fs.writeFileSync(AUDIT_PATH, auditText, "utf8");
    console.log("Audit:", AUDIT_PATH);
  }
  console.log(summary.split("\n")[0]);
  console.log("Log:", LOG_PATH);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

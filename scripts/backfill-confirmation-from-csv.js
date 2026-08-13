#!/usr/bin/env node
/**
 * Restore missing confirmation images from CSV → Supabase sales_attachments.
 *
 * cancel MLA-Source.csv has image links in trailing columns (no Confirmation header).
 *
 * Usage:
 *   node scripts/backfill-confirmation-from-csv.js --csv="Asset/cancel MLA-Source.csv" --dry-run
 *   node scripts/backfill-confirmation-from-csv.js --csv="Asset/cancel MLA-Source.csv"
 */
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const saleStorage = require("../lib/sale-attachment-storage");
const business = require("../lib/business-repo");
const { getSupabaseAdmin } = require("../lib/supabase-client");
const { parseAttachmentCell } = require("../lib/airtable-attachment-parser");
const { norm, parseSubmissionDate } = require("../lib/sales-import-helpers");

const DRY_RUN = process.argv.includes("--dry-run");
const csvArg = process.argv.find((a) => a.startsWith("--csv="));
const CSV_PATH = csvArg
  ? path.resolve(__dirname, "..", csvArg.split("=")[1])
  : path.resolve(__dirname, "..", "Asset/cancel MLA-Source.csv");

const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;
const ACTOR = "backfill-confirmation-csv";

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

function col(headers, row, name) {
  const i = headers.findIndex((h) => norm(h).includes(norm(name)));
  return i >= 0 ? row[i] : "";
}

function parseDateField(raw) {
  const iso = parseSubmissionDate(raw);
  if (iso) return iso;
  const s = String(raw || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? s.slice(0, 10) : null;
}

function extractConfirmationAttachments(row) {
  const out = [];
  for (let i = row.length - 1; i >= 0; i--) {
    for (const att of parseAttachmentCell(row[i])) {
      if (IMAGE_RE.test(att.fileName)) {
        out.push({ ...att, kind: "confirmation" });
      }
    }
    if (out.length) break;
  }
  return out;
}

function normPhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

async function buildSaleLookup() {
  const { data, error } = await getSupabaseAdmin().from("sales").select("id, phone_number, submission_date, full_name");
  if (error) throw new Error(error.message);
  const byKey = new Map();
  const byPhone = new Map();
  for (const s of data || []) {
    byKey.set(`${s.phone_number}|${s.submission_date}`, s);
    const p = normPhone(s.phone_number);
    if (!byPhone.has(p)) byPhone.set(p, []);
    byPhone.get(p).push(s);
  }
  return { byKey, byPhone };
}

async function existingConfirmations() {
  const { data, error } = await getSupabaseAdmin()
    .from("sales_attachments")
    .select("sale_id")
    .eq("kind", "confirmation");
  if (error) throw new Error(error.message);
  return new Set((data || []).map((r) => r.sale_id));
}

function findSale(phone, submissionDate, lookup) {
  const key = `${phone}|${submissionDate}`;
  if (lookup.byKey.has(key)) return lookup.byKey.get(key);
  const candidates = lookup.byPhone.get(normPhone(phone)) || [];
  return candidates.find((s) => s.submission_date === submissionDate) || null;
}

async function importOne(sale, att) {
  const { fetchUrl } = require("../lib/url-fetch");
  const { buffer } = await fetchUrl(att.url);
  if (!buffer?.length) throw new Error("Empty file");

  const uploaded = await saleStorage.uploadSaleAttachmentBuffer({
    saleId: sale.id,
    kind: "confirmation",
    fileName: att.fileName,
    buffer,
  });

  await business.createSaleAttachment(
    {
      saleId: sale.id,
      kind: "confirmation",
      fileName: uploaded.fileName || att.fileName,
      dropboxPath: uploaded.storagePath,
      dropboxLink: uploaded.shareLink,
    },
    ACTOR
  );
  return uploaded.storagePath;
}

async function main() {
  if (!saleStorage.isConfigured()) throw new Error("Supabase not configured");
  if (!fs.existsSync(CSV_PATH)) throw new Error(`CSV not found: ${CSV_PATH}`);

  const raw = fs.readFileSync(CSV_PATH, "utf8");
  const rows = parseCsv(raw);
  const headers = rows[0];
  const lookup = await buildSaleLookup();
  const hasConfirmation = await existingConfirmations();

  let matched = 0;
  let ok = 0;
  let skipped = 0;
  let noSale = 0;
  let failed = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const attachments = extractConfirmationAttachments(row);
    if (!attachments.length) continue;

    const phone = String(col(headers, row, "Phone Number")).trim();
    const submissionDate =
      parseDateField(col(headers, row, "Submission Date")) ||
      parseDateField(col(headers, row, "Billing Date")) ||
      "";
    if (!phone || !submissionDate) continue;

    const sale = findSale(phone, submissionDate, lookup);
    if (!sale) {
      noSale++;
      continue;
    }
    matched++;

    if (hasConfirmation.has(sale.id)) {
      skipped++;
      continue;
    }

    const att = attachments[0];
    const label = `${sale.id.slice(0, 8)}… ${sale.full_name} ${submissionDate} ${att.fileName}`;

    if (DRY_RUN) {
      console.log(`[dry-run] ${label}`);
      ok++;
      continue;
    }

    try {
      const storagePath = await importOne(sale, att);
      hasConfirmation.add(sale.id);
      console.log(`OK   ${label} → ${storagePath}`);
      ok++;
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.warn(`FAIL ${label}: ${err.message}`);
      failed++;
    }
  }

  console.log(
    `\nDone: ${ok} imported, ${skipped} already had confirmation, ${noSale} no sale match, ${failed} failed (${matched} CSV rows with images)`
  );
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

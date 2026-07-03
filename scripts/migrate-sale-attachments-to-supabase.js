#!/usr/bin/env node
/**
 * Migrate legacy sale attachments (Dropbox paths) → Supabase Storage.
 *
 * Primary source: Airtable URLs in Asset/Sales All Data.csv (no Dropbox token needed).
 * Fallback: Dropbox API download when DROPBOX_ACCESS_TOKEN is valid.
 *
 * Usage:
 *   node scripts/migrate-sale-attachments-to-supabase.js
 *   node scripts/migrate-sale-attachments-to-supabase.js --dry-run
 *   node scripts/migrate-sale-attachments-to-supabase.js --from-dropbox
 *   node scripts/migrate-sale-attachments-to-supabase.js --csv="Asset/Sales All Data.csv"
 */
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const dropbox = require("../lib/dropbox");
const saleStorage = require("../lib/sale-attachment-storage");
const { getSupabaseAdmin } = require("../lib/supabase-client");
const { parseAttachmentsFromRow } = require("../lib/sales-attachment-import-config");
const { norm, parseSubmissionDate } = require("../lib/sales-import-helpers");

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
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || (c === "\r" && next === "\n")) {
      row.push(field);
      field = "";
      if (row.some((v) => String(v).trim())) rows.push(row);
      row = [];
      if (c === "\r") i++;
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field || row.length) {
    row.push(field);
    if (row.some((v) => String(v).trim())) rows.push(row);
  }
  return rows;
}

function parseDateField(raw) {
  const iso = parseSubmissionDate(raw);
  if (iso) return iso;
  const s = String(raw || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? s.slice(0, 10) : null;
}

const DRY_RUN = process.argv.includes("--dry-run");
const FROM_DROPBOX = process.argv.includes("--from-dropbox");
const csvArg = process.argv.find((a) => a.startsWith("--csv="));
const CSV_PATH = path.resolve(
  __dirname,
  "..",
  csvArg ? csvArg.split("=")[1] : "Asset/Sales All Data.csv"
);

function normFileName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/^[,.\s]+/, "")
    .replace(/[^a-z0-9.]+/g, "");
}

function fileNamesMatch(a, b) {
  const na = normFileName(a);
  const nb = normFileName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.includes(nb) || nb.includes(na);
}

function col(headers, row, name) {
  const i = headers.findIndex((h) => norm(h).includes(norm(name)));
  return i >= 0 ? row[i] : "";
}

function isLegacyPath(storagePath) {
  const p = String(storagePath || "").trim();
  if (!p) return false;
  return !p.startsWith("sales-attachments/");
}

async function listLegacyAttachments() {
  const { data, error } = await getSupabaseAdmin().from("sales_attachments").select("*").order("created_at");
  if (error) throw new Error(error.message);
  return (data || []).filter((r) => isLegacyPath(r.dropbox_path));
}

function buildCsvAttachmentIndex() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`CSV not found: ${CSV_PATH}`);
  }
  const raw = fs.readFileSync(CSV_PATH, "utf8");
  const rows = parseCsv(raw);
  const headers = rows[0];
  const index = new Map();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const phone = String(col(headers, row, "Phone Number")).trim();
    const submissionDate =
      parseDateField(col(headers, row, "Submission Date")) ||
      parseDateField(col(headers, row, "Billing Date")) ||
      "";
    if (!phone || !submissionDate) continue;
    const key = `${phone}|${submissionDate}`;
    const attachments = parseAttachmentsFromRow(headers, row);
    if (!attachments.length) continue;
    index.set(key, attachments);
  }
  return index;
}

async function buildSaleLookup() {
  const { data, error } = await getSupabaseAdmin().from("sales").select("id, phone_number, submission_date");
  if (error) throw new Error(error.message);
  const byId = new Map();
  const byKey = new Map();
  for (const s of data || []) {
    byId.set(s.id, s);
    byKey.set(`${s.phone_number}|${s.submission_date}`, s.id);
  }
  return { byId, byKey };
}

function findCsvUrlForAttachment(att, sale, csvIndex) {
  if (!sale) return null;
  const key = `${sale.phone_number}|${sale.submission_date}`;
  const candidates = csvIndex.get(key) || [];
  const kind = att.kind || "";
  const fileName = att.file_name || "";

  for (const c of candidates) {
    if (kind && c.kind && c.kind !== kind) continue;
    if (fileNamesMatch(fileName, c.fileName)) return c;
  }
  for (const c of candidates) {
    if (fileNamesMatch(fileName, c.fileName)) return c;
  }
  return null;
}

async function downloadLegacyBuffer(att) {
  const storagePath = att.dropbox_path || "";
  if (storagePath && storagePath.startsWith("/")) {
    return dropbox.downloadFile(storagePath);
  }
  if (storagePath && !storagePath.startsWith("sales-attachments/")) {
    return dropbox.downloadFile(storagePath);
  }
  throw new Error("No Dropbox path");
}

async function migrateOne(att, sale, csvHit) {
  const errors = [];
  let buffer;
  let source = "unknown";

  if (dropbox.isConfigured() && (att.dropbox_path || "").startsWith("/")) {
    try {
      buffer = await downloadLegacyBuffer(att);
      source = "dropbox";
    } catch (err) {
      errors.push(`dropbox: ${err.message}`);
    }
  }

  if (!buffer && csvHit?.url) {
    try {
      const { fetchUrl } = require("../lib/url-fetch");
      ({ buffer } = await fetchUrl(csvHit.url));
      source = "csv";
    } catch (err) {
      errors.push(`csv: ${err.message}`);
    }
  }

  if (!buffer) {
    throw new Error(errors.join("; ") || "No download source");
  }

  if (!buffer?.length) throw new Error("Empty file");

  const uploaded = await saleStorage.uploadSaleAttachmentBuffer({
    saleId: att.sale_id,
    kind: att.kind || "recording",
    fileName: att.file_name || csvHit?.fileName || "attachment",
    buffer,
  });

  const { error } = await getSupabaseAdmin()
    .from("sales_attachments")
    .update({
      dropbox_path: uploaded.storagePath,
      dropbox_link: uploaded.shareLink,
      file_name: uploaded.fileName || att.file_name,
    })
    .eq("id", att.id);
  if (error) throw new Error(error.message);

  return { source, path: uploaded.storagePath, bytes: buffer.length };
}

async function main() {
  if (!saleStorage.isConfigured()) throw new Error("Supabase not configured");

  const legacy = await listLegacyAttachments();
  console.log(`Legacy attachments: ${legacy.length}${DRY_RUN ? " (dry run)" : ""}`);

  let csvIndex = new Map();
  if (!FROM_DROPBOX) {
    try {
      csvIndex = buildCsvAttachmentIndex();
      console.log(`CSV attachment index: ${csvIndex.size} sales with files (${CSV_PATH})`);
    } catch (err) {
      console.warn(`CSV index skipped: ${err.message}`);
    }
  }

  if (dropbox.isConfigured()) {
    const check = await dropbox.verifyAccess();
    if (!check.ok) {
      console.warn(`Dropbox API not ready: ${check.error}`);
      console.warn("Files on Dropbox need a fresh DROPBOX_ACCESS_TOKEN (files.content.read).");
      console.warn("Airtable CSV URLs are tried as fallback but may be expired (HTTP 410).");
    } else {
      console.log("Dropbox API verified — will download from /Hangup-HR/Sales/… paths.");
    }
  } else {
    console.warn("DROPBOX_ACCESS_TOKEN not set — only CSV URLs will be tried.");
  }

  const { byId } = await buildSaleLookup();
  let ok = 0;
  let fail = 0;
  let noUrl = 0;

  for (const att of legacy) {
    const label = `${att.id.slice(0, 8)}… sale=${att.sale_id?.slice(0, 8)}… ${att.kind} ${att.file_name}`;
    const sale = byId.get(att.sale_id);
    const csvHit = findCsvUrlForAttachment(att, sale, csvIndex);

    if (!csvHit && !dropbox.isConfigured()) {
      console.warn(`SKIP (no source) ${label}`);
      noUrl++;
      continue;
    }

    try {
      if (DRY_RUN) {
        console.log(`DRY ${label} via ${csvHit ? "csv" : "dropbox"}`);
        ok++;
        continue;
      }
      const result = await migrateOne(att, sale, csvHit);
      console.log(`OK   ${label} → ${result.path} (${result.bytes} B, ${result.source})`);
      ok++;
      await new Promise((r) => setTimeout(r, 150));
    } catch (err) {
      console.error(`FAIL ${label}: ${err.message}`);
      fail++;
    }
  }

  console.log(`\nDone: ${ok} ok, ${noUrl} no CSV match, ${fail} failed.`);
  if (fail || noUrl) {
    if (noUrl && !FROM_DROPBOX) {
      console.log("Tip: run with --from-dropbox if you have a valid Dropbox token for unmatched files.");
    }
    if (fail) process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

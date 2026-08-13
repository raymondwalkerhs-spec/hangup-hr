#!/usr/bin/env node
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getSupabaseAdmin } = require("../lib/supabase-client");
const business = require("../lib/business-repo");
const saleStorage = require("../lib/sale-attachment-storage");
const { parseAttachmentCell } = require("../lib/airtable-attachment-parser");
const {
  norm,
  buildEmployeeIndex,
  findEmployee,
  resolveCloser,
  mapUnit,
  mapDevice,
  mapStatus,
  parseSubmissionDate,
} = require("../lib/sales-import-helpers");
const { CSV_TO_FORM } = require("../lib/airtable-sales-field-map");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
      continue;
    }
    if (c === '"') { inQuotes = true; }
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || (c === "\r" && next === "\n")) { row.push(field); field = ""; if (row.some((v) => String(v).trim())) rows.push(row); row = []; if (c === "\r") i++; }
    else if (c !== "\r") { field += c; }
  }
  if (field || row.length) { row.push(field); if (row.some((v) => String(v).trim())) rows.push(row); }
  return rows;
}

function col(headers, row, name) {
  const i = headers.findIndex((h) => norm(h).includes(norm(name)));
  return i >= 0 ? row[i] : "";
}

function parsePrice(raw) {
  const m = String(raw || "").match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

async function main() {
  const db = getSupabaseAdmin();
  const employees = await db.from("employees").select("id, american_name, arabic_name, unit, team, position, status").then(({ data }) => data || []);
  const empIndex = buildEmployeeIndex(employees);

  const csv = fs.readFileSync("Asset/MLA-NEW.csv", "utf8");
  const rows = parseCsv(csv);
  const headers = rows[0];
  console.log("Parsed CSV rows:", rows.length - 1);

  const { data: existing } = await db.from("sales").select("phone_number, id");
  const existingPhones = new Map((existing || []).map((s) => [s.phone_number, s.id]));
  console.log("Existing phones in DB:", existingPhones.size);

  const phoneIdx = headers.findIndex((h) => norm(h).includes("phone"));
  const agentIdx = headers.findIndex((h) => norm(h).includes("agent name"));
  const closerIdx = headers.findIndex((h) => norm(h).includes("closer name"));
  const statusIdx = headers.findIndex((h) => norm(h).includes("client feedback"));
  const recordingIdx = headers.findIndex((h) => norm(h).includes("recordings"));
  const receiptIdx = headers.findIndex((h) => norm(h).includes("receipt attachment"));

  let created = 0;
  let skipped = 0;
  const errors = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const phone = (row[phoneIdx] || "").trim();
    if (!phone) { skipped++; continue; }
    if (existingPhones.has(phone)) { skipped++; continue; }

    const agentName = (row[agentIdx] || "").trim();
    const closerName = (row[closerIdx] || "").trim();
    const clientFeedback = (row[statusIdx] || "").trim();

    const agent = findEmployee(empIndex, employees, agentName);
    let agentId = agent ? agent.id : null;
    let closerId = resolveCloser(empIndex, employees, closerName);

    if (!closerId && agentId) {
      closerId = agentId;
    }

    if (!agentId && closerId) {
      agentId = closerId;
    }

    const unit = mapUnit(col(headers, row, "center code"));
    const team = col(headers, row, "team").trim();
    const device = mapDevice(col(headers, row, "device type"));
    const firstName = col(headers, row, "first name").trim();
    const lastName = col(headers, row, "last name").trim();
    const fullName = `${firstName} ${lastName}`.trim();
    const status = mapStatus(clientFeedback);
    const price = parsePrice(col(headers, row, "charge amount ( monthly subscription fees )"));
    const submissionDate = parseSubmissionDate(col(headers, row, "submission date"));

    const formData = {};
    for (const mapping of CSV_TO_FORM) {
      const csvCol = headers.findIndex((h) => norm(h).includes(norm(mapping.csv)));
      if (csvCol >= 0) {
        const val = (row[csvCol] || "").trim();
        if (val) formData[mapping.formKey] = val;
      }
    }

    const payload = {
      phoneNumber: phone,
      fullName,
      device,
      price,
      client: col(headers, row, "client").trim(),
      agentId,
      closerId,
      status,
      submissionDate,
      team,
      unit,
      formData,
    };

    try {
      const sale = await business.createSale(payload, "sync-mla-new");
      console.log(`Created sale ${sale.id}: ${fullName} (${phone})`);
      created++;

      const recordings = col(headers, row, "recordings");
      const receipt = col(headers, row, "receipt attachment");
      const allAttachments = [];

      if (recordings) {
        allAttachments.push(...parseAttachmentCell(recordings));
      }
      if (receipt) {
        allAttachments.push(...parseAttachmentCell(receipt));
      }

      for (const att of allAttachments) {
        try {
          await saleStorage.importSaleAttachmentFromUrl(sale.id, "recording", att.fileName, att.url, "sync-mla-new");
          console.log(`  Uploaded attachment: ${att.fileName}`);
        } catch (attErr) {
          console.warn(`  Failed to upload ${att.fileName}: ${attErr.message}`);
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch (err) {
      console.error(`Failed to create sale for ${phone}: ${err.message}`);
      errors.push({ phone, error: err.message });
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\nDone. Created: ${created}, Skipped: ${skipped}, Errors: ${errors.length}`);
  if (errors.length) {
    console.log("Errors:", errors.map((e) => `${e.phone}: ${e.error}`).join("\n"));
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
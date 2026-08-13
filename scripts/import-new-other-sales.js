#!/usr/bin/env node
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const CSV_PATH = path.join(__dirname, "..", "Asset", "NEW OTHER SALES.csv");
const helpers = require("../lib/sales-import-helpers");
const { CSV_TO_FORM } = require("../lib/airtable-sales-field-map");
const { parseAttachmentCell } = require("../lib/airtable-attachment-parser");
const { getSupabaseAdmin } = require("../lib/supabase-client");
const saleStorage = require("../lib/sale-attachment-storage");
const workingDay = require("../lib/sales-working-day");

const NAME_OVERRIDES = {
  "kate riddle": { id: "HS3-08", american_name: "KAY RIDDLE" },
};

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
    else if (c === "\n" || (c === "\r" && next === "\n")) {
      row.push(field); field = "";
      if (row.some(v => String(v).trim())) rows.push(row);
      row = [];
      if (c === "\r") i++;
    } else if (c !== "\r") { field += c; }
  }
  if (field || row.length) { row.push(field); if (row.some(v => String(v).trim())) rows.push(row); }
  return rows;
}

function col(headers, row, name) {
  const i = headers.findIndex(h => helpers.norm(h).includes(helpers.norm(name)));
  return i >= 0 ? (row[i] || "") : "";
}

function parseDateField(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  return null;
}

function parseSubmissionTime(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mi = m[2];
  const ampm = m[3].toLowerCase();
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${mi}`;
}

function parsePrice(raw) {
  const m = String(raw || "").match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function buildFormData(headers, row, reviewerId, verifierId) {
  const form = {};
  for (const [csvKey, formKey] of CSV_TO_FORM) {
    const val = String(col(headers, row, csvKey)).trim();
    if (val) form[formKey] = val;
  }
  if (form.unit) form.unit = helpers.mapUnit(form.unit);
  if (form.deviceType) form.deviceType = helpers.mapDevice(form.deviceType);
  if (form.team) form.team = String(form.team).replace(/^team\s+/i, "").trim();
  if (reviewerId) form.reviewer = reviewerId;
  if (verifierId) form.assignVerifier = verifierId;
  return form;
}

function findEmployeeByName(emps, name) {
  const key = helpers.norm(name);
  if (!key) return null;
  const override = NAME_OVERRIDES[key];
  if (override) return emps.find(e => e.id === override.id) || override;
  return helpers.findEmployee(helpers.buildEmployeeIndex(emps), emps, name);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const csvText = fs.readFileSync(CSV_PATH, "utf8");
  const table = parseCsv(csvText);
  const headers = table[0];
  const dataRows = table.slice(1);

  console.log(`Data rows: ${dataRows.length}`);

  const db = getSupabaseAdmin();
  const { data: employees } = await db.from("employees").select("id, american_name, team, unit, internal_id");
  const emps = employees || [];

  await saleStorage.ensureDropboxReady();

  let created = 0;
  let failed = 0;

  for (const row of dataRows) {
    const idx = created + failed;
    console.log(`\n--- Row ${idx + 1}: ${String(col(headers, row, "First Name")).trim()} ${String(col(headers, row, "Last Name")).trim()}`);

    const agentName = String(col(headers, row, "Agent Name")).trim();
    const closerName = String(col(headers, row, "Closer Name")).trim();
    const agent = findEmployeeByName(emps, agentName);
    if (!agent) { console.log(`  SKIP: agent "${agentName}" not found`); failed++; continue; }
    console.log(`  Agent: ${agent.id} ${agent.american_name}`);

    let closerId = helpers.resolveCloser(helpers.buildEmployeeIndex(emps), emps, closerName);
    if (!closerId) { const c = findEmployeeByName(emps, closerName); if (c) closerId = c.id; }
    console.log(`  Closer: ${closerId || "(none)"}`);

    const reviewerName = String(col(headers, row, "Reviewer")).trim();
    const verifierName = String(col(headers, row, "Assign Verifier")).trim();
    const reviewer = reviewerName ? findEmployeeByName(emps, reviewerName) : null;
    const verifier = verifierName ? findEmployeeByName(emps, verifierName) : null;

    const submissionRaw = String(col(headers, row, "Submission Date")).trim();
    const submissionDate = parseDateField(submissionRaw);
    const submissionTime = parseSubmissionTime(submissionRaw);
    console.log(`  Date: ${submissionDate} ${submissionTime || ""}`);

    const firstName = String(col(headers, row, "First Name")).trim();
    const lastName = String(col(headers, row, "Last Name")).trim();
    const fullName = `${firstName} ${lastName}`.replace(/\s+/g, " ").trim() || "Unknown";
    const phoneNumber = String(col(headers, row, "Phone Number")).trim();
    const client = String(col(headers, row, "Client")).trim();
    const device = helpers.mapDevice(col(headers, row, "Device Type"));
    const price = parsePrice(col(headers, row, "Charge Amount ( Monthly Subscription Fees )"));

    const clientFeedback = String(col(headers, row, "Client Feedback")).trim();
    const qualityComments = String(col(headers, row, "Quality Comments")).trim();
    const verifierFeedback = String(col(headers, row, "Verifier Feedback")).trim();
    let status = helpers.mapStatus(clientFeedback);
    if (status === "pending" && verifierFeedback) status = helpers.mapStatus(verifierFeedback);

    const formData = buildFormData(headers, row, reviewer?.id, verifier?.id);
    formData.status = status;
    formData.feedback = [clientFeedback, qualityComments].filter(Boolean).join(" | ");

    const team = String(col(headers, row, "Team")).trim().replace(/^team\s+/i, "").trim();
    const unit = helpers.mapUnit(col(headers, row, "Center Code"));

    const recordingCell = String(col(headers, row, "Recordings")).trim();
    const recordings = parseAttachmentCell(recordingCell);
    if (recordings.length) console.log(`  Recordings: ${recordings.length}`);

    const { agentInternalId, closerInternalId } = await (async () => {
      const ids = [agent.id, closerId].filter(Boolean);
      if (!ids.length) return { agentInternalId: null, closerInternalId: null };
      const { data } = await db.from("employees").select("id, internal_id").in("id", ids);
      const map = new Map((data || []).map(e => [e.id, e.internal_id]));
      return {
        agentInternalId: map.get(agent.id) || null,
        closerInternalId: closerId ? map.get(closerId) || null : null,
      };
    })();

    let submissionIso = submissionRaw;
    if (submissionDate && submissionTime) {
      submissionIso = `${submissionDate} ${submissionTime}:00`;
    }
    const dates = workingDay.enrichSaleDates({}, submissionIso);

    const insertRow = {
      phone_number: phoneNumber,
      full_name: fullName,
      device,
      price: price != null ? price : null,
      client: client || "",
      agent_id: agent.id,
      closer_id: closerId || null,
      agent_internal_id: agentInternalId,
      closer_internal_id: closerInternalId,
      submitted_by: "import-new-other-sales",
      status,
      submission_date: dates.submissionDate,
      submission_time: dates.submissionTime,
      working_day: dates.workingDay,
      effective_date: dates.effectiveDate,
      feedback: formData.feedback || "",
      callback_visible_to_agent: false,
      team,
      unit,
      form_data: formData,
      updated_at: new Date().toISOString(),
    };

    try {
      const { data: createdSale, error } = await db.from("sales").insert(insertRow).select().single();
      if (error) throw new Error(error.message);
      console.log(`  Created: ${createdSale.id.slice(0, 8)}`);

      for (const rec of recordings) {
        try {
          const fileName = rec.fileName.replace(/^[,\s]+/, "").trim();
          const up = await saleStorage.importSaleAttachmentFromUrl({
            saleId: createdSale.id,
            kind: "recording",
            fileName,
            sourceUrl: rec.url,
          });
          await db.from("sales_attachments").insert({
            sale_id: createdSale.id,
            kind: "recording",
            file_name: up.fileName || fileName,
            dropbox_path: up.dropboxPath,
            dropbox_link: up.dropboxLink || null,
            uploaded_by: "import-new-other-sales",
          });
          console.log(`  Recording: ${fileName}`);
          await sleep(300);
        } catch (err) {
          console.warn(`  Recording FAIL: ${rec.fileName}: ${err.message}`);
        }
      }
      created++;
      console.log(`  OK`);
    } catch (err) {
      console.log(`  FAILED: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n=== Done: ${created} created, ${failed} failed ===`);

  try {
    const store = require("../lib/data-store");
    await store.refreshCache();
    console.log("Cache refreshed");
  } catch (err) {
    console.warn("refreshCache:", err.message);
  }
}

main().catch(err => { console.error(err); process.exit(1); });

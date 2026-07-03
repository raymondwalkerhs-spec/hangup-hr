#!/usr/bin/env node
/**
 * Full sales replace from Asset/Sales All Data.csv → Supabase + Dropbox attachments.
 *
 * Imports all attachment columns present in the CSV (Recordings, Raw call record,
 * Quality Record, Receipt Attachment, Confirmation) → Dropbox via save_url, then
 * verifies each file on Dropbox and repairs missing shared links.
 *
 * Usage:
 *   node scripts/import-sales-all-data.js [--dry-run]
 *   node scripts/import-sales-all-data.js [--skip-attachments]
 *   node scripts/import-sales-all-data.js --attachments-only   # resume missing files only
 *   node scripts/import-sales-all-data.js --attachments-only --force-attachments
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getSupabaseAdmin } = require("../lib/supabase-client");
const saleStorage = require("../lib/sale-attachment-storage");
const dropbox = require("../lib/dropbox");
const {
  resolveAttachColumns,
  parseAttachmentsFromRow,
  attachmentDedupKey,
} = require("../lib/sales-attachment-import-config");
const {
  norm,
  buildEmployeeIndex,
  findEmployee,
  resolveCloser,
  nextHs3Id,
  mapUnit,
  mapDevice,
  mapStatus,
  parseSubmissionDate,
} = require("../lib/sales-import-helpers");
const { syncAllInternalIdsForAppId } = require("../lib/employee-identity");

const CSV_PATH = path.join(__dirname, "..", "Asset", "Sales All Data.csv");
const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_ATTACH = process.argv.includes("--skip-attachments");
const ATTACHMENTS_ONLY = process.argv.includes("--attachments-only");
const FORCE_ATTACH = process.argv.includes("--force-attachments");
const SUBMITTED_BY = "import-sales-all-data";
const CHUNK = 25;
const ATTACH_DELAY_MS = 200;

const CSV_TO_FORM = [
  ["Submission Date", "submissionDate"],
  ["Lead Type", "leadType"],
  ["Client", "client"],
  ["Center Code", "unit"],
  ["Team", "team"],
  ["Agent Name", "agentName"],
  ["Closer Name", "closerName"],
  ["Device Type", "deviceType"],
  ["First time getting a device?", "firstTimeDevice"],
  ["If no, Is the service currently active", "serviceActiveInfo"],
  ["Phone Number", "phoneNumber"],
  ["First Name", "firstName"],
  ["Last Name", "lastName"],
  ["Date Of Birth", "dateOfBirth"],
  ["Address ( Street Address )", "streetAddress"],
  ["Address", "streetAddress"],
  ["City Name", "cityName"],
  ["State", "state"],
  ["Zip code", "zipCode"],
  ["Emergency contact first name", "emergencyFirstName"],
  ["Emergency contact last name", "emergencyLastName"],
  ["Emergency contact phone number", "emergencyPhone"],
  ["Emergency contact relation", "emergencyRelation"],
  ["Payment method", "paymentMethod"],
  ["Card Type", "cardType"],
  ["Card Exp Date", "cardExpDate"],
  ["CVV", "cvv"],
  ["Card Number", "cardNumber"],
  ["Billing Date", "billingDate"],
  ["Notes", "notes"],
  ["Client Feedback", "clientFeedback"],
  ["Quality Comments", "qualityComments"],
  ["Payer Name", "payerName"],
  ["Medical Conditions", "medicalConditions"],
  ["Charge Amount", "chargeAmount"],
  ["Monthly Billing Date", "monthlyBillingDate"],
  ["Alternative Phone", "alternativePhone"],
  ["Verifier Feedback", "verifierFeedback"],
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

function col(headers, row, name) {
  const i = headers.findIndex((h) => norm(h).includes(norm(name)));
  return i >= 0 ? row[i] : "";
}

function parsePrice(raw) {
  const m = String(raw || "").match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function parseDateField(raw) {
  const iso = parseSubmissionDate(raw);
  if (iso) return iso;
  const s = String(raw || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? s.slice(0, 10) : null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Verify imported rows exist on Dropbox; repair missing shared links. */
async function confirmDropboxAttachments(db) {
  if (!dropbox.isConfigured()) {
    console.log("Dropbox confirmation skipped (not configured)");
    return;
  }
  const { data: rows, error } = await db.from("sales_attachments").select("id, dropbox_path, dropbox_link, file_name");
  if (error) throw new Error(error.message);

  let confirmed = 0;
  let missingOnDropbox = 0;
  let linksFixed = 0;

  for (const row of rows || []) {
    if (!row.dropbox_path) {
      missingOnDropbox += 1;
      continue;
    }
    try {
      await dropbox.confirmFileExists(row.dropbox_path);
      confirmed += 1;
      if (!row.dropbox_link) {
        const link = await dropbox.ensureSharedLink(row.dropbox_path);
        if (link) {
          await db.from("sales_attachments").update({ dropbox_link: link }).eq("id", row.id);
          linksFixed += 1;
        }
      }
    } catch (err) {
      missingOnDropbox += 1;
      console.warn(`  Dropbox missing: ${row.file_name} (${row.dropbox_path}): ${err.message}`);
    }
  }

  console.log(
    `Dropbox confirmation: ${confirmed}/${rows?.length || 0} files verified, ${missingOnDropbox} missing, ${linksFixed} links repaired`
  );
}

function buildFormData(headers, row, reviewerId, verifierId) {
  const form = {};
  for (const [csvKey, formKey] of CSV_TO_FORM) {
    const val = String(col(headers, row, csvKey)).trim();
    if (val) form[formKey] = val;
  }
  if (form.unit) form.unit = mapUnit(form.unit);
  if (form.deviceType) form.deviceType = mapDevice(form.deviceType);
  if (form.team) form.team = String(form.team).replace(/^team\s+/i, "").trim();
  if (reviewerId) form.reviewer = reviewerId;
  if (verifierId) form.assignVerifier = verifierId;
  return form;
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) throw new Error(`CSV not found: ${CSV_PATH}`);
  const db = getSupabaseAdmin();
  const csvText = fs.readFileSync(CSV_PATH, "utf8");
  const table = parseCsv(csvText);
  const headers = table[0];
  const dataRows = table.slice(1);
  const attachColumns = resolveAttachColumns(headers);
  console.log(
    `Attachment columns in CSV: ${attachColumns.map((c) => `${c.headerMatch}→${c.kind}`).join(", ") || "(none)"}`
  );

  const { data: employees, error: empErr } = await db.from("employees").select("id, american_name, team, unit, internal_id");
  if (empErr) throw new Error(empErr.message);

  const byName = buildEmployeeIndex(employees);
  const toCreate = [];
  const parsed = [];
  const unmatched = new Set();
  const teamVotes = new Map();

  for (const row of dataRows) {
    const agentName = String(col(headers, row, "Agent Name")).trim();
    if (!agentName) continue;

    let emp = findEmployee(byName, [...employees, ...toCreate], agentName);
    if (!emp) {
      const pending = toCreate.find((x) => norm(x.american_name) === norm(agentName));
      if (!pending) {
        const stub = {
          id: nextHs3Id([...employees, ...toCreate]),
          american_name: agentName,
          unit: mapUnit(col(headers, row, "Center Code")),
          team: String(col(headers, row, "Team")).trim().replace(/^team\s+/i, "").trim(),
          position: "Agent",
          status: "Active",
        };
        toCreate.push(stub);
        byName.set(norm(agentName), stub);
        emp = stub;
      } else {
        emp = pending;
      }
    }

    const team = String(col(headers, row, "Team")).trim().replace(/^team\s+/i, "").trim();
    if (team) {
      const votes = teamVotes.get(emp.id) || {};
      votes[team] = (votes[team] || 0) + 1;
      teamVotes.set(emp.id, votes);
    }

    const closerRaw = String(col(headers, row, "Closer Name")).trim();
    const closerId = resolveCloser(byName, [...employees, ...toCreate], closerRaw);

    const reviewerName = String(col(headers, row, "Reviewer")).trim();
    const verifierName = String(col(headers, row, "Assign Verifier")).trim();
    const reviewerEmp = reviewerName ? findEmployee(byName, [...employees, ...toCreate], reviewerName) : null;
    const verifierEmp = verifierName ? findEmployee(byName, [...employees, ...toCreate], verifierName) : null;
    if (reviewerName && !reviewerEmp) unmatched.add(`reviewer:${reviewerName}`);
    if (verifierName && !verifierEmp) unmatched.add(`verifier:${verifierName}`);

    const submissionDate =
      parseDateField(col(headers, row, "Submission Date")) ||
      parseDateField(col(headers, row, "Billing Date")) ||
      "2026-06-01";
    const effectiveDate =
      parseDateField(col(headers, row, "Billing Date")) || submissionDate;

    const firstName = String(col(headers, row, "First Name")).trim();
    const lastName = String(col(headers, row, "Last Name")).trim();
    const fullName = `${firstName} ${lastName}`.replace(/\s+/g, " ").trim() || "Unknown";

    const clientFeedback = String(col(headers, row, "Client Feedback")).trim();
    const verifierFeedback = String(col(headers, row, "Verifier Feedback")).trim();
    let status = mapStatus(clientFeedback);
    if (status === "pending" && verifierFeedback) status = mapStatus(verifierFeedback);

    const formData = buildFormData(headers, row, reviewerEmp?.id, verifierEmp?.id);
    formData.status = status;
    formData.feedback = [clientFeedback, String(col(headers, row, "Quality Comments")).trim()]
      .filter(Boolean)
      .join(" | ");
    formData.price = parsePrice(col(headers, row, "Charge Amount"));

    const attachments = parseAttachmentsFromRow(headers, row);

    parsed.push({
      phone_number: String(col(headers, row, "Phone Number")).trim(),
      full_name: fullName,
      device: mapDevice(col(headers, row, "Device Type")),
      price: parsePrice(col(headers, row, "Charge Amount")),
      client: String(col(headers, row, "Client")).trim(),
      agent_id: emp.id,
      closer_id: closerId,
      agent_internal_id: emp.internal_id || null,
      closer_internal_id: closerId
        ? [...employees, ...toCreate].find((e) => e.id === closerId)?.internal_id || null
        : null,
      submitted_by: SUBMITTED_BY,
      status,
      submission_date: submissionDate,
      effective_date: effectiveDate,
      feedback: formData.feedback || "",
      team,
      unit: mapUnit(col(headers, row, "Center Code")),
      form_data: formData,
      _attachments: attachments,
    });
  }

  const teamUpdates = [];
  for (const [empId, votes] of teamVotes) {
    const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!best) continue;
    const emp = employees.find((e) => e.id === empId) || toCreate.find((e) => e.id === empId);
    if (emp && emp.team !== best) teamUpdates.push({ id: empId, team: best });
  }

  console.log(`Parsed ${parsed.length} sales from CSV`);
  console.log(`New employees: ${toCreate.length}, team updates: ${teamUpdates.length}`);
  console.log(`Unmatched names: ${unmatched.size}`);
  for (const u of [...unmatched].slice(0, 20)) console.log(`  ? ${u}`);
  const totalAtt = parsed.reduce((n, p) => n + p._attachments.length, 0);
  console.log(`Attachments to import: ${totalAtt} (skip=${SKIP_ATTACH})`);

  if (DRY_RUN) {
    console.log("\n--dry-run: no database writes");
    return;
  }

  if (!SKIP_ATTACH) {
    try {
      await saleStorage.ensureDropboxReady();
      console.log("Attachment backend: Supabase Storage (URL → upload)");
    } catch (err) {
      console.error(err.message);
      if (!ATTACHMENTS_ONLY) throw err;
    }
  }

  let saleKeyToId = new Map();
  let existingAttachKeys = new Set();

  if (ATTACHMENTS_ONLY) {
    const { data: existingSales, error: esErr } = await db
      .from("sales")
      .select("id, phone_number, submission_date");
    if (esErr) throw new Error(esErr.message);
    for (const s of existingSales || []) {
      saleKeyToId.set(`${s.phone_number}|${s.submission_date}`, s.id);
    }
    const { data: attRows } = await db.from("sales_attachments").select("sale_id, kind, file_name");
    existingAttachKeys = new Set(
      (attRows || []).map((a) => attachmentDedupKey(a.sale_id, { kind: a.kind, fileName: a.file_name }))
    );
    console.log(
      `Attachments-only: ${saleKeyToId.size} sales in DB, ${existingAttachKeys.size} attachments already stored`
    );
  } else {
    if (toCreate.length) {
      const { error } = await db.from("employees").insert(toCreate);
      if (error) throw new Error(`create employees: ${error.message}`);
      console.log(`Created ${toCreate.length} employees`);
    }
    for (const u of teamUpdates) {
      const { error } = await db.from("employees").update({ team: u.team }).eq("id", u.id);
      if (error) throw new Error(`team update ${u.id}: ${error.message}`);
    }

    console.log("Deleting existing sales + attachments…");
    await db.from("sales_attachments").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await db.from("sales").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  }

  let inserted = 0;
  let attachOk = 0;
  let attachFail = 0;
  let attachSkip = 0;

  async function uploadAttachmentsForSale(saleId, atts) {
    for (const att of atts) {
      const dedupKey = attachmentDedupKey(saleId, att);
      if (!FORCE_ATTACH && existingAttachKeys.has(dedupKey)) {
        attachSkip += 1;
        continue;
      }
      try {
        const up = await saleStorage.importSaleAttachmentFromUrl({
          saleId,
          kind: att.kind,
          fileName: att.fileName,
          sourceUrl: att.url,
        });
        await db.from("sales_attachments").insert({
          sale_id: saleId,
          kind: att.kind,
          file_name: up.fileName || att.fileName,
          dropbox_path: up.dropboxPath,
          dropbox_link: up.dropboxLink || null,
          uploaded_by: SUBMITTED_BY,
        });
        existingAttachKeys.add(dedupKey);
        attachOk += 1;
        await sleep(ATTACH_DELAY_MS);
      } catch (err) {
        attachFail += 1;
        console.warn(`  attachment fail sale=${saleId} ${att.fileName}: ${err.message}`);
      }
    }
  }

  if (ATTACHMENTS_ONLY) {
    let processed = 0;
    for (const row of parsed) {
      const key = `${row.phone_number}|${row.submission_date}`;
      const saleId = saleKeyToId.get(key);
      if (!saleId) {
        console.warn(`  no sale for ${key}`);
        continue;
      }
      const atts = row._attachments || [];
      if (!atts.length || SKIP_ATTACH) continue;
      await uploadAttachmentsForSale(saleId, atts);
      processed += 1;
      if (processed % 10 === 0) console.log(`  attachments progress ${processed}/${parsed.length} sales…`);
    }
  } else {
    for (let i = 0; i < parsed.length; i += CHUNK) {
      const slice = parsed.slice(i, i + CHUNK);
      const rows = slice.map(({ _attachments, ...row }) => row);
      const { data: created, error } = await db.from("sales").insert(rows).select("id");
      if (error) throw new Error(`insert sales chunk ${i}: ${error.message}`);
      inserted += rows.length;

      if (!SKIP_ATTACH) {
        for (let j = 0; j < slice.length; j++) {
          const saleId = created[j]?.id;
          await uploadAttachmentsForSale(saleId, slice[j]._attachments || []);
        }
      }
      console.log(`  inserted ${inserted}/${parsed.length} sales…`);
    }
  }

  console.log(
    `Done. Sales: ${ATTACHMENTS_ONLY ? saleKeyToId.size : inserted}, attachments ok: ${attachOk}, failed: ${attachFail}, skipped: ${attachSkip}`
  );

  if (!SKIP_ATTACH && attachOk > 0) {
    console.log("\nConfirming attachments on Dropbox…");
    await confirmDropboxAttachments(db);
  }

  try {
    const usersAdmin = require("../lib/users-admin");
    await usersAdmin.syncMissingEmployeeLogins(SUBMITTED_BY);
  } catch (err) {
    console.warn("syncMissingEmployeeLogins:", err.message);
  }

  for (const e of [...employees, ...toCreate]) {
    if (e.internal_id) {
      try {
        await syncAllInternalIdsForAppId(e.id, e.internal_id);
      } catch {
        /* best effort */
      }
    }
  }

  try {
    const store = require("../lib/data-store");
    await store.refreshCache();
    console.log("Cache refreshed");
  } catch (err) {
    console.warn("refreshCache:", err.message);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

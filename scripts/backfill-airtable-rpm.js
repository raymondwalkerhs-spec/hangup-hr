#!/usr/bin/env node
/**
 * Backfill RPM sales + completed Q Feedback + NQ Checks → Hangup RPM Airtable base.
 *
 * Usage:
 *   node scripts/backfill-airtable-rpm.js
 *   node scripts/backfill-airtable-rpm.js --dry-run
 *   node scripts/backfill-airtable-rpm.js --limit=50
 *   node scripts/backfill-airtable-rpm.js --sales-only
 *   node scripts/backfill-airtable-rpm.js --q-only
 *   node scripts/backfill-airtable-rpm.js --nq-only
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");
const { isRpmConfigured } = require("../lib/airtable-rpm-targets");
const salesSync = require("../lib/airtable-rpm-sales-sync");
const qSync = require("../lib/airtable-rpm-qfeedback-sync");
const nqSync = require("../lib/airtable-rpm-nq-sync");
const { isCompletedFeedback } = require("../lib/airtable-rpm-qfeedback-field-map");
const { isNqFamilyCheck } = require("../lib/rpm-check-status");
const { hasFormPhone } = require("../lib/airtable-rpm-nq-field-map");

const DRY_RUN = process.argv.includes("--dry-run");
const SALES_ONLY = process.argv.includes("--sales-only");
const Q_ONLY = process.argv.includes("--q-only");
const NQ_ONLY = process.argv.includes("--nq-only");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 0;
const DELAY_MS = Number(process.env.AIRTABLE_BACKFILL_DELAY_MS || 350);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!isRpmConfigured()) {
    throw new Error("RPM Airtable not configured — set AIRTABLE_RPM_TOKEN and AIRTABLE_RPM_BASE_ID in .env");
  }
  const db = getSupabaseAdmin();
  let salesOk = 0;
  let salesFailed = 0;
  let qOk = 0;
  let qFailed = 0;
  let nqOk = 0;
  let nqFailed = 0;
  let nqSkipped = 0;

  const doSales = !Q_ONLY && !NQ_ONLY;
  const doQ = !SALES_ONLY && !NQ_ONLY;
  const doNq = !SALES_ONLY && !Q_ONLY;

  if (doSales) {
    let q = db.from("rpm_sales").select("id, full_name, submission_date, airtable_record_id").order("submission_date", {
      ascending: false,
    });
    if (LIMIT > 0) q = q.limit(LIMIT);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = data || [];
    console.log(`RPM sales backfill: ${rows.length} sale(s)${DRY_RUN ? " (dry-run)" : ""}`);
    for (const row of rows) {
      const label = `${row.id} — ${row.full_name || "(no name)"} — ${String(row.submission_date || "").slice(0, 10)}`;
      if (DRY_RUN) {
        console.log(`  [dry-run] ${label}`);
        salesOk += 1;
        continue;
      }
      try {
        await salesSync.syncRpmSaleById(row.id);
        console.log(`  synced: ${label}`);
        salesOk += 1;
      } catch (err) {
        console.warn(`  FAILED: ${label} — ${err.message}`);
        salesFailed += 1;
      }
      await sleep(DELAY_MS);
    }
  }

  if (doQ) {
    let q = db
      .from("rpm_checks")
      .select("id, full_name, feedback_status, working_day, airtable_record_id")
      .is("deleted_at", null)
      .not("feedback_status", "is", null)
      .order("working_day", { ascending: false });
    if (LIMIT > 0) q = q.limit(LIMIT);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data || []).filter((r) => isCompletedFeedback(r.feedback_status));
    console.log(`Q Feedback backfill: ${rows.length} completed row(s)${DRY_RUN ? " (dry-run)" : ""}`);
    for (const row of rows) {
      const label = `${row.id} — ${row.full_name || "(no name)"} — ${row.feedback_status}`;
      if (DRY_RUN) {
        console.log(`  [dry-run] ${label}`);
        qOk += 1;
        continue;
      }
      try {
        await qSync.syncQFeedbackById(row.id);
        console.log(`  synced: ${label}`);
        qOk += 1;
      } catch (err) {
        console.warn(`  FAILED: ${label} — ${err.message}`);
        qFailed += 1;
      }
      await sleep(DELAY_MS);
    }
  }

  if (doNq) {
    let q = db
      .from("rpm_checks")
      .select("id, full_name, check_status, working_day, phone, phone_normalized, airtable_record_id")
      .is("deleted_at", null)
      .in("check_status", ["nq", "age_limit", "under_age", "duplicate"])
      .order("working_day", { ascending: false });
    if (LIMIT > 0) q = q.limit(LIMIT);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data || []).filter((r) => isNqFamilyCheck(r.check_status));
    const withPhone = rows.filter((r) => hasFormPhone(r.phone || r.phone_normalized));
    nqSkipped = rows.length - withPhone.length;
    console.log(
      `NQ Checks backfill: ${withPhone.length} with form phone, ${nqSkipped} skipped (no number)${DRY_RUN ? " (dry-run)" : ""}`
    );
    for (const row of withPhone) {
      const label = `${row.id} — ${row.full_name || "(no name)"} — ${row.check_status}`;
      if (DRY_RUN) {
        console.log(`  [dry-run] ${label}`);
        nqOk += 1;
        continue;
      }
      try {
        await nqSync.syncNqCheckById(row.id);
        console.log(`  synced: ${label}`);
        nqOk += 1;
      } catch (err) {
        console.warn(`  FAILED: ${label} — ${err.message}`);
        nqFailed += 1;
      }
      await sleep(DELAY_MS);
    }
  }

  console.log(
    `Done: sales ${salesOk} synced / ${salesFailed} failed; Q ${qOk} synced / ${qFailed} failed; NQ ${nqOk} synced / ${nqFailed} failed / ${nqSkipped} skipped (no number)`
  );
  if (salesFailed || qFailed || nqFailed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

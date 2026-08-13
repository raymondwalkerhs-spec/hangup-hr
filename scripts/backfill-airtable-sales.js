#!/usr/bin/env node
/**
 * Backfill all Supabase sales → Airtable (Sales All Data).
 *
 * Usage:
 *   node scripts/backfill-airtable-sales.js
 *   node scripts/backfill-airtable-sales.js --dry-run
 *   node scripts/backfill-airtable-sales.js --limit 50
 *   node scripts/backfill-airtable-sales.js --from 2026-01-01
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");
const airtable = require("../lib/airtable-client");
const sync = require("../lib/airtable-sales-sync");

const DRY_RUN = process.argv.includes("--dry-run");
const RESET = process.argv.includes("--reset");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const fromArg = process.argv.find((a) => a.startsWith("--from="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 0;
const FROM = fromArg ? fromArg.split("=")[1] : "";
const DELAY_MS = Number(process.env.AIRTABLE_BACKFILL_DELAY_MS || 350);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!airtable.isConfigured()) {
    throw new Error("Airtable not configured — set AIRTABLE_API_KEY and AIRTABLE_BASE_ID in .env");
  }
  const db = getSupabaseAdmin();
  if (RESET && !DRY_RUN) {
    const { error: resetErr } = await db
      .from("sales")
      .update({ airtable_record_id: null, airtable_synced_at: null, airtable_sync_error: null })
      .not("id", "is", null);
    if (resetErr) throw new Error(resetErr.message);
    airtable.clearTableSchemaCache();
    console.log("Cleared airtable_record_id on all sales (re-create in target base).");
  }
  let q = db.from("sales").select("id, full_name, submission_date, airtable_record_id").order("submission_date", {
    ascending: false,
  });
  if (FROM) q = q.gte("submission_date", FROM);
  if (LIMIT > 0) q = q.limit(LIMIT);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = data || [];
  console.log(`Airtable backfill: ${rows.length} sale(s)${DRY_RUN ? " (dry-run)" : ""}`);
  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    const label = `${row.id} — ${row.full_name || "(no name)"} — ${String(row.submission_date || "").slice(0, 10)}`;
    if (DRY_RUN) {
      console.log(`  [dry-run] ${label}`);
      ok += 1;
      continue;
    }
    try {
      await sync.syncSaleById(row.id);
      console.log(`  synced: ${label}`);
      ok += 1;
    } catch (err) {
      console.warn(`  FAILED: ${label} — ${err.message}`);
      failed += 1;
    }
    await sleep(DELAY_MS);
  }
  console.log(`Done: ${ok} synced, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

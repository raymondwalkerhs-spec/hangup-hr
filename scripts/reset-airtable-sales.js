#!/usr/bin/env node
/**
 * Wipe Airtable sales table and optionally provision + backfill from Supabase.
 *
 * Usage:
 *   node scripts/reset-airtable-sales.js --confirm-wipe
 *   node scripts/reset-airtable-sales.js --confirm-wipe --provision
 *   node scripts/reset-airtable-sales.js --confirm-wipe --backfill
 *   node scripts/reset-airtable-sales.js --confirm-wipe --provision --backfill
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");
const airtable = require("../lib/airtable-client");
const sync = require("../lib/airtable-sales-sync");
const fieldMap = require("../lib/airtable-sales-field-map");

const CONFIRM = process.argv.includes("--confirm-wipe");
const PROVISION = process.argv.includes("--provision");
const BACKFILL = process.argv.includes("--backfill");
const DRY_RUN = process.argv.includes("--dry-run");
const DELAY_MS = Number(process.env.AIRTABLE_BACKFILL_DELAY_MS || 350);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function wipeTable() {
  const table = airtable.tableName();
  console.log(`Listing records in "${table}"…`);
  const rows = await airtable.listAllRecords(table, {
    fields: fieldMap.PORTAL_SALE_ID_FIELD ? [fieldMap.PORTAL_SALE_ID_FIELD] : [],
  });
  console.log(`Found ${rows.length} row(s) to delete`);
  if (!rows.length) return 0;
  if (DRY_RUN) {
    console.log("[dry-run] skip delete");
    return rows.length;
  }
  const ids = rows.map((r) => r.id);
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    await airtable.deleteRecordsBatch(chunk);
    deleted += chunk.length;
    process.stdout.write(`\r  deleted ${deleted}/${ids.length}`);
  }
  console.log("");
  return deleted;
}

async function clearSupabaseAirtableIds() {
  const db = getSupabaseAdmin();
  const { error } = await db
    .from("sales")
    .update({ airtable_record_id: null, airtable_synced_at: null, airtable_sync_error: null })
    .not("id", "is", null);
  if (error) throw new Error(error.message);
  console.log("Cleared airtable_record_id on all sales in Supabase");
}

async function runBackfill() {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from("sales").select("id, full_name, submission_date").order("submission_date", {
    ascending: true,
  });
  if (error) throw new Error(error.message);
  const rows = data || [];
  console.log(`Backfilling ${rows.length} sale(s)…`);
  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    const label = `${row.id} — ${row.full_name || "(no name)"}`;
    if (DRY_RUN) {
      console.log(`  [dry-run] ${label}`);
      ok += 1;
      continue;
    }
    try {
      await sync.syncSaleById(row.id);
      ok += 1;
      if (ok % 25 === 0) console.log(`  synced ${ok}/${rows.length}`);
    } catch (err) {
      failed += 1;
      console.warn(`  FAILED: ${label} — ${err.message}`);
    }
    await sleep(DELAY_MS);
  }
  console.log(`Backfill done: ${ok} ok, ${failed} failed`);
  return { ok, failed, total: rows.length };
}

async function verifyBackfill() {
  const db = getSupabaseAdmin();
  const { count: saleCount, error: saleErr } = await db.from("sales").select("id", { count: "exact", head: true });
  if (saleErr) throw new Error(saleErr.message);
  const portalField = fieldMap.PORTAL_SALE_ID_FIELD;
  const airtableRows = await airtable.listAllRecords(airtable.tableName(), {
    fields: portalField ? [portalField, "Agent Name", "Closer Name", "Center Code", "Team"] : [],
  });
  const withPortalId = portalField
    ? airtableRows.filter((r) => String(r.fields?.[portalField] || "").trim())
    : airtableRows;
  console.log(`Verification: Supabase sales=${saleCount}, Airtable rows=${airtableRows.length}, with Portal Sale ID=${withPortalId.length}`);
  if (saleCount != null && withPortalId.length < saleCount) {
    console.warn(`WARNING: Airtable has fewer rows (${withPortalId.length}) than Supabase sales (${saleCount})`);
  }
  const sample = withPortalId.slice(0, 10);
  for (const row of sample) {
    const pid = portalField ? row.fields[portalField] : row.id;
    console.log(
      `  sample ${pid}: agent=${row.fields["Agent Name"] || "—"} closer=${row.fields["Closer Name"] || "—"} unit=${row.fields["Center Code"] || "—"} team=${row.fields.Team || "—"}`
    );
  }
  return { saleCount, airtableRows: airtableRows.length, withPortalId: withPortalId.length };
}

async function main() {
  if (!airtable.isConfigured()) throw new Error("Airtable not configured in .env");
  if (!CONFIRM) {
    console.error('Refusing to wipe without --confirm-wipe');
    process.exit(1);
  }
  const table = airtable.tableName();
  console.log(`Target table: "${table}" (base ${process.env.AIRTABLE_BASE_ID})`);
  if (PROVISION && !DRY_RUN) {
    console.log("Provisioning fields…");
    require("child_process").execSync("node scripts/provision-airtable-sales-fields.js", { stdio: "inherit" });
  }
  const deleted = await wipeTable();
  console.log(`Wiped ${deleted} row(s) from "${table}"`);
  if (BACKFILL) {
    if (!DRY_RUN) await clearSupabaseAirtableIds();
    const stats = await runBackfill();
    if (!DRY_RUN && stats.failed === 0) {
      await verifyBackfill();
    }
    if (stats.failed) process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

/**
 * Push Portal RPM rows that never got an Airtable record id (fail-open).
 */
const { isRpmConfigured, rpmSyncFromApp } = require("./airtable-rpm-targets");
const { getSupabaseAdmin } = require("./supabase-client");

const CATCHUP_MS = Number(process.env.AIRTABLE_RPM_CATCHUP_MS || 60000);
let timer = null;

async function catchUpUnsyncedSales({ limit = 25 } = {}) {
  if (!rpmSyncFromApp() || !isRpmConfigured()) return { skipped: true };
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("rpm_sales")
    .select("id, full_name")
    .is("airtable_record_id", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = data || [];
  if (!rows.length) return { synced: 0 };
  const salesSync = require("./airtable-rpm-sales-sync");
  let synced = 0;
  for (const row of rows) {
    try {
      await salesSync.syncRpmSaleById(row.id);
      synced += 1;
    } catch (err) {
      console.warn(`[airtable-rpm] catch-up sale ${row.id}:`, err.message);
    }
  }
  if (synced) console.log(`[airtable-rpm] catch-up synced ${synced} sale(s)`);
  return { synced };
}

function startCatchUpLoop() {
  if (timer || !rpmSyncFromApp() || !isRpmConfigured()) return;
  const run = () => {
    catchUpUnsyncedSales().catch((err) => {
      console.warn("[airtable-rpm] catch-up:", err.message);
    });
  };
  setTimeout(run, 2500);
  timer = setInterval(run, CATCHUP_MS);
}

module.exports = {
  catchUpUnsyncedSales,
  startCatchUpLoop,
};

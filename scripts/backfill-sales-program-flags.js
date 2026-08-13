/**
 * Backfill sales_mla_enabled / sales_rpm_enabled (all non-out employees):
 * - TL, OP, closers: MLA + RPM
 * - Other dialing agents: RPM only
 * - Out / deleted: unchanged
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");
const hrmsRepo = require("../lib/hrms-repo");
const {
  collectLeadershipEmployeeIds,
  resolveSalesProgramFlags,
} = require("../lib/sale-program-employee");

async function main() {
  const db = getSupabaseAdmin();
  const { data: rows, error } = await db.from("employees").select("*");
  if (error) throw new Error(error.message);

  let orgTeams = [];
  try {
    orgTeams = await hrmsRepo.readOrgTeams();
  } catch (err) {
    console.warn("[backfill] org teams unavailable, using ID prefixes only:", err.message);
  }

  const leadershipIds = collectLeadershipEmployeeIds(orgTeams);
  let leadership = 0;
  let dialingRpmOnly = 0;
  let skipped = 0;

  for (const emp of rows || []) {
    const flags = resolveSalesProgramFlags(emp, { leadershipIds });
    if (!flags) {
      skipped += 1;
      continue;
    }
    const { error: upErr } = await db
      .from("employees")
      .update({
        sales_mla_enabled: flags.sales_mla_enabled,
        sales_rpm_enabled: flags.sales_rpm_enabled,
        updated_at: new Date().toISOString(),
      })
      .eq("id", emp.id);
    if (upErr) {
      console.warn(`[skip] ${emp.id}: ${upErr.message}`);
      continue;
    }
    if (flags.sales_mla_enabled && flags.sales_rpm_enabled) leadership += 1;
    else if (!flags.sales_mla_enabled && flags.sales_rpm_enabled) dialingRpmOnly += 1;
  }

  console.log(
    `Sales program backfill complete: ${leadership} leadership (MLA+RPM), ${dialingRpmOnly} dialing agents (RPM only), ${skipped} unchanged.`
  );
  console.log("Restart the app or run Refresh to reload employee cache.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Fix imported RPM checks:
 *  - Close all still-open imported Qs (legacy placeholders / "Other")
 *  - Set created_at (and feedback_at when present) from working_day so UI matches the sheet
 *
 * Usage:
 *   node scripts/fix-imported-rpm-checks.js           # dry-run
 *   node scripts/fix-imported-rpm-checks.js --apply
 */
require("dotenv").config();
const apply = process.argv.includes("--apply");

async function main() {
  const { getSupabaseAdmin } = require("../lib/supabase-client");
  const db = getSupabaseAdmin();

  const { data: rows, error } = await db
    .from("rpm_checks")
    .select("id, working_day, created_at, feedback_at, feedback_status, check_status, info")
    .ilike("info", "%[import:%")
    .is("deleted_at", null);
  if (error) throw new Error(error.message);

  const all = rows || [];
  const openQs = all.filter((r) => r.check_status === "q" && !r.feedback_status);
  const dateFixes = all.filter((r) => {
    const wd = String(r.working_day || "").slice(0, 10);
    const cd = String(r.created_at || "").slice(0, 10);
    return wd && /^\d{4}-\d{2}-\d{2}$/.test(wd) && cd !== wd;
  });

  console.log(`Imported checks: ${all.length}`);
  console.log(`Open imported Qs to close: ${openQs.length}`);
  console.log(`created_at ≠ working_day: ${dateFixes.length}`);
  if (!apply) {
    console.log("Dry-run only. Re-run with --apply to write.");
    return;
  }

  let closed = 0;
  let dated = 0;
  let errors = 0;

  // Close open Qs in batches
  const CLOSE_STATUS = "dropped_with_client";
  for (let i = 0; i < openQs.length; i += 50) {
    const batch = openQs.slice(i, i + 50);
    for (const row of batch) {
      const wd = String(row.working_day || "").slice(0, 10);
      const stamp = wd && /^\d{4}-\d{2}-\d{2}$/.test(wd) ? `${wd}T12:00:00.000Z` : new Date().toISOString();
      const info = String(row.info || "").trim();
      const note = "[legacy-closed:import]";
      const nextInfo = info.includes(note) ? info : `${info}\n${note}`.trim();
      const { error: upErr } = await db
        .from("rpm_checks")
        .update({
          feedback_status: CLOSE_STATUS,
          feedback_by: "import:xlsx-legacy-close",
          feedback_at: stamp,
          created_at: stamp,
          info: nextInfo,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (upErr) {
        errors += 1;
        console.error("close failed", row.id, upErr.message);
      } else {
        closed += 1;
      }
    }
  }

  // Fix dates on remaining imports (already dispositioned / non-Q)
  const remaining = dateFixes.filter((r) => !openQs.some((o) => o.id === r.id));
  for (let i = 0; i < remaining.length; i += 50) {
    const batch = remaining.slice(i, i + 50);
    for (const row of batch) {
      const wd = String(row.working_day || "").slice(0, 10);
      const stamp = `${wd}T12:00:00.000Z`;
      const patch = {
        created_at: stamp,
        updated_at: new Date().toISOString(),
      };
      if (row.feedback_at) {
        const fd = String(row.feedback_at).slice(0, 10);
        if (fd !== wd) patch.feedback_at = stamp;
      }
      const { error: upErr } = await db.from("rpm_checks").update(patch).eq("id", row.id);
      if (upErr) {
        errors += 1;
        console.error("date fix failed", row.id, upErr.message);
      } else {
        dated += 1;
      }
    }
  }

  console.log(`Closed: ${closed}; date-fixed: ${dated}; errors: ${errors}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

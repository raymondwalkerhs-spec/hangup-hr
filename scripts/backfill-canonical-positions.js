/**
 * Align employee.position with position_rates names (only when salaries match).
 *
 *   node scripts/backfill-canonical-positions.js --dry-run
 *   node scripts/backfill-canonical-positions.js
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");
const { resolveCanonicalPosition } = require("../lib/position-canonical");

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const db = getSupabaseAdmin();
  const { data: rates, error: rateErr } = await db.from("position_rates").select("position, monthly_salary");
  if (rateErr) throw rateErr;

  const rateRows = (rates || []).map((r) => ({
    position: r.position,
    monthlySalary: Number(r.monthly_salary),
  }));

  const { data: employees, error: empErr } = await db
    .from("employees")
    .select("id, position, american_name");
  if (empErr) throw empErr;

  let updated = 0;
  for (const emp of employees || []) {
    const current = String(emp.position || "").trim();
    const canonical = resolveCanonicalPosition(current, rateRows);
    if (!canonical || canonical === current) continue;

    console.log(
      `${DRY_RUN ? "[dry-run] " : ""}${emp.id} (${emp.american_name || "—"}): "${current}" → "${canonical}"`
    );
    updated += 1;
    if (!DRY_RUN) {
      const { error } = await db
        .from("employees")
        .update({ position: canonical, updated_at: new Date().toISOString() })
        .eq("id", emp.id);
      if (error) throw error;
    }
  }

  if (!updated) console.log("All employee positions already match position_rates.");
  else console.log(`${DRY_RUN ? "Would update" : "Updated"} ${updated} employee(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

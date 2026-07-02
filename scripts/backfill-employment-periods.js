/**
 * Safe backfill of employment_periods from employees.employment_date.
 * Skips rows where employment_date is not a valid ISO date.
 * Run: node scripts/backfill-employment-periods.js
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");

function parseDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T12:00:00");
  return Number.isNaN(d.getTime()) ? null : s;
}

async function main() {
  const db = getSupabaseAdmin();
  const { data: employees, error } = await db.from("employees").select("id, employment_date, depart_date, status");
  if (error) throw error;

  let inserted = 0;
  let skipped = 0;
  for (const e of employees || []) {
    const { count } = await db
      .from("employment_periods")
      .select("id", { count: "exact", head: true })
      .eq("employee_id", e.id);
    if (count > 0) continue;

    const start = parseDate(e.employment_date);
    if (!start) {
      console.warn(`Skip ${e.id}: invalid employment_date "${e.employment_date}"`);
      skipped += 1;
      continue;
    }
    const end = parseDate(e.depart_date);
    const { error: insErr } = await db.from("employment_periods").insert({
      employee_id: e.id,
      start_date: start,
      end_date: end,
      is_current: !end,
      notes: "Backfilled from legacy employment_date",
    });
    if (insErr) throw insErr;
    inserted += 1;
    console.log(`Backfilled period for ${e.id}: ${start}${end ? ` → ${end}` : ""}`);
  }
  console.log(`Done. Inserted ${inserted}, skipped ${skipped}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

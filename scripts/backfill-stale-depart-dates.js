/**
 * One-time cleanup: stale depart_date on non-Out employees and invalid employment_periods.
 *
 *   node scripts/backfill-stale-depart-dates.js --dry-run
 *   node scripts/backfill-stale-depart-dates.js
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");
const { isOutStatus } = require("../lib/employee-status");
const { parseIsoDate } = require("../lib/date-iso");

const DRY_RUN = process.argv.includes("--dry-run");

function parseDate(val) {
  return parseIsoDate(val);
}

function minDate(...vals) {
  const dates = vals.map(parseDate).filter(Boolean);
  if (!dates.length) return "";
  return dates.sort()[0];
}

function maxDate(...vals) {
  const dates = vals.map(parseDate).filter(Boolean);
  if (!dates.length) return "";
  return dates.sort().pop();
}

async function main() {
  const db = getSupabaseAdmin();
  const { data: employees, error: empErr } = await db
    .from("employees")
    .select("id, status, employment_date, depart_date, american_name");
  if (empErr) throw empErr;

  const empById = new Map((employees || []).map((e) => [e.id, e]));
  let clearedDepart = 0;

  for (const emp of employees || []) {
    const depart = parseDate(emp.depart_date);
    if (!depart || isOutStatus(emp.status)) continue;

    console.log(
      `${DRY_RUN ? "[dry-run] " : ""}Clear stale depart_date on ${emp.id} (${emp.status}) was ${emp.depart_date}`
    );
    clearedDepart += 1;
    if (!DRY_RUN) {
      const { error } = await db
        .from("employees")
        .update({ depart_date: null, updated_at: new Date().toISOString() })
        .eq("id", emp.id);
      if (error) throw error;
    }
    emp.depart_date = null;
  }

  const { data: periods, error: perErr } = await db.from("employment_periods").select("*");
  if (perErr) throw perErr;

  let fixedPeriods = 0;
  let reopenedActive = 0;

  for (const period of periods || []) {
    const emp = empById.get(period.employee_id);
    if (!emp) continue;

    const start = parseDate(period.start_date);
    const end = parseDate(period.end_date);
    const hire = parseDate(emp.employment_date);
    const depart = parseDate(emp.depart_date);
    const patch = {};

    if (start && end && end < start) {
      const newStart = minDate(hire, start, end);
      const newEnd = isOutStatus(emp.status) ? depart || maxDate(start, end) : null;
      patch.start_date = newStart || start;
      patch.end_date = newEnd || null;
      patch.is_current = !isOutStatus(emp.status);
      fixedPeriods += 1;
      console.log(
        `${DRY_RUN ? "[dry-run] " : ""}Fix invalid period ${period.employee_id}: ${period.start_date}–${period.end_date} → ${patch.start_date}–${patch.end_date || "(open)"}`
      );
    } else if (
      !isOutStatus(emp.status) &&
      end &&
      !period.is_current &&
      !parseDate(emp.depart_date)
    ) {
      patch.start_date = hire || start;
      patch.end_date = null;
      patch.is_current = true;
      reopenedActive += 1;
      console.log(
        `${DRY_RUN ? "[dry-run] " : ""}Reopen period for ${emp.status} ${period.employee_id} (was closed ${period.end_date})`
      );
    }

    if (Object.keys(patch).length && !DRY_RUN) {
      patch.updated_at = new Date().toISOString();
      const { error } = await db.from("employment_periods").update(patch).eq("id", period.id);
      if (error) throw error;
    }
  }

  console.log("\nSummary:");
  console.log(`  Cleared stale depart_date (non-Out): ${clearedDepart}`);
  console.log(`  Fixed invalid employment periods (end < start): ${fixedPeriods}`);
  console.log(`  Reopened periods for active/paused staff: ${reopenedActive}`);
  if (DRY_RUN) console.log("\nDry run only — no rows written.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
/** Backfill sales.working_day and sales.submission_time from submission_date. */
require("dotenv").config();
const workingDay = require("../lib/sales-working-day");
const { getSupabaseAdmin } = require("../lib/supabase-client");

async function main() {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from("sales").select("id, submission_date, working_day, submission_time");
  if (error) throw new Error(error.message);
  let n = 0;
  for (const row of data || []) {
    if (row.working_day && row.submission_time) continue;
    const dates = workingDay.enrichSaleDates({}, row.submission_date);
    await db
      .from("sales")
      .update({ working_day: dates.workingDay, submission_time: dates.submissionTime })
      .eq("id", row.id);
    n += 1;
  }
  console.log(`Backfilled ${n} sales row(s).`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

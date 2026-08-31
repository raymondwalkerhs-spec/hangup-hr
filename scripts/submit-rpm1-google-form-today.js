#!/usr/bin/env node
/**
 * One-shot: ask Supabase Edge Function to submit today's RPM1 sales to Google Form.
 * Does NOT POST Google from the desktop app — only invokes rpm-google-form-sync.
 *
 *   node scripts/submit-rpm1-google-form-today.js
 *   node scripts/submit-rpm1-google-form-today.js --dry-run
 *   node scripts/submit-rpm1-google-form-today.js --force
 *
 * Env: SUPABASE_URL, SUPABASE_SECRET_KEY
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");
const { currentWorkingDay } = require("../lib/sales-working-day");
const { isRpm1Client } = require("../lib/rpm-google-form");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function requireEnv(name) {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");
  const day = currentWorkingDay();
  const baseUrl = requireEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceKey = requireEnv("SUPABASE_SECRET_KEY");
  const functionUrl = `${baseUrl}/functions/v1/rpm-google-form-sync`;

  console.log(`Working day: ${day}`);
  console.log(`Supabase function: ${functionUrl}`);
  if (dryRun) console.log("DRY RUN — no function calls");

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("rpm_sales")
    .select(
      "id, client, full_name, phone_number, member_id, form_data, working_day, created_at, google_form_submitted_at, google_form_sync_error"
    )
    .eq("working_day", day)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (data || []).filter((r) => isRpm1Client(r));
  console.log(`RPM1 sales today: ${rows.length} (of ${(data || []).length} total)`);

  let ok = 0;
  let fail = 0;
  let skip = 0;
  for (const sale of rows) {
    if (sale.google_form_submitted_at && !force) {
      console.log(`skip ${sale.id} already submitted ${sale.google_form_submitted_at}`);
      skip += 1;
      continue;
    }
    if (dryRun) {
      console.log(`dry ${sale.id} ${sale.full_name} ${sale.member_id}`);
      ok += 1;
      continue;
    }

    // Shape matches what the INSERT trigger sends (snake_case DB row).
    const record = {
      id: sale.id,
      client: sale.client,
      full_name: sale.full_name,
      phone_number: sale.phone_number,
      member_id: sale.member_id,
      form_data: sale.form_data,
      working_day: sale.working_day,
    };

    const res = await fetch(functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ type: "INSERT", table: "rpm_sales", record }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) {
      fail += 1;
      console.error(`FAIL ${sale.id}:`, body.error || body.skipped || res.status);
    } else if (body.skipped) {
      skip += 1;
      console.log(`skip ${sale.id} ${body.skipped}`);
    } else {
      ok += 1;
      console.log(`ok ${sale.id} ${sale.full_name}`);
    }
    await sleep(400);
  }

  console.log(`Done. ok=${ok} fail=${fail} skip=${skip}`);
  if (fail) process.exit(1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

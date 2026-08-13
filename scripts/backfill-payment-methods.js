#!/usr/bin/env node
/**
 * Normalize employees.payment_method and payroll_adjustments.payment_method
 * to canonical keys: cash | instapay | bank
 *
 *   node scripts/backfill-payment-methods.js
 *   node scripts/backfill-payment-methods.js --dry-run
 */
require("dotenv").config();
const { normalizePaymentMethodValue } = require("../lib/hr-constants");

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const { getSupabaseAdmin } = require("../lib/supabase-client");
  const client = getSupabaseAdmin();

  let empUpdated = 0;
  let adjUpdated = 0;

  const { data: employees, error: empErr } = await client.from("employees").select("id, payment_method");
  if (empErr) throw empErr;

  for (const row of employees || []) {
    const normalized = normalizePaymentMethodValue(row.payment_method);
    const current = row.payment_method || "";
    if (normalized === current || (!normalized && !current)) continue;
    console.log(`employee ${row.id}: "${current}" -> "${normalized}"`);
    if (!dryRun) {
      const { error } = await client
        .from("employees")
        .update({ payment_method: normalized || null })
        .eq("id", row.id);
      if (error) throw error;
    }
    empUpdated++;
  }

  const { data: adjustments, error: adjErr } = await client
    .from("payroll_adjustments")
    .select("employee_id, year_month, payment_method");
  if (adjErr) throw adjErr;

  for (const row of adjustments || []) {
    const normalized = normalizePaymentMethodValue(row.payment_method);
    const current = row.payment_method || "";
    if (normalized === current || (!normalized && !current)) continue;
    console.log(`payroll ${row.employee_id} ${row.year_month}: "${current}" -> "${normalized}"`);
    if (!dryRun) {
      const { error } = await client
        .from("payroll_adjustments")
        .update({ payment_method: normalized || null })
        .eq("employee_id", row.employee_id)
        .eq("year_month", row.year_month);
      if (error) throw error;
    }
    adjUpdated++;
  }

  console.log(
    dryRun
      ? `Dry run: would update ${empUpdated} employees, ${adjUpdated} payroll rows`
      : `Updated ${empUpdated} employees, ${adjUpdated} payroll rows`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

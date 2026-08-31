#!/usr/bin/env node
/**
 * Deactivate app_users for all employees with lifecycle Out status.
 * Usage: node scripts/backfill-out-user-deactivation.js [--dry-run]
 */
require("dotenv").config();

const store = require("../lib/data-store");
const loginSync = require("../lib/employee-login-sync");

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  await store.refreshCache?.().catch(() => {});
  const employees = store.getEmployees() || [];
  const outEmployees = employees.filter((e) => loginSync.shouldDisableLoginForEmployee(e));
  console.log(`Found ${outEmployees.length} Out employee(s).`);
  if (dryRun) {
    for (const emp of outEmployees) {
      console.log(`  would disable: ${emp.id} (${emp.status}) depart=${emp.depart_date || "—"}`);
    }
    return;
  }
  const results = await loginSync.disableLoginsForAllDepartedEmployees("backfill-out-login");
  console.log("Disabled:", results.disabled.length);
  for (const row of results.disabled) {
    console.log(`  ${row.employeeId} → ${row.username}`);
  }
  if (results.skipped.length) console.log("Skipped:", results.skipped.length);
  if (results.errors.length) {
    console.error("Errors:", results.errors.length);
    for (const err of results.errors) console.error(`  ${err.employeeId}: ${err.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

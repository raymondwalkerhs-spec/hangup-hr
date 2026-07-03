/**
 * Bulk-set transport eligibility directly in Google Sheets (no local SQLite cache).
 *
 * Usage:
 *   node scripts/set-transport-eligibility.js 2026-06 false
 *   node scripts/set-transport-eligibility.js 2026-07 true
 */
const { loadEnvironment } = require("../lib/app-bootstrap");

loadEnvironment();

const sheets = require("./lib/sheets");

async function main() {
  const month = process.argv[2];
  const eligibleArg = (process.argv[3] || "true").toLowerCase();
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    console.error("Usage: node scripts/set-transport-eligibility.js YYYY-MM true|false");
    process.exit(1);
  }
  const eligible = !["false", "0", "no"].includes(eligibleArg);

  console.log(`Setting transport eligible=${eligible} for all employees in ${month}…`);
  const count = await sheets.bulkSetTransportEligibleForMonth(month, eligible, "script");
  console.log(`Updated ${count} month profile(s) in Payroll_Adjustments.`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

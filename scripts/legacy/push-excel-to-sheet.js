/**
 * Push Excel-derived JSON (hr-system/data) into the live Google Sheet.
 * One-time migration tooling — Google Sheet is the source of truth after migration.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const sheets = require("./lib/sheets");

const DATA_DIR = path.join(__dirname, "..", "..", "hr-system", "data");

function loadJson(name, fallback = null) {
  const p = path.join(DATA_DIR, name);
  if (!fs.existsSync(p)) {
    if (fallback !== null) return fallback;
    throw new Error(`Missing ${p} — run: python scripts/import_data.py`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  const args = process.argv.slice(2);
  const skipAttendance = args.includes("--skip-attendance");
  const monthIdx = args.indexOf("--month");
  const targetMonth = monthIdx >= 0 ? args[monthIdx + 1] : "2026-06";

  console.log("Verifying sheet access…");
  await sheets.verifySheetAccess();

  const employees = loadJson("employees.json");
  const rates = loadJson("position_rates.json");
  const config = loadJson("config.json");
  const attendance = loadJson("attendance.json");
  const bonuses = loadJson("bonuses.json");
  const deductions = loadJson("deductions.json");
  const commissionTypes = loadJson("commission_types.json", []);
  const payrollAdjustments = loadJson("payroll_adjustments.json", []);

  console.log(`Writing ${employees.length} employees…`);
  await sheets.writeEmployeeDatabase(employees);

  console.log(`Writing ${rates.length} position rates…`);
  await sheets.writePositionRates(rates);

  console.log("Writing app config…");
  await sheets.writeFullConfig(config);

  if (commissionTypes.length) {
    console.log(`Writing ${commissionTypes.length} commission types…`);
    await sheets.writeCommissionTypes(commissionTypes);
  }

  const monthAdj = payrollAdjustments.filter((a) => a.yearMonth === targetMonth);
  if (monthAdj.length) {
    console.log(`Writing ${monthAdj.length} payroll adjustments for ${targetMonth}…`);
    await sheets.clearPayrollAdjustmentsMonth(targetMonth);
    await sheets.batchWritePayrollAdjustments(monthAdj, "excel-import");
  }

  if (!skipAttendance && attendance[targetMonth]) {
    const records = attendance[targetMonth];
    console.log(`Clearing & writing ${records.length} attendance rows for ${targetMonth}…`);
    await sheets.clearAttendanceMonth(targetMonth);
    await sheets.batchWriteAttendance(records, "excel-import");
  }

  const monthBonuses = bonuses.filter((b) => b.date?.startsWith(targetMonth));
  const monthDeductions = deductions.filter((d) => d.date?.startsWith(targetMonth));
  if (monthBonuses.length) {
    console.log(`Writing ${monthBonuses.length} bonus events…`);
    await sheets.batchWriteBonuses(monthBonuses, "excel-import");
  }
  if (monthDeductions.length) {
    console.log(`Writing ${monthDeductions.length} deduction events…`);
    await sheets.batchWriteDeductions(monthDeductions, "excel-import");
  }

  console.log("\nDone! Sheet populated from Excel migration data.");
  console.log(`  Employees: ${employees.length}`);
  console.log(`  Position rates: ${rates.length}`);
  console.log(`  Commission types: ${commissionTypes.length}`);
  console.log(`  Payroll adjustments (${targetMonth}): ${monthAdj.length}`);
  if (!skipAttendance) console.log(`  Attendance (${targetMonth}): ${attendance[targetMonth]?.length || 0}`);
  console.log(`  Bonuses (${targetMonth}): ${monthBonuses.length}`);
  console.log(`  Deductions (${targetMonth}): ${monthDeductions.length}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

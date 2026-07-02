/**
 * Compare June payroll: Excel Payroll_June2026 vs app buildPayroll().
 * Run from hr-app: node scripts/reconcile-june.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const path = require("path");
const { execSync } = require("child_process");
const fs = require("fs");

const ROOT = path.join(__dirname, "..", "..");
const XLSX = path.join(ROOT, "HR System June 2026 V.2 (1).xlsx");
const DATA_DIR = path.join(ROOT, "hr-system", "data");
const MONTH = "2026-06";
const TOLERANCE = 1;

function ensureImportData() {
  if (!fs.existsSync(path.join(DATA_DIR, "employees.json"))) {
    console.log("Running import_data.py…");
    execSync("python ../scripts/import_data.py", {
      cwd: path.join(__dirname, ".."),
      stdio: "inherit",
    });
  }
}

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf8"));
}

function readExcelNetSalaries() {
  if (!fs.existsSync(XLSX)) {
    console.warn("Excel file not found — skipping Excel comparison");
    return new Map();
  }
  const out = execSync("python ../scripts/read_excel_net_salaries.py", {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
  });
  return new Map(Object.entries(JSON.parse(out.trim())));
}

function main() {
  ensureImportData();

  const { buildPayroll } = require("../lib/payroll");
  const { summarizeEmployeeMonth, isPayrollEligible } = require("../lib/attendance");

  const employees = loadJson("employees.json");
  const config = loadJson("config.json");
  const rates = loadJson("position_rates.json");
  const attendance = loadJson("attendance.json")[MONTH] || [];
  const bonuses = loadJson("bonuses.json").filter((b) => b.date?.startsWith(MONTH));
  const deductions = loadJson("deductions.json").filter((d) => d.date?.startsWith(MONTH));
  const adjustments = loadJson("payroll_adjustments.json").filter((a) => a.yearMonth === MONTH);

  const eligible = employees.filter(isPayrollEligible);
  const summaries = eligible.map((emp) =>
    summarizeEmployeeMonth(
      emp,
      attendance.filter((r) => r.employeeId === emp.id),
      config
    )
  );

  const payroll = buildPayroll(
    eligible,
    summaries,
    MONTH,
    config,
    rates,
    bonuses,
    deductions,
    adjustments
  );

  const excelNet = readExcelNetSalaries();
  const deltas = [];
  const matched = [];
  const missingExcel = [];

  for (const row of payroll) {
    const excel = excelNet.get(row.employeeId);
    if (excel == null) {
      missingExcel.push(row.employeeId);
      continue;
    }
    const delta = Math.abs(row.netSalary - excel);
    if (delta > TOLERANCE) {
      deltas.push({
        employeeId: row.employeeId,
        name: row.name,
        app: row.netSalary,
        excel,
        delta: Math.round(delta * 100) / 100,
      });
    } else {
      matched.push(row.employeeId);
    }
  }

  console.log(`\n=== June ${MONTH} Payroll Reconciliation ===\n`);
  console.log(`Payroll-eligible employees: ${payroll.length}`);
  console.log(`Matched within ${TOLERANCE} EGP: ${matched.length}`);
  console.log(`Mismatches: ${deltas.length}`);
  console.log(`Not in Excel payroll tab: ${missingExcel.length}`);

  if (deltas.length) {
    console.log("\n--- Mismatches (sample up to 20) ---");
    deltas
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 20)
      .forEach((d) => {
        console.log(
          `${d.employeeId} (${d.name}): app=${d.app} excel=${d.excel} delta=${d.delta}`
        );
      });
  } else {
    console.log("\nAll compared employees match Excel within tolerance.");
  }

  const reportPath = path.join(DATA_DIR, `reconcile-${MONTH}.json`);
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ month: MONTH, matched: matched.length, deltas, missingExcel }, null, 2)
  );
  console.log(`\nReport written to ${reportPath}`);
  process.exit(deltas.length ? 1 : 0);
}

main();

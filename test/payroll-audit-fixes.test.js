#!/usr/bin/env node
/** Regression tests for payroll audit fixes. */
const assert = require("assert");
const { calcPayrollRow } = require("../lib/payroll");
const { summarizeEmployeeMonth } = require("../lib/attendance");
const { evaluateProgramSales } = require("../lib/training-pay-rules");
const {
  enrichPayrollRow,
  buildDeferredTrainingRow,
} = require("../lib/training-payroll");
const { applyPayrollHybridDbToRow } = require("../lib/payroll-hybrid");
const { calcNoticePeriodBasicScale } = require("../lib/resignation-payroll");

function test(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

const baseConfig = {
  latenessRules: { tierA: { amount: 25 }, tierB: { amount: 50 } },
  workingDaysByMonth: { "2026-07": 22 },
  transportAllowanceMonthly: 3000,
  taxRules: { incomeTaxRate: 10, socialInsuranceRate: 5 },
};

const rates = [{ position: "Agent", monthlySalary: 12000 }];

console.log("payroll-audit-fixes");

test("salaryRaise increases basic salary and daily rate", () => {
  const emp = { id: "A1", american_name: "Agent", position: "Agent", unit: "HS3" };
  const summary = {
    workingDays: 20,
    halfDays: 0,
    quarterOff: 0,
    nsnc: 0,
    nsncHalf: 0,
    latenessDeductions: 0,
    latenessDetail: "",
    daysOff: 0,
    wfh: 0,
    extraDays: 0,
  };
  const row = calcPayrollRow(
    emp,
    summary,
    "2026-07",
    baseConfig,
    rates,
    [],
    [],
    { salaryRaise: 500 },
    [],
    [],
    [],
    [],
    [],
    [],
    []
  );
  assert.equal(row.monthlySalary, 12500);
  assert.ok(row.basicSalary > 0);
  const expectedBasic = Math.round((20 * (12500 / 22)) * 100) / 100;
  assert.equal(row.basicSalary, expectedBasic);
});

test("AIP lateness uses 75 EGP not sheet 25 when plan active", () => {
  const emp = { id: "A2", american_name: "Agent", position: "Agent", unit: "HS3" };
  const records = [{ date: "2026-07-14", status: "Lateness A" }];
  const summary = summarizeEmployeeMonth(emp, records, baseConfig, [
    { employeeId: "A2", status: "active", weekStart: "2026-07-13", weekEnd: "2026-07-17" },
  ]);
  const row = calcPayrollRow(
    emp,
    summary,
    "2026-07",
    baseConfig,
    rates,
    [],
    [{ employeeId: "A2", date: "2026-07-14", type: "Lateness Deduction", amount: 25 }],
    null,
    records,
    [],
    [],
    [],
    [{ employeeId: "A2", status: "active", weekStart: "2026-07-13", weekEnd: "2026-07-17" }],
    [],
    {}
  );
  assert.equal(row.latenessDeduction, 75);
});

test("tax rules apply when configured", () => {
  const emp = { id: "A3", american_name: "Agent", position: "Agent", unit: "HS3" };
  const summary = {
    workingDays: 10,
    halfDays: 0,
    quarterOff: 0,
    nsnc: 0,
    nsncHalf: 0,
    latenessDeductions: 0,
    latenessDetail: "",
    daysOff: 0,
    wfh: 0,
    extraDays: 0,
  };
  const row = calcPayrollRow(emp, summary, "2026-07", baseConfig, rates, [], [], null, [], [], [], [], [], [], {});
  assert.ok(row.taxAmount > 0);
  assert.ok(row.statutoryDeductions > 0);
});

test("evaluateProgramSales requires all phase rows met", () => {
  const onlyPhase2 = evaluateProgramSales([
    { phaseNumber: 2, salesPassed: 12 },
  ]);
  assert.equal(onlyPhase2.readyToPass, false);
  assert.equal(onlyPhase2.phaseTargetsMet, false);

  const allPhases = evaluateProgramSales([
    { phaseNumber: 2, salesPassed: 4 },
    { phaseNumber: 3, salesPassed: 4 },
    { phaseNumber: 4, salesPassed: 4 },
  ]);
  assert.equal(allPhases.readyToPass, true);
});

test("deferred training month shows zero net but accrued preview", () => {
  const standardRow = {
    employeeId: "T1",
    name: "Trainee",
    netSalary: 8000,
    basicSalary: 7500,
    totalBonuses: 500,
    totalDeductions: 0,
    totalWorkingDays: 10,
  };
  const deferred = buildDeferredTrainingRow(standardRow, "2026-07", {
    totalWorkingDays: 20,
    scopedDayCount: 20,
    earnedNetSalary: 12000,
    earnedBasicSalary: 12000,
    basicSalary: 12000,
    netSalary: 12000,
    trainingSpanMonths: ["2026-06", "2026-07"],
  });
  assert.equal(deferred.payrollKind, "training_deferred_month");
  assert.equal(deferred.netSalary, 0);
  assert.equal(deferred.basicSalary, 0);
  assert.equal(deferred.totalWorkingDays, 20);
  assert.equal(deferred.earnedNetSalary, 12000);
  assert.equal(deferred.workingDaysInMonth, 20);
  assert.equal(deferred.monthlySalary, 12000);
});

test("active trainee non-anchor month is deferred with zero pay", () => {
  const emp = { id: "T1", american_name: "Trainee", position: "Trainee", unit: "HS3" };
  const standardRow = { employeeId: "T1", name: "Trainee", netSalary: 5000, basicSalary: 5000 };
  const program = {
    outcome: "active",
    allPhases: [
      { phaseNumber: 1, weekStart: "2026-06-23", weekEnd: "2026-06-27", status: "passed" },
      { phaseNumber: 2, weekStart: "2026-06-30", weekEnd: "2026-07-04", status: "passed" },
      { phaseNumber: 3, weekStart: "2026-07-07", weekEnd: "2026-07-11", status: "passed" },
      { phaseNumber: 4, weekStart: "2026-07-14", weekEnd: "2026-07-18", status: "passed" },
    ],
  };
  const att = [
    { date: "2026-07-01", status: "Attended" },
    { date: "2026-07-02", status: "Attended" },
    { date: "2026-07-03", status: "Attended" },
    { date: "2026-07-14", status: "Attended" },
  ];
  const programPayroll = {
    attendanceRecords: att,
    bonusEvents: [],
    deductionEvents: [],
    months: ["2026-06", "2026-07"],
  };
  const row = enrichPayrollRow(
    emp,
    standardRow,
    {
      ym: "2026-06",
      config: baseConfig,
      rates,
      attendanceRecords: att,
      bonusEvents: [],
      deductionEvents: [],
    },
    program,
    programPayroll
  );
  assert.equal(row.payrollKind, "training_deferred_month");
  assert.equal(row.netSalary, 0);
  assert.equal(row.totalWorkingDays, 4);
  assert.equal(row.earnedBasicSalary, 2400);
  assert.ok(Number(row.earnedNetSalary) >= 2400);
});

test("hybrid DB does not overwrite dual payroll scoped portions", () => {
  const dual = {
    payrollKind: "dual",
    training: { employeeId: "D1", basicSalary: 2400, totalWorkingDays: 4, netSalary: 2400, calculatedNet: 2400 },
    agent: { employeeId: "D1", basicSalary: 3000, totalWorkingDays: 11, netSalary: 3000, calculatedNet: 3000 },
    combinedNet: 5400,
  };
  const dbRow = { working_days: 22, basic_salary: 9900, transport_allowance: 0 };
  const merged = applyPayrollHybridDbToRow(dual, dbRow);
  assert.equal(merged.training.basicSalary, 2400);
  assert.equal(merged.agent.basicSalary, 3000);
  assert.equal(merged.combinedNet, 5400);
});

test("notice scale uses partial month basic concept", () => {
  const scale = calcNoticePeriodBasicScale({ basicSalary: 5000, passedSalesInNotice: 7 });
  assert.equal(scale.payPercent, 70);
  assert.equal(scale.scaledBasic, 3500);
});

if (process.exitCode) {
  console.error("\nSome payroll audit tests failed.");
  process.exit(process.exitCode);
}
console.log("\nAll payroll audit tests passed.");

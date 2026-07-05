#!/usr/bin/env node
/** Unit tests for training pay rules and resignation notice scale. */
const assert = require("assert");
const rules = require("../lib/training-pay-rules");
const resignation = require("../lib/resignation-payroll");

function test(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

console.log("training-pay-rules");
test("phase 1 days excluded from pay", () => {
  const program = {
    outcome: "active",
    allPhases: [
      { phaseNumber: 1, weekStart: "2026-07-06", weekEnd: "2026-07-10", status: "passed" },
      { phaseNumber: 2, weekStart: "2026-07-13", weekEnd: "2026-07-17", status: "passed" },
    ],
  };
  const att = [{ date: "2026-07-07", status: "Attended" }, { date: "2026-07-14", status: "Attended" }];
  const days = rules.computeEligibleTrainingPayDates(program, att, "2026-07");
  assert(!days.has("2026-07-07"), "phase 1 day should be unpaid");
  assert(days.has("2026-07-14"), "phase 2 day should be paid");
});

test("voluntary leave pays zero", () => {
  const program = {
    outcome: "voluntary_leave",
    allPhases: [{ phaseNumber: 2, weekStart: "2026-07-13", weekEnd: "2026-07-17", status: "passed" }],
  };
  const days = rules.computeEligibleTrainingPayDates(program, [{ date: "2026-07-14", status: "Attended" }], "2026-07");
  assert.equal(days.size, 0);
});

test("dual payroll when promotion mid-month", () => {
  const program = {
    outcome: "passed",
    promotionEffectiveDate: "2026-07-15",
    allPhases: [
      { phaseNumber: 2, weekStart: "2026-07-06", weekEnd: "2026-07-10", status: "passed" },
      { phaseNumber: 3, weekStart: "2026-07-13", weekEnd: "2026-07-17", status: "passed" },
    ],
  };
  assert(rules.hasDualPayrollInMonth(program, "2026-07"));
  const agentDays = rules.computeAgentPayDates(program, "2026-07");
  assert(agentDays.has("2026-07-15"));
  assert(!agentDays.has("2026-07-14"));
});

test("12 sale minimum evaluation", () => {
  const phases = [
    { phaseNumber: 2, salesPassed: 4 },
    { phaseNumber: 3, salesPassed: 4 },
    { phaseNumber: 4, salesPassed: 4 },
  ];
  const ev = rules.evaluateProgramSales(phases);
  assert(ev.meetsMinimum12);
  assert(ev.readyToPass);
});

console.log("training-payroll");
test("4 WFH days in phase 2 pay 2400 basic", () => {
  const { enrichPayrollRow } = require("../lib/training-payroll");
  const { TRAINING_DAILY_RATE } = require("../lib/training-pay-rules");
  const emp = { id: "HS3-36", american_name: "Trainee WFH", unit: "HS3", position: "Trainee" };
  const standardRow = { employeeId: "HS3-36", name: "Trainee WFH", netSalary: 0, basicSalary: 0 };
  const program = {
    outcome: "active",
    allPhases: [{ phaseNumber: 2, weekStart: "2026-07-13", weekEnd: "2026-07-17", status: "passed" }],
  };
  const att = [
    { date: "2026-07-14", status: "WFH" },
    { date: "2026-07-15", status: "WFH" },
    { date: "2026-07-16", status: "WFH" },
    { date: "2026-07-17", status: "WFH" },
  ];
  const ctx = {
    ym: "2026-07",
    config: { latenessRules: { tierA: { amount: 50 }, tierB: { amount: 100 } }, workingDaysByMonth: { "2026-07": 22 } },
    actionPlans: [],
    rates: [{ position: "Trainee", monthlySalary: 12000 }],
    bonusEvents: [],
    deductionEvents: [],
    adjustment: null,
    attendanceRecords: att,
    commissionTiers: [],
    loans: [],
    loanPayments: [],
    allPayrollSplits: [],
  };
  const row = enrichPayrollRow(emp, standardRow, ctx, program);
  assert.equal(row.basicSalary, 4 * TRAINING_DAILY_RATE);
  assert.equal(row.totalWorkingDays, 4);
});

test("Attended + WFH mix counts all pay units", () => {
  const { enrichPayrollRow } = require("../lib/training-payroll");
  const { TRAINING_DAILY_RATE } = require("../lib/training-pay-rules");
  const emp = { id: "T02", american_name: "Mix Trainee", unit: "NW", position: "Trainee" };
  const standardRow = { employeeId: "T02", name: "Mix Trainee", netSalary: 0, basicSalary: 0 };
  const program = {
    outcome: "active",
    allPhases: [{ phaseNumber: 2, weekStart: "2026-07-13", weekEnd: "2026-07-17", status: "passed" }],
  };
  const att = [
    { date: "2026-07-14", status: "Attended" },
    { date: "2026-07-15", status: "WFH" },
    { date: "2026-07-16", status: "Lateness A" },
    { date: "2026-07-17", status: "Half Day" },
  ];
  const ctx = {
    ym: "2026-07",
    config: { latenessRules: { tierA: { amount: 50 }, tierB: { amount: 100 } }, workingDaysByMonth: { "2026-07": 22 } },
    actionPlans: [],
    rates: [{ position: "Trainee", monthlySalary: 12000 }],
    bonusEvents: [],
    deductionEvents: [],
    adjustment: null,
    attendanceRecords: att,
    commissionTiers: [],
    loans: [],
    loanPayments: [],
    allPayrollSplits: [],
  };
  const row = enrichPayrollRow(emp, standardRow, ctx, program);
  assert.equal(row.totalWorkingDays, 3.5);
  assert.equal(row.basicSalary, 3.5 * TRAINING_DAILY_RATE);
});

test("trainee daily rate is fixed 600/day regardless of attendance working days", () => {
  const { enrichPayrollRow } = require("../lib/training-payroll");
  const { TRAINING_DAILY_RATE, TRAINING_DAYS_PER_MONTH } = require("../lib/training-pay-rules");
  const emp = { id: "T01", american_name: "Trainee", unit: "NW", position: "Trainee" };
  const standardRow = { employeeId: "T01", name: "Trainee", netSalary: 0, basicSalary: 0 };
  const program = {
    outcome: "active",
    allPhases: [{ phaseNumber: 2, weekStart: "2026-07-14", weekEnd: "2026-07-18", status: "passed" }],
  };
  const lateness = { tierA: { amount: 50 }, tierB: { amount: 100 } };
  const att = [{ date: "2026-07-14", status: "Attended" }];
  const ctx22 = {
    ym: "2026-07",
    config: { latenessRules: lateness, workingDaysByMonth: { "2026-07": 22 } },
    actionPlans: [],
    rates: [{ position: "Trainee", monthlySalary: 11000 }],
    bonusEvents: [],
    deductionEvents: [],
    adjustment: null,
    attendanceRecords: att,
    commissionTiers: [],
    loans: [],
    loanPayments: [],
    allPayrollSplits: [],
  };
  const row22 = enrichPayrollRow(emp, standardRow, ctx22, program);
  assert.equal(row22.workingDaysInMonth, TRAINING_DAYS_PER_MONTH);
  assert.equal(row22.dailyRate, TRAINING_DAILY_RATE);

  const ctx20 = { ...ctx22, config: { latenessRules: lateness, workingDaysByMonth: { "2026-07": 20 } } };
  const row20 = enrichPayrollRow(emp, standardRow, ctx20, program);
  assert.equal(row20.workingDaysInMonth, TRAINING_DAYS_PER_MONTH);
  assert.equal(row20.dailyRate, TRAINING_DAILY_RATE);
  assert.equal(row22.dailyRate, row20.dailyRate);
});

console.log("resignation-payroll");
test("notice pay scale 5-10 sales", () => {
  assert.equal(resignation.noticePayPercent(4), 0);
  assert.equal(resignation.noticePayPercent(5), 50);
  assert.equal(resignation.noticePayPercent(10), 100);
});

test("scaled basic at 7 sales", () => {
  const r = resignation.calcNoticePeriodBasicScale({ basicSalary: 10000, passedSalesInNotice: 7 });
  assert.equal(r.payPercent, 70);
  assert.equal(r.scaledBasic, 7000);
});

if (process.exitCode) {
  console.error("\nSome tests failed.");
  process.exit(1);
}
console.log("\nAll training payroll tests passed.");

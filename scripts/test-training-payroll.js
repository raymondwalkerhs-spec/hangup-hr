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

test("weekdaysInMonth uses local calendar dates not UTC ISO shift", () => {
  const days = rules.weekdaysInMonth("2026-07");
  assert(days.includes("2026-07-01"), "July 1 must be in July weekday list");
  assert(!days.includes("2026-06-30"), "June 30 must not appear in July list");
});

test("training spanning two months is one payroll on anchor month only", () => {
  const { enrichPayrollRow } = require("../lib/training-payroll");
  const { TRAINING_DAILY_RATE, resolveTrainingPayrollAnchorMonth } = require("../lib/training-pay-rules");
  const emp = { id: "HS3-36", american_name: "Trainee", unit: "HS3", position: "Trainee" };
  const standardRow = { employeeId: "HS3-36", name: "Trainee", netSalary: 0, basicSalary: 0 };
  const program = {
    outcome: "active",
    allPhases: [
      { phaseNumber: 2, weekStart: "2026-06-23", weekEnd: "2026-06-27", status: "passed" },
      { phaseNumber: 3, weekStart: "2026-06-30", weekEnd: "2026-07-04", status: "passed" },
    ],
  };
  const programPayroll = {
    months: ["2026-06", "2026-07"],
    attendanceRecords: [
      { date: "2026-06-24", status: "Attended" },
      { date: "2026-06-25", status: "Attended" },
      { date: "2026-07-01", status: "Attended" },
      { date: "2026-07-02", status: "Attended" },
    ],
    bonusEvents: [],
    deductionEvents: [],
  };
  const anchor = resolveTrainingPayrollAnchorMonth(program, programPayroll.attendanceRecords);
  assert.equal(anchor, "2026-07");
  const baseCtx = {
    config: { latenessRules: { tierA: { amount: 50 }, tierB: { amount: 100 } } },
    actionPlans: [],
    rates: [{ position: "Trainee", monthlySalary: 12000 }],
    commissionTiers: [],
    loans: [],
    loanPayments: [],
    allPayrollSplits: [],
  };
  const juneRow = enrichPayrollRow(
    emp,
    standardRow,
    { ...baseCtx, ym: "2026-06", attendanceRecords: [], bonusEvents: [], deductionEvents: [] },
    program,
    programPayroll
  );
  assert.equal(juneRow.payrollKind, "training_deferred_month");
  assert.equal(juneRow.netSalary, 0);
  const julyRow = enrichPayrollRow(
    emp,
    standardRow,
    { ...baseCtx, ym: "2026-07", attendanceRecords: [], bonusEvents: [], deductionEvents: [] },
    program,
    programPayroll
  );
  assert.equal(julyRow.payrollKind, "training");
  assert.equal(julyRow.basicSalary, 4 * TRAINING_DAILY_RATE);
});

test("cross-month trainee pays once in phase 4 end month (July + August)", () => {
  const { enrichPayrollRow } = require("../lib/training-payroll");
  const { TRAINING_DAILY_RATE, resolveTrainingPayrollAnchorMonth } = require("../lib/training-pay-rules");
  const { payrollRowMetrics, sumPayrollRowMetrics } = require("../lib/payroll-row-metrics");
  const emp = { id: "HS3-RAY", american_name: "Ray Lincoln", unit: "HS3", position: "Trainee" };
  const standardRow = { employeeId: "HS3-RAY", name: "Ray Lincoln", netSalary: 0, basicSalary: 0 };
  const program = {
    outcome: "active",
    allPhases: [
      { phaseNumber: 1, weekStart: "2026-07-07", weekEnd: "2026-07-11", status: "pending" },
      { phaseNumber: 2, weekStart: "2026-07-14", weekEnd: "2026-07-18", status: "passed" },
      { phaseNumber: 3, weekStart: "2026-07-21", weekEnd: "2026-07-25", status: "passed" },
      { phaseNumber: 4, weekStart: "2026-08-11", weekEnd: "2026-08-17", status: "pending" },
    ],
  };
  const programPayroll = {
    months: ["2026-07", "2026-08"],
    attendanceRecords: [
      { date: "2026-07-15", status: "Attended" },
      { date: "2026-07-16", status: "Attended" },
      { date: "2026-07-17", status: "Attended" },
      { date: "2026-07-18", status: "Attended" },
      { date: "2026-08-12", status: "Attended" },
      { date: "2026-08-13", status: "Attended" },
      { date: "2026-08-14", status: "Attended" },
      { date: "2026-08-17", status: "Attended" },
    ],
    bonusEvents: [],
    deductionEvents: [],
  };
  const anchor = resolveTrainingPayrollAnchorMonth(program, programPayroll.attendanceRecords);
  assert.equal(anchor, "2026-08", "anchor is phase 4 end month, not July backfill");
  const baseCtx = {
    config: { latenessRules: { tierA: { amount: 50 }, tierB: { amount: 100 } } },
    actionPlans: [],
    rates: [{ position: "Trainee", monthlySalary: 12000 }],
    commissionTiers: [],
    loans: [],
    loanPayments: [],
    allPayrollSplits: [],
  };
  const julyRow = enrichPayrollRow(
    emp,
    standardRow,
    { ...baseCtx, ym: "2026-07", attendanceRecords: [], bonusEvents: [], deductionEvents: [] },
    program,
    programPayroll
  );
  const augustRow = enrichPayrollRow(
    emp,
    standardRow,
    { ...baseCtx, ym: "2026-08", attendanceRecords: [], bonusEvents: [], deductionEvents: [] },
    program,
    programPayroll
  );
  assert.equal(julyRow.payrollKind, "training_deferred_month");
  assert.equal(julyRow.netSalary, 0);
  assert.equal(augustRow.payrollKind, "training");
  assert(augustRow.netSalary > 0, "full training pay in August anchor month");
  const julyMetrics = payrollRowMetrics(julyRow);
  assert.equal(julyMetrics.netSalary, 0);
  assert.equal(julyMetrics.basicSalary, 0);
  const totals = sumPayrollRowMetrics([julyRow, augustRow]);
  assert.equal(totals.totalNet, augustRow.netSalary, "deferred July row must not add to payroll totals");
  assert.equal(totals.totalBasic, augustRow.basicSalary, "basic counted once in anchor month only");
  assert(augustRow.basicSalary >= 7 * TRAINING_DAILY_RATE - 1, "consolidated basic across both months");
});

test("graduated trainee uses agent payroll after anchor month", () => {
  const { enrichPayrollRow } = require("../lib/training-payroll");
  const emp = {
    id: "HS3-27",
    american_name: "Agent",
    unit: "HS3",
    position: "Agent.",
    training_passed: true,
  };
  const standardRow = { employeeId: "HS3-27", name: "Agent", netSalary: 8500, basicSalary: 8000, payrollKind: "standard" };
  const program = {
    outcome: "active",
    allPhases: [
      { phaseNumber: 1, weekStart: "2026-06-30", weekEnd: "2026-07-04", status: "passed" },
      { phaseNumber: 2, weekStart: "2026-07-07", weekEnd: "2026-07-11", status: "passed" },
      { phaseNumber: 3, weekStart: "2026-07-14", weekEnd: "2026-07-18", status: "passed" },
      { phaseNumber: 4, weekStart: "2026-07-21", weekEnd: "2026-07-25", status: "passed_exception" },
    ],
  };
  const ctx = {
    ym: "2026-08",
    config: { latenessRules: { tierA: { amount: 50 }, tierB: { amount: 100 } }, workingDaysByMonth: { "2026-08": 22 } },
    actionPlans: [],
    rates: [{ position: "Agent", monthlySalary: 12000 }],
    bonusEvents: [],
    deductionEvents: [],
    adjustment: null,
    commissionTiers: [],
    loans: [],
    loanPayments: [],
    allPayrollSplits: [],
    attendanceRecords: [],
  };
  const row = enrichPayrollRow(emp, standardRow, ctx, program, null);
  assert.equal(row.payrollKind, "standard");
  assert.equal(row.netSalary, 8500);
});

test("graduated trainee before anchor month stays deferred (not full agent net)", () => {
  const { enrichPayrollRow } = require("../lib/training-payroll");
  const { payrollRowMetrics } = require("../lib/payroll-row-metrics");
  const emp = {
    id: "HS3-RAY",
    american_name: "Ray Lincoln",
    unit: "HS3",
    position: "Trainee",
    training_passed: true,
  };
  const standardRow = { employeeId: "HS3-RAY", name: "Ray Lincoln", netSalary: 5200, basicSalary: 4800 };
  const program = {
    outcome: "active",
    allPhases: [
      { phaseNumber: 1, weekStart: "2026-07-07", weekEnd: "2026-07-11", status: "passed" },
      { phaseNumber: 2, weekStart: "2026-07-14", weekEnd: "2026-07-18", status: "passed" },
      { phaseNumber: 3, weekStart: "2026-07-21", weekEnd: "2026-07-25", status: "passed" },
      { phaseNumber: 4, weekStart: "2026-08-11", weekEnd: "2026-08-17", status: "pending" },
    ],
  };
  const programPayroll = {
    months: ["2026-07", "2026-08"],
    attendanceRecords: [
      { date: "2026-07-15", status: "Attended" },
      { date: "2026-07-16", status: "Attended" },
      { date: "2026-07-17", status: "Attended" },
      { date: "2026-07-18", status: "Attended" },
    ],
    bonusEvents: [],
    deductionEvents: [],
  };
  const baseCtx = {
    config: { latenessRules: { tierA: { amount: 50 }, tierB: { amount: 100 } } },
    actionPlans: [],
    rates: [{ position: "Trainee", monthlySalary: 12000 }, { position: "Agent", monthlySalary: 12000 }],
    commissionTiers: [],
    loans: [],
    loanPayments: [],
    allPayrollSplits: [],
  };
  const julyRow = enrichPayrollRow(
    emp,
    standardRow,
    { ...baseCtx, ym: "2026-07", attendanceRecords: [], bonusEvents: [], deductionEvents: [] },
    program,
    programPayroll
  );
  assert.equal(julyRow.payrollKind, "training_deferred_month");
  assert.equal(payrollRowMetrics(julyRow).netSalary, 0);
});

test("manual training anchor override on payslip adjustment", () => {
  const { enrichPayrollRow } = require("../lib/training-payroll");
  const emp = { id: "HS3-99", american_name: "Test", unit: "HS3", position: "Trainee" };
  const standardRow = { employeeId: "HS3-99", name: "Test", netSalary: 0, basicSalary: 0 };
  const program = {
    outcome: "active",
    allPhases: [
      { phaseNumber: 4, weekStart: "2026-07-14", weekEnd: "2026-07-18", status: "pending" },
    ],
  };
  const programPayroll = {
    months: ["2026-07", "2026-08"],
    attendanceRecords: [{ date: "2026-07-15", status: "Attended" }],
    bonusEvents: [],
    deductionEvents: [],
  };
  const baseCtx = {
    config: { latenessRules: { tierA: { amount: 50 }, tierB: { amount: 100 } } },
    actionPlans: [],
    rates: [{ position: "Trainee", monthlySalary: 12000 }],
    commissionTiers: [],
    loans: [],
    loanPayments: [],
    allPayrollSplits: [],
    adjustment: { trainingPayrollAnchorMonthOverride: "2026-08" },
  };
  const julyRow = enrichPayrollRow(
    emp,
    standardRow,
    { ...baseCtx, ym: "2026-07", attendanceRecords: [], bonusEvents: [], deductionEvents: [] },
    program,
    programPayroll
  );
  assert.equal(julyRow.payrollKind, "training_deferred_month");
  assert.equal(julyRow.trainingPayrollAnchorMonth, "2026-08");
});

test("resolveCanonicalPosition merges typo only when salary matches", () => {
  const { resolveCanonicalPosition, salaryForPosition } = require("../lib/position-canonical");
  const rates = [
    { position: "Agent", monthlySalary: 12000 },
    { position: "TL", monthlySalary: 15000 },
  ];
  assert.equal(resolveCanonicalPosition("Agent.", rates), "Agent");
  assert.equal(salaryForPosition("Agent.", rates), null);
  assert.equal(salaryForPosition("Agent", rates), 12000);
});

console.log("training-payroll");
test("4 Attended days in phase 2 pay 2400 basic (HS3-36 style)", () => {
  const { enrichPayrollRow } = require("../lib/training-payroll");
  const { TRAINING_DAILY_RATE } = require("../lib/training-pay-rules");
  const emp = { id: "HS3-36", american_name: "Trainee", unit: "HS3", position: "Trainee" };
  const standardRow = { employeeId: "HS3-36", name: "Trainee", netSalary: 0, basicSalary: 0 };
  const program = {
    outcome: "active",
    allPhases: [{ phaseNumber: 2, weekStart: "2026-07-13", weekEnd: "2026-07-17", status: "passed" }],
  };
  const att = [
    { date: "2026-07-14", status: "Attended" },
    { date: "2026-07-15", status: "Attended" },
    { date: "2026-07-16", status: "Attended" },
    { date: "2026-07-17", status: "Attended" },
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
  assert.equal(row.scopedDayCount, 4);
});

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

test("training day 20 through day 14 next month is one anchor payslip", () => {
  const { enrichPayrollRow } = require("../lib/training-payroll");
  const { TRAINING_DAILY_RATE, resolveTrainingPayrollAnchorMonth } = require("../lib/training-pay-rules");
  const emp = { id: "T-SPAN", american_name: "Span Trainee", unit: "HS3", position: "Trainee" };
  const standardRow = { employeeId: "T-SPAN", name: "Span Trainee", netSalary: 0, basicSalary: 0 };
  const program = {
    outcome: "active",
    allPhases: [
      { phaseNumber: 2, weekStart: "2026-06-16", weekEnd: "2026-06-27", status: "passed" },
      { phaseNumber: 3, weekStart: "2026-06-30", weekEnd: "2026-07-11", status: "passed" },
      { phaseNumber: 4, weekStart: "2026-07-13", weekEnd: "2026-07-17", status: "passed" },
    ],
  };
  const juneDays = ["2026-06-20", "2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26"];
  const julyDays = ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-14"];
  const attendanceRecords = [...juneDays, ...julyDays].map((date) => ({ date, status: "Attended" }));
  const programPayroll = {
    months: ["2026-06", "2026-07"],
    attendanceRecords,
    bonusEvents: [],
    deductionEvents: [],
  };
  const anchor = resolveTrainingPayrollAnchorMonth(program, attendanceRecords);
  assert.equal(anchor, "2026-07");
  const baseCtx = {
    config: { latenessRules: { tierA: { amount: 50 }, tierB: { amount: 100 } } },
    actionPlans: [],
    rates: [{ position: "Trainee", monthlySalary: 12000 }],
    commissionTiers: [],
    loans: [],
    loanPayments: [],
    allPayrollSplits: [],
  };
  const juneRow = enrichPayrollRow(
    emp,
    standardRow,
    { ...baseCtx, ym: "2026-06", attendanceRecords: [], bonusEvents: [], deductionEvents: [] },
    program,
    programPayroll
  );
  assert.equal(juneRow.payrollKind, "training_deferred_month");
  assert.equal(juneRow.netSalary, 0);
  const julyRow = enrichPayrollRow(
    emp,
    standardRow,
    { ...baseCtx, ym: "2026-07", attendanceRecords: [], bonusEvents: [], deductionEvents: [] },
    program,
    programPayroll
  );
  assert.equal(julyRow.payrollKind, "training");
  const payableDays = require("../lib/training-pay-rules").computeProgramTrainingPayDates(
    program,
    attendanceRecords
  ).size;
  assert.equal(julyRow.basicSalary, payableDays * TRAINING_DAILY_RATE);
  assert.equal(julyRow.totalWorkingDays, payableDays);
  assert.deepEqual(julyRow.trainingSpanMonths, ["2026-06", "2026-07"]);
});

test("dual payroll splits training @600 and agent @ monthly rate", () => {
  const { buildDualPayrollRow } = require("../lib/training-payroll");
  const { TRAINING_DAILY_RATE } = require("../lib/training-pay-rules");
  const emp = { id: "HS3-50", american_name: "Promoted", unit: "HS3", position: "Agent" };
  const program = {
    outcome: "passed",
    promotionEffectiveDate: "2026-07-15",
    allPhases: [
      { phaseNumber: 2, weekStart: "2026-07-06", weekEnd: "2026-07-10", status: "passed" },
      { phaseNumber: 3, weekStart: "2026-07-13", weekEnd: "2026-07-17", status: "passed" },
    ],
  };
  const att = [
    { date: "2026-07-07", status: "Attended" },
    { date: "2026-07-08", status: "Attended" },
    { date: "2026-07-09", status: "Attended" },
    { date: "2026-07-10", status: "Attended" },
    { date: "2026-07-15", status: "Attended" },
    { date: "2026-07-16", status: "Attended" },
    { date: "2026-07-17", status: "Attended" },
    { date: "2026-07-20", status: "Attended" },
    { date: "2026-07-21", status: "Attended" },
  ];
  const ctx = {
    ym: "2026-07",
    config: { latenessRules: { tierA: { amount: 50 }, tierB: { amount: 100 } }, workingDaysByMonth: { "2026-07": 22 } },
    actionPlans: [],
    rates: [
      { position: "Trainee", monthlySalary: 12000 },
      { position: "Agent", monthlySalary: 12000 },
    ],
    bonusEvents: [],
    deductionEvents: [],
    adjustment: null,
    attendanceRecords: att,
    commissionTiers: [],
    loans: [],
    loanPayments: [],
    allPayrollSplits: [],
  };
  const dual = buildDualPayrollRow(emp, ctx, program, {
    months: ["2026-07"],
    attendanceRecords: att,
    bonusEvents: [],
    deductionEvents: [],
  });
  assert.equal(dual.payrollKind, "dual");
  assert.equal(dual.training.basicSalary, 4 * TRAINING_DAILY_RATE);
  const expectedAgentBasic = Math.round((5 * (12000 / 22)) * 100) / 100;
  assert.equal(dual.agent.basicSalary, expectedAgentBasic);
  assert.equal(dual.combinedBasic, Math.round((4 * TRAINING_DAILY_RATE + expectedAgentBasic) * 100) / 100);
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

test("training transport starts week 2 (phase 2+) only", () => {
  const { enrichPayrollRow } = require("../lib/training-payroll");
  const { TRAINING_DAILY_RATE } = require("../lib/training-pay-rules");
  const emp = {
    id: "T03",
    american_name: "Trainee Transport",
    unit: "HS3",
    position: "Agent",
    transport_eligible: true,
  };
  const standardRow = { employeeId: "T03", name: "Trainee Transport", netSalary: 0, basicSalary: 0 };
  const program = {
    outcome: "active",
    allPhases: [
      { phaseNumber: 1, weekStart: "2026-07-14", weekEnd: "2026-07-18", status: "passed" },
      { phaseNumber: 2, weekStart: "2026-07-21", weekEnd: "2026-07-25", status: "passed" },
    ],
  };
  const att = [
    { date: "2026-07-14", status: "Attended" },
    { date: "2026-07-15", status: "Attended" },
    { date: "2026-07-21", status: "Attended" },
    { date: "2026-07-22", status: "Attended" },
  ];
  const ctx = {
    ym: "2026-07",
    config: {
      latenessRules: { tierA: { amount: 50 }, tierB: { amount: 100 } },
      workingDaysByMonth: { "2026-07": 22 },
      transportAllowanceMonthly: 3000,
    },
    actionPlans: [],
    rates: [{ position: "Trainee", monthlySalary: 12000 }, { position: "Agent", monthlySalary: 12000 }],
    bonusEvents: [],
    deductionEvents: [],
    adjustment: { transportEligible: true },
    attendanceRecords: att,
    commissionTiers: [],
    loans: [],
    loanPayments: [],
    allPayrollSplits: [],
  };
  const row = enrichPayrollRow(emp, standardRow, ctx, program);
  assert.equal(row.basicSalary, 2 * TRAINING_DAILY_RATE);
  assert.equal(row.transportAllowance, 300);
  assert.equal(row.totalBonuses, 300);
  assert.equal(row.netSalary, 2 * TRAINING_DAILY_RATE + 300);
});

test("exception pass only pays passed/passed_exception phases", () => {
  const { computeProgramTrainingPayDates } = require("../lib/training-pay-rules");
  const program = {
    outcome: "active",
    allPhases: [
      { phaseNumber: 1, weekStart: "2026-07-06", weekEnd: "2026-07-10", status: "passed" },
      { phaseNumber: 2, weekStart: "2026-07-13", weekEnd: "2026-07-17", status: "passed" },
      { phaseNumber: 3, weekStart: "2026-07-20", weekEnd: "2026-07-24", status: "pending" },
      { phaseNumber: 4, weekStart: "2026-07-27", weekEnd: "2026-07-31", status: "passed_exception" },
    ],
  };
  const att = [
    { date: "2026-07-14", status: "Attended" },
    { date: "2026-07-15", status: "Attended" },
    { date: "2026-07-21", status: "Attended" },
    { date: "2026-07-28", status: "Attended" },
    { date: "2026-07-29", status: "Attended" },
  ];
  const dates = computeProgramTrainingPayDates(program, att);
  assert.equal(dates.size, 4);
  assert(!dates.has("2026-07-21"), "pending phase 3 unpaid when exception on phase 4");
});

test("training pay breakdown by month with week 1 withheld line", () => {
  const { enrichPayrollRow } = require("../lib/training-payroll");
  const { TRAINING_DAILY_RATE } = require("../lib/training-pay-rules");
  const emp = { id: "T-BD", american_name: "Breakdown Trainee", unit: "HS3", position: "Trainee" };
  const standardRow = { employeeId: "T-BD", name: "Breakdown Trainee", netSalary: 0, basicSalary: 0 };
  const program = {
    outcome: "active",
    allPhases: [
      { phaseNumber: 1, weekStart: "2026-06-11", weekEnd: "2026-06-15", status: "pending" },
      { phaseNumber: 2, weekStart: "2026-06-18", weekEnd: "2026-06-22", status: "pending" },
      { phaseNumber: 3, weekStart: "2026-06-25", weekEnd: "2026-06-29", status: "pending" },
      { phaseNumber: 4, weekStart: "2026-07-02", weekEnd: "2026-07-06", status: "pending" },
    ],
  };
  const phase1 = ["2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14", "2026-06-15"];
  const phase2 = ["2026-06-18", "2026-06-19", "2026-06-20", "2026-06-21", "2026-06-22"];
  const phase3 = ["2026-06-25", "2026-06-26", "2026-06-27", "2026-06-28", "2026-06-29"];
  const phase4 = ["2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05", "2026-07-06"];
  const programPayroll = {
    months: ["2026-06", "2026-07"],
    attendanceRecords: [
      ...phase1.map((date) => ({ date, status: "WFH" })),
      ...phase2.map((date) => ({ date, status: "Attended" })),
      ...phase3.map((date) => ({ date, status: "Attended" })),
      ...phase4.map((date) => ({ date, status: "Attended" })),
    ],
    bonusEvents: [],
    deductionEvents: [],
  };
  const baseCtx = {
    config: { latenessRules: { tierA: { amount: 50 }, tierB: { amount: 100 } } },
    actionPlans: [],
    rates: [{ position: "Trainee", monthlySalary: 12000 }],
    commissionTiers: [],
    loans: [],
    loanPayments: [],
    allPayrollSplits: [],
    adjustment: null,
  };
  const julyRow = enrichPayrollRow(
    emp,
    standardRow,
    { ...baseCtx, ym: "2026-07", attendanceRecords: [], bonusEvents: [], deductionEvents: [] },
    program,
    programPayroll
  );
  const bd = julyRow.trainingPayBreakdown;
  assert(bd, "breakdown attached");
  assert.equal(bd.months.length, 2);
  assert.equal(bd.months[0].ym, "2026-06");
  assert.equal(bd.months[1].ym, "2026-07");
  assert(bd.months[0].basic > 0, "June has training basic");
  assert(bd.months[1].basic > 0, "July has training basic");
  assert.equal(bd.deductions.length, 1);
  assert.equal(bd.deductions[0].id, "phase1_target");
  assert.equal(bd.deductions[0].amount, 5 * TRAINING_DAILY_RATE);
  assert.equal(bd.months[0].basic + bd.months[1].basic, julyRow.basicSalary, "month lines sum to consolidated basic");
  assert(bd.months[0].days?.length > 0, "June month lists payable days");
  assert(bd.months[1].days?.length > 0, "July month lists payable days");
});

test("phase 1 pay exception adds week 1 basic", () => {
  const { enrichPayrollRow } = require("../lib/training-payroll");
  const { TRAINING_DAILY_RATE } = require("../lib/training-pay-rules");
  const emp = { id: "T-P1", american_name: "P1 Exception", unit: "HS3", position: "Trainee" };
  const standardRow = { employeeId: "T-P1", name: "P1 Exception", netSalary: 0, basicSalary: 0 };
  const program = {
    outcome: "active",
    allPhases: [
      { phaseNumber: 1, weekStart: "2026-07-20", weekEnd: "2026-07-24", status: "pending" },
      { phaseNumber: 2, weekStart: "2026-07-27", weekEnd: "2026-07-31", status: "pending" },
    ],
  };
  const att = [
    { date: "2026-07-21", status: "WFH" },
    { date: "2026-07-22", status: "WFH" },
    { date: "2026-07-23", status: "WFH" },
    { date: "2026-07-24", status: "WFH" },
    { date: "2026-07-28", status: "Attended" },
    { date: "2026-07-29", status: "Attended" },
    { date: "2026-07-30", status: "Attended" },
    { date: "2026-07-31", status: "Attended" },
  ];
  const ctx = {
    ym: "2026-07",
    config: { latenessRules: { tierA: { amount: 50 }, tierB: { amount: 100 } }, workingDaysByMonth: { "2026-07": 22 } },
    actionPlans: [],
    rates: [{ position: "Trainee", monthlySalary: 12000 }],
    bonusEvents: [],
    deductionEvents: [],
    adjustment: { trainingPhase1PayException: true },
    attendanceRecords: att,
    commissionTiers: [],
    loans: [],
    loanPayments: [],
    allPayrollSplits: [],
  };
  const row = enrichPayrollRow(emp, standardRow, ctx, program);
  assert.equal(row.basicSalary, 8 * TRAINING_DAILY_RATE);
  assert.equal(row.trainingPayBreakdown.phase1ExceptionApplied, true);
  assert.equal(row.trainingPayBreakdown.deductions.length, 0);
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

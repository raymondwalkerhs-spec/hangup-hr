const test = require("node:test");
const assert = require("node:assert/strict");
const { calcTransportAllowance } = require("../lib/transport");
const { calcPayrollRow } = require("../lib/payroll");
const { applyPayrollHybridDbCore, recalcPayrollNetBeforeSplits } = require("../lib/payroll-hybrid");

test("transport allowance is included in net salary via Transportation bonus", () => {
  const config = { transportAllowanceMonthly: 3000, workingDaysByMonth: { "2026-07": 22 } };
  const records = [
    { employeeId: "HS1-01", date: "2026-07-01", status: "Attended" },
    { employeeId: "HS1-01", date: "2026-07-02", status: "Attended" },
    { employeeId: "HS1-01", date: "2026-07-03", status: "Attended" },
  ];
  const transport = calcTransportAllowance(records, 22, config, true);
  assert.equal(transport.days, 3);

  const row = calcPayrollRow(
    { id: "HS1-01", american_name: "Agent", unit: "HS1", position: "Agent" },
    {
      employeeId: "HS1-01",
      workingDays: 3,
      daysOff: 0,
      halfDays: 0,
      quarterOff: 0,
      wfh: 0,
      lateness: 0,
      nsnc: 0,
      nsncHalf: 0,
      extraDays: 0,
      latenessDeductions: 0,
      latenessDetail: "",
    },
    "2026-07",
    config,
    [{ position: "Agent", monthlySalary: 6000 }],
    [],
    [],
    { transportEligible: true },
    records
  );

  assert.ok(row.transportAllowance > 0, "transport allowance should be calculated");
  assert.equal(row.bonuses.Transportation, row.transportAllowance);
  assert.equal(row.transportAllowance, transport.amount);
  assert.equal(row.netSalary, row.basicSalary + row.totalBonuses - row.totalDeductions);
});

test("hybrid DB merge syncs transport into bonuses and net", () => {
  const appRow = {
    employeeId: "HS1-01",
    totalWorkingDays: 20,
    workingDaysInMonth: 22,
    monthlySalary: 6600,
    dailyRate: 300,
    basicSalary: 5200,
    transportAllowance: 2500,
    bonuses: { Transportation: 2500, Comission: 500 },
    totalBonuses: 3000,
    totalDeductions: 200,
    bonusTransferPayroll: 0,
    latenessDeduction: 200,
    netSalary: 8000,
    noPayroll: false,
  };

  const dbRow = {
    employee_id: "HS1-01",
    working_days: 20,
    basic_salary: 5200,
    transport_allowance: 2727.27,
    transport_days: 20,
    transport_daily_rate: 136.36, // 3000 / 22
    daily_rate: 300, // 6600 / 22
  };

  const merged = applyPayrollHybridDbCore(appRow, dbRow);
  assert.equal(merged.basicSalary, 5200);
  assert.equal(merged.transportAllowance, 2727.27);
  assert.equal(merged.bonuses.Transportation, 2727.27);
  assert.equal(merged.totalBonuses, 3227.27);
  assert.equal(merged.netSalary, 8227.27);
  assert.equal(merged._dbSource, true);
});

test("hybrid DB merge rejects stale inflated working_days and keeps app transport/net", () => {
  const appRow = {
    employeeId: "HS3-13",
    totalWorkingDays: 5,
    workingDaysInMonth: 22,
    transportAllowance: 0,
    bonuses: { Transportation: 0 },
    totalBonuses: 0,
    basicSalary: 1500,
    totalDeductions: 0,
    bonusTransferPayroll: 0,
    netSalary: 1500,
    noPayroll: false,
  };

  const staleDbRow = {
    employee_id: "HS3-13",
    working_days: 22,
    transport_allowance: 3000,
    basic_salary: 6000,
  };

  const merged = applyPayrollHybridDbCore(appRow, staleDbRow);
  assert.equal(merged.totalWorkingDays, 5);
  assert.equal(merged.transportAllowance, 0);
  assert.equal(merged.netSalary, 1500);
  assert.equal(merged._dbSource, false);
});

test("hybrid DB merge rejects attendance-based daily rate like 1200 (Sheila bug)", () => {
  const { isDbDailyRateAligned } = require("../lib/payroll-hybrid");
  const appRow = {
    employeeId: "SHEILA",
    totalWorkingDays: 10,
    workingDaysInMonth: 22,
    monthlySalary: 12000,
    dailyRate: 12000 / 22,
    basicSalary: Math.round((10 * (12000 / 22)) * 100) / 100,
    transportAllowance: 0,
    bonuses: {},
    totalBonuses: 0,
    totalDeductions: 0,
    bonusTransferPayroll: 0,
    netSalary: 0,
    noPayroll: false,
  };
  const badDb = {
    employee_id: "SHEILA",
    working_days: 10,
    monthly_salary: 12000,
    daily_rate: 1200, // 12000/10 — wrong denominator
    basic_salary: 12000,
    transport_allowance: 0,
    transport_daily_rate: 300, // also attendance-based
  };
  assert.equal(isDbDailyRateAligned(appRow, badDb), false);
  const merged = applyPayrollHybridDbCore(appRow, badDb);
  assert.equal(merged.dailyRate, appRow.dailyRate);
  assert.equal(merged.basicSalary, appRow.basicSalary);
  assert.equal(merged._dbDailyRejected, true);
});

test("hybrid keeps app basic when DB daily matches but unit math differs", () => {
  const appRow = {
    employeeId: "HS3-46",
    totalWorkingDays: 20,
    workingDaysInMonth: 23,
    monthlySalary: 15000,
    dailyRate: 652.17,
    basicSalary: 13043.48,
    transportAllowance: 2000,
    bonuses: { Transportation: 2000 },
    totalBonuses: 2000,
    totalDeductions: 0,
    bonusTransferPayroll: 0,
    netSalary: 15043.48,
    noPayroll: false,
  };
  const dbRow = {
    employee_id: "HS3-46",
    working_days: 18,
    daily_rate: 652.17,
    basic_salary: 11739.13, // same daily, fewer units
    transport_allowance: 2000,
    transport_daily_rate: 130.43,
    transport_days: 15,
  };
  const merged = applyPayrollHybridDbCore(appRow, dbRow);
  assert.equal(merged.basicSalary, 13043.48);
  assert.equal(merged._dbBasicRejected, true);
});

test("recalcPayrollNetBeforeSplits respects net override", () => {
  const net = recalcPayrollNetBeforeSplits({
    basicSalary: 1000,
    totalBonuses: 500,
    totalDeductions: 100,
    bonusTransferPayroll: 0,
    netSalaryOverrideActive: true,
    netSalaryOverrideValue: 1200,
  });
  assert.equal(net, 1200);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  payrollRowWorkedInMonth,
  shouldShowPayrollRow,
  filterPayrollViewRows,
} = require("../lib/payroll-view-filters");
const { isDbWorkingDaysReasonable, applyPayrollHybridDbCore } = require("../lib/payroll-hybrid");

test("payrollRowWorkedInMonth ignores transport-only and net overrides", () => {
  assert.equal(
    payrollRowWorkedInMonth({
      status: "Out",
      transportAllowance: 1173.87,
      netSalary: 1173.87,
      totalWorkingDays: 0,
      basicSalary: 0,
    }),
    false
  );
  assert.equal(
    payrollRowWorkedInMonth({
      status: "Out",
      netSalaryOverrideActive: true,
      netSalary: 7500,
      totalWorkingDays: 0,
      basicSalary: 0,
    }),
    false
  );
  assert.equal(
    payrollRowWorkedInMonth({
      status: "Active",
      totalWorkingDays: 12,
      basicSalary: 4000,
    }),
    true
  );
});

test("shouldShowPayrollRow hides OUT rows without work", () => {
  const row = { status: "Out", depart_date: "2026-06-15", transportAllowance: 3000, netSalary: 3000 };
  assert.equal(shouldShowPayrollRow(row, { hideOut: true, month: "2026-07" }), false);
  assert.equal(shouldShowPayrollRow(row, { hideOut: false, month: "2026-07" }), true);
  assert.equal(shouldShowPayrollRow(row, { hideOut: false, month: "2026-07", showLegacyEmployees: false }), true);
});

test("shouldShowPayrollRow hides legacy OUT without work", () => {
  const row = { status: "Out", depart_date: "2026-04-10", netSalary: 0, basicSalary: 0 };
  assert.equal(shouldShowPayrollRow(row, { hideOut: false, month: "2026-07" }), false);
  assert.equal(shouldShowPayrollRow(row, { hideOut: false, month: "2026-07", showLegacyEmployees: true }), true);
});

test("filterPayrollViewRows keeps active zero rows but drops idle OUT rows", () => {
  const rows = [
    { status: "Active", name: "A", totalWorkingDays: 0, netSalary: 0 },
    { status: "Out", name: "B", depart_date: "2026-06-15", transportAllowance: 1000, netSalary: 1000 },
    { status: "Out", name: "C", totalWorkingDays: 5, basicSalary: 2000, netSalary: 2000 },
  ];
  const filtered = filterPayrollViewRows(rows, { hideOut: true, month: "2026-07" });
  assert.deepEqual(filtered.map((r) => r.name), ["A", "C"]);
});

test("hybrid DB does not zero payroll when DB working_days is 0", () => {
  const row = {
    employeeId: "OF1",
    totalWorkingDays: 18,
    basicSalary: 5400,
    transportAllowance: 2700,
    bonuses: { Transportation: 2700 },
    totalBonuses: 2700,
    totalDeductions: 0,
    netSalary: 8100,
    noPayroll: false,
  };
  assert.equal(isDbWorkingDaysReasonable(row, { working_days: 0 }), false);
  const merged = applyPayrollHybridDbCore(row, {
    working_days: 0,
    basic_salary: 0,
    transport_allowance: 0,
  });
  assert.equal(merged.basicSalary, 5400);
  assert.equal(merged._dbSource, false);
});

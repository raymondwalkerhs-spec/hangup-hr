const test = require("node:test");
const assert = require("node:assert/strict");
const { payrollRowMetrics, sumPayrollRowMetrics } = require("../lib/payroll-row-metrics");

test("payrollRowMetrics splits bonuses from transport and commission", () => {
  const row = {
    totalWorkingDays: 20,
    salesCount: 18,
    commissionAmount: 5000,
    basicSalary: 6000,
    transportAllowance: 3000,
    totalBonuses: 9500,
    loanDeductionTotal: 500,
    totalDeductions: 900,
    netSalary: 14600,
    calculatedNet: 14600,
  };
  const m = payrollRowMetrics(row);
  assert.equal(m.commission, 5000);
  assert.equal(m.transport, 3000);
  assert.equal(m.otherBonuses, 1500);
  assert.equal(m.deductions, 400);
  assert.equal(m.loan, 500);
  assert.equal(m.netSalary, 14600);
});

test("sumPayrollRowMetrics totals visible columns", () => {
  const rows = [
    {
      totalWorkingDays: 10,
      salesCount: 5,
      commissionAmount: 1000,
      basicSalary: 2000,
      transportAllowance: 500,
      totalBonuses: 1800,
      loanDeductionTotal: 100,
      totalDeductions: 200,
      netSalary: 3600,
    },
    {
      totalWorkingDays: 12,
      salesCount: 8,
      commissionAmount: 2000,
      basicSalary: 3000,
      transportAllowance: 600,
      totalBonuses: 2900,
      loanDeductionTotal: 0,
      totalDeductions: 150,
      netSalary: 5750,
    },
  ];
  const totals = sumPayrollRowMetrics(rows);
  assert.equal(totals.totalWorkingDays, 22);
  assert.equal(totals.totalSales, 13);
  assert.equal(totals.totalCommission, 3000);
  assert.equal(totals.totalBasic, 5000);
  assert.equal(totals.totalLoan, 100);
  assert.equal(totals.totalTransport, 1100);
  assert.equal(totals.totalOtherBonuses, 600);
  assert.equal(totals.totalDeductions, 250);
  assert.equal(totals.totalNet, 9350);
});

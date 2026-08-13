const test = require("node:test");
const assert = require("node:assert/strict");
const { payrollRowDisplayNet } = require("../lib/payroll-display-net");

test("payrollRowDisplayNet uses calculated net when payment splits exist", () => {
  const row = {
    hasSplits: true,
    calculatedNet: 9500,
    remainingBalance: -500,
    netSalary: -500,
    receivedTotal: 10000,
  };
  assert.equal(payrollRowDisplayNet(row), 9500);
});

test("payrollRowDisplayNet uses net salary when no splits", () => {
  const row = { netSalary: 8200, calculatedNet: 8200 };
  assert.equal(payrollRowDisplayNet(row), 8200);
});

test("payrollRowDisplayNet uses combined net for dual payroll", () => {
  const row = { payrollKind: "dual", combinedNet: 11000, netSalary: 5000 };
  assert.equal(payrollRowDisplayNet(row), 11000);
});

test("payrollRowDisplayNet returns 0 when payroll is settled", () => {
  const row = { netSalary: 12000, payrollStatus: "paid" };
  assert.equal(payrollRowDisplayNet(row), 0);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { rebuildDualCombined, portionEarnedNet } = require("../lib/payroll-hybrid");

test("dual combinedNet uses earned net not split balance", () => {
  const dual = rebuildDualCombined({
    payrollKind: "dual",
    training: { calculatedNet: 3000, netSalary: 0, basicSalary: 3000, totalBonuses: 0, totalDeductions: 0 },
    agent: { calculatedNet: 6500, netSalary: -500, basicSalary: 5000, totalBonuses: 1500, totalDeductions: 0 },
  });
  assert.equal(portionEarnedNet(dual.training), 3000);
  assert.equal(portionEarnedNet(dual.agent), 6500);
  assert.equal(dual.combinedNet, 9500);
  assert.equal(dual.netSalary, 9500);
});

test("applyPayrollHybridDbToRow preserves dual agent scoped pay", () => {
  const { applyPayrollHybridDbToRow } = require("../lib/payroll-hybrid");
  const row = {
    payrollKind: "dual",
    employeeId: "OF1",
    agent: {
      employeeId: "OF1",
      totalWorkingDays: 11,
      basicSalary: 5000,
      transportAllowance: 2500,
      bonuses: { Transportation: 2500 },
      totalBonuses: 2500,
      totalDeductions: 0,
      netSalary: 7500,
      calculatedNet: 7500,
      noPayroll: false,
    },
    training: null,
    combinedNet: 7500,
  };
  const merged = applyPayrollHybridDbToRow(row, {
    employee_id: "OF1",
    working_days: 22,
    basic_salary: 9900,
    transport_allowance: 2700,
  });
  assert.equal(merged.agent.basicSalary, 5000);
  assert.equal(merged.agent.transportAllowance, 2500);
  assert.equal(merged.combinedNet, 7500);
});

#!/usr/bin/env node
const assert = require("assert");
const {
  applyTrainingPortionAdjustments,
  applyAgentPortionAdjustments,
} = require("../lib/payroll-portion-adjustments");
const { rebuildDualCombined, portionEarnedNet } = require("../lib/payroll-hybrid");

function test(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

console.log("payroll-portion-adjustments");

test("training net override applies to training portion only", () => {
  const row = { basicSalary: 2400, totalBonuses: 0, totalDeductions: 0, netSalary: 2400, calculatedNet: 2400 };
  const next = applyTrainingPortionAdjustments(row, { trainingNetSalaryOverride: 2000 });
  assert.equal(next.netSalary, 2000);
  assert.equal(next.calculatedNet, 2000);
});

test("training payroll paid zeros training net", () => {
  const row = { basicSalary: 2400, netSalary: 2400, calculatedNet: 2400 };
  const next = applyTrainingPortionAdjustments(row, { trainingPayrollPaid: true });
  assert.equal(next.netSalary, 0);
  assert.equal(next.basicSalary, 0);
});

test("agent net override on dual agent portion", () => {
  const row = { basicSalary: 5000, totalBonuses: 500, totalDeductions: 0, netSalary: 5500, calculatedNet: 5500 };
  const next = applyAgentPortionAdjustments(row, { agentNetSalaryOverride: 5200 }, { isDual: true });
  assert.equal(next.netSalary, 5200);
});

test("dual combined net sums overridden portions", () => {
  const training = applyTrainingPortionAdjustments(
    { calculatedNet: 2400, netSalary: 2400, basicSalary: 2400, totalBonuses: 0, totalDeductions: 0 },
    { trainingPayrollPaid: true }
  );
  const agent = applyAgentPortionAdjustments(
    { calculatedNet: 5500, netSalary: 5500, basicSalary: 5000, totalBonuses: 500, totalDeductions: 0 },
    { agentNetSalaryOverride: 5200 },
    { isDual: true }
  );
  const dual = rebuildDualCombined({
    payrollKind: "dual",
    training,
    agent,
    combinedNet: 0,
  });
  assert.equal(portionEarnedNet(training), 0);
  assert.equal(portionEarnedNet(agent), 5200);
  assert.equal(dual.combinedNet, 5200);
});

if (process.exitCode) {
  console.error("\nSome payroll portion tests failed.");
  process.exit(process.exitCode);
}
console.log("\nAll payroll portion tests passed.");

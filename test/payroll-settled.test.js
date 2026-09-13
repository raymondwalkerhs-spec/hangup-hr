const test = require("node:test");
const assert = require("node:assert/strict");
const { isPayrollSettled, payrollEarnedNet } = require("../lib/payroll-settled");
const { payrollRowDisplayNet } = require("../lib/payroll-display-net");
const { sumPayrollRowMetrics } = require("../lib/payroll-row-metrics");
const { waiveTrainingPortion } = require("../lib/payroll-portion-adjustments");

test("noPayroll zeros display net but preserves earned amount", () => {
  const row = {
    basicSalary: 10000,
    totalBonuses: 0,
    totalDeductions: 0,
    bonusTransferPayroll: 0,
    netSalary: 0,
    noPayroll: true,
    earnedNetSalary: 10000,
    payrollSettled: true,
  };
  assert.equal(payrollRowDisplayNet(row), 0);
  assert.equal(payrollEarnedNet(row), 10000);
  assert.equal(isPayrollSettled(row), true);
});

test("payroll status paid zeros remaining net and fills paid total", () => {
  const row = {
    basicSalary: 12000,
    totalBonuses: 0,
    totalDeductions: 0,
    bonusTransferPayroll: 0,
    netSalary: 12000,
    payrollStatus: "paid",
  };
  assert.equal(payrollRowDisplayNet(row), 0);
  const totals = sumPayrollRowMetrics([row]);
  assert.equal(totals.totalNet, 0);
  assert.equal(totals.totalBasic, 0);
  assert.equal(totals.totalPaidNet, 12000);
  assert.equal(totals.totalAllNet, 12000);
  assert.equal(payrollEarnedNet(row), 12000);
});

test("noPayroll is excluded from both remaining and paid totals", () => {
  const { payrollPaidNet } = require("../lib/payroll-settled");
  const row = {
    basicSalary: 10000,
    totalBonuses: 0,
    totalDeductions: 0,
    bonusTransferPayroll: 0,
    netSalary: 0,
    noPayroll: true,
    earnedNetSalary: 10000,
    payrollSettled: true,
  };
  assert.equal(payrollPaidNet(row), 0);
  const totals = sumPayrollRowMetrics([row]);
  assert.equal(totals.totalNet, 0);
  assert.equal(totals.totalPaidNet, 0);
  assert.equal(totals.totalAllNet, 0);
});

test("remaining + paid tiles match unpaid and paid rows", () => {
  const unpaid = {
    basicSalary: 8000,
    totalBonuses: 500,
    totalDeductions: 0,
    bonusTransferPayroll: 0,
    netSalary: 8500,
    calculatedNet: 8500,
  };
  const paid = {
    basicSalary: 7000,
    totalBonuses: 0,
    totalDeductions: 0,
    bonusTransferPayroll: 0,
    netSalary: 7000,
    payrollStatus: "paid",
  };
  const totals = sumPayrollRowMetrics([unpaid, paid]);
  assert.equal(totals.totalNet, 8500);
  assert.equal(totals.totalPaidNet, 7000);
  assert.equal(totals.totalAllNet, 15500);
});

test("deferred training row keeps earned preview but zero payroll metrics", () => {
  const { payrollRowMetrics } = require("../lib/payroll-row-metrics");
  const row = {
    payrollKind: "training_deferred_month",
    netSalary: 0,
    basicSalary: 0,
    totalWorkingDays: 8,
    earnedNetSalary: 4800,
    earnedBasicSalary: 4800,
  };
  const m = payrollRowMetrics(row);
  assert.equal(m.basicSalary, 0);
  assert.equal(m.workingDays, 8);
  assert.equal(m.netSalary, 0);
});
test("training payroll paid waives net but keeps earned reference", () => {
  const waived = waiveTrainingPortion(
    { basicSalary: 12000, netSalary: 12000, calculatedNet: 12000, payrollKind: "training" },
    "paid"
  );
  assert.equal(waived.netSalary, 0);
  assert.equal(waived.earnedNetSalary, 12000);
  assert.equal(isPayrollSettled(waived), true);
  assert.equal(payrollRowDisplayNet(waived), 0);
});

test("dual unpaid row sums training+agent for basic/transport/commission/loan", () => {
  const { payrollRowMetrics } = require("../lib/payroll-row-metrics");
  const row = {
    payrollKind: "dual",
    combinedNet: 15000,
    netSalary: 15000,
    basicSalary: 10000,
    totalBonuses: 3000,
    totalDeductions: 500,
    training: {
      basicSalary: 4800,
      transportAllowance: 0,
      commissionAmount: 0,
      loanDeductionTotal: 0,
      totalBonuses: 0,
      totalDeductions: 0,
      totalWorkingDays: 8,
      salesCount: 0,
      calculatedNet: 4800,
      netSalary: 4800,
    },
    agent: {
      basicSalary: 7000,
      transportAllowance: 600,
      commissionAmount: 2000,
      loanDeductionTotal: 500,
      totalBonuses: 2600,
      totalDeductions: 500,
      totalWorkingDays: 14,
      salesCount: 3,
      calculatedNet: 10200,
      netSalary: 10200,
    },
  };
  const m = payrollRowMetrics(row);
  assert.equal(m.basicSalary, 11800);
  assert.equal(m.transport, 600);
  assert.equal(m.commission, 2000);
  assert.equal(m.loan, 500);
  assert.equal(m.workingDays, 22);
  assert.equal(m.salesCount, 3);
  assert.equal(m.netSalary, 15000);
  const totals = sumPayrollRowMetrics([row]);
  assert.equal(totals.totalBasic, 11800);
  assert.equal(totals.totalNet, 15000);
  assert.equal(totals.totalPaidNet, 0);
  assert.equal(totals.totalAllNet, 15000);
});

test("dual with training paid keeps agent metrics and paid net from training", () => {
  const { payrollPaidNet } = require("../lib/payroll-settled");
  const row = {
    payrollKind: "dual",
    trainingPayrollPaid: true,
    combinedNet: 15000,
    netSalary: 10200,
    training: {
      basicSalary: 4800,
      transportAllowance: 0,
      commissionAmount: 0,
      loanDeductionTotal: 0,
      totalBonuses: 0,
      totalDeductions: 0,
      totalWorkingDays: 8,
      calculatedNet: 4800,
      netSalary: 0,
      trainingPayrollPaid: true,
      payrollSettled: true,
    },
    agent: {
      basicSalary: 7000,
      transportAllowance: 600,
      commissionAmount: 2000,
      loanDeductionTotal: 0,
      totalBonuses: 2600,
      totalDeductions: 0,
      totalWorkingDays: 14,
      calculatedNet: 10200,
      netSalary: 10200,
    },
  };
  // Display net is agent-only when training paid
  assert.equal(payrollRowDisplayNet(row), 10200);
  const totals = sumPayrollRowMetrics([row]);
  // Unsettled dual still sums training+agent components for tiles
  assert.equal(totals.totalBasic, 11800);
  assert.equal(totals.totalNet, 10200);
  assert.equal(totals.totalPaidNet, 4800);
  assert.equal(totals.totalAllNet, 15000);
  assert.equal(payrollPaidNet(row), 4800);
});

test("export rows use display net metrics", () => {
  const { buildPayrollExportRows, buildPayrollExportTotals } = require("../lib/payroll-export");
  const unpaid = {
    arabicName: "أحمد",
    name: "Ahmed",
    employeeId: "E1",
    paymentMethod: "Bank transfer",
    basicSalary: 8000,
    transportAllowance: 500,
    commissionAmount: 0,
    loanDeductionTotal: 0,
    totalBonuses: 500,
    totalDeductions: 0,
    totalWorkingDays: 22,
    netSalary: 8500,
    calculatedNet: 8500,
  };
  const paid = {
    name: "Sara",
    employeeId: "E2",
    payment_method: "Cash",
    basicSalary: 7000,
    netSalary: 7000,
    payrollStatus: "paid",
    totalWorkingDays: 22,
  };
  const rows = buildPayrollExportRows([unpaid, paid]);
  assert.equal(rows[0].netRemaining, 8500);
  assert.equal(rows[0].paidNet, 0);
  assert.equal(rows[0].americanName, "Ahmed");
  assert.equal(rows[0].paymentMethod, "Bank transfer");
  assert.equal(rows[1].netRemaining, 0);
  assert.equal(rows[1].paidNet, 7000);
  assert.equal(rows[1].americanName, "Sara");
  assert.equal(rows[1].paymentMethod, "Cash");
  const totals = buildPayrollExportTotals([unpaid, paid]);
  assert.equal(totals.totalNet, 8500);
  assert.equal(totals.totalPaidNet, 7000);
  assert.equal(totals.totalAllNet, 15500);
});

test("unified payroll view keeps trainees and dual combined net", () => {
  const { buildPayrollViews } = require("../lib/training-payroll");
  const { sumPayrollRowMetrics } = require("../lib/payroll-row-metrics");
  const dual = {
    employeeId: "D1",
    name: "Jasmine Ethan",
    payrollKind: "dual",
    combinedNet: 15000,
    netSalary: 15000,
    basicSalary: 11800,
    training: {
      basicSalary: 4800,
      calculatedNet: 4800,
      netSalary: 4800,
      totalWorkingDays: 8,
      transportAllowance: 0,
      commissionAmount: 0,
      loanDeductionTotal: 0,
      totalBonuses: 0,
      totalDeductions: 0,
    },
    agent: {
      basicSalary: 7000,
      transportAllowance: 600,
      commissionAmount: 2000,
      loanDeductionTotal: 0,
      totalBonuses: 2600,
      totalDeductions: 0,
      totalWorkingDays: 14,
      calculatedNet: 10200,
      netSalary: 10200,
    },
  };
  const trainingOnly = {
    employeeId: "T1",
    name: "Rose Brown",
    payrollKind: "training",
    basicSalary: 4800,
    netSalary: 4800,
    calculatedNet: 4800,
  };
  const agentOnly = {
    employeeId: "A1",
    name: "Agent",
    payrollKind: "agent",
    basicSalary: 9000,
    netSalary: 9000,
    calculatedNet: 9000,
  };
  const fullTotals = sumPayrollRowMetrics([dual, trainingOnly, agentOnly]);
  assert.equal(fullTotals.totalNet, 15000 + 4800 + 9000);

  const views = buildPayrollViews([dual, trainingOnly, agentOnly], {
    hideOut: false,
    showLegacyEmployees: true,
  });
  const agentTotals = views.agent.totals;
  // Unified list: dual + trainee + agent
  assert.equal(agentTotals.totalNet, 28800);
  assert.equal(views.agent.rows.length, 3);
  const jasmine = views.agent.rows.find((r) => r.employeeId === "D1");
  assert.equal(jasmine?.payrollKind, "dual");
  assert.equal(jasmine?.combinedNet, 15000);
  assert.ok(views.agent.rows.find((r) => r.employeeId === "T1"));
  const { buildPayrollExportRows } = require("../lib/payroll-export");
  const exportRow = buildPayrollExportRows([jasmine])[0];
  assert.equal(exportRow.netRemaining, 15000);
});

test("agent view dual with training paid: remaining=agent, paid=training", () => {
  const { buildPayrollViews } = require("../lib/training-payroll");
  const dual = {
    employeeId: "D2",
    name: "Dual Paid Train",
    payrollKind: "dual",
    trainingPayrollPaid: true,
    combinedNet: 15000,
    netSalary: 10200,
    training: {
      basicSalary: 4800,
      calculatedNet: 4800,
      netSalary: 0,
      earnedNetSalary: 4800,
      trainingPayrollPaid: true,
      totalWorkingDays: 8,
      transportAllowance: 0,
      commissionAmount: 0,
      loanDeductionTotal: 0,
      totalBonuses: 0,
      totalDeductions: 0,
    },
    agent: {
      basicSalary: 7000,
      calculatedNet: 10200,
      netSalary: 10200,
      totalWorkingDays: 14,
      transportAllowance: 0,
      commissionAmount: 0,
      loanDeductionTotal: 0,
      totalBonuses: 0,
      totalDeductions: 0,
    },
  };
  const views = buildPayrollViews([dual], { hideOut: false, showLegacyEmployees: true });
  assert.equal(views.agent.rows[0].payrollKind, "dual");
  assert.equal(views.agent.totals.totalNet, 10200);
  assert.equal(views.agent.totals.totalPaidNet, 4800);
  assert.equal(views.agent.totals.totalAllNet, 15000);
});

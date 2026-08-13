/**
 * Training vs agent portion net overrides for dual payroll months.
 */
const { round2 } = require("./payroll-hybrid");

function applyNetOverrideToPortion(row, overrideNet) {
  const net = round2(Number(overrideNet));
  if (Number.isNaN(net) || net < 0) return row;
  const next = {
    ...row,
    netSalaryOverrideActive: true,
    netSalaryOverrideValue: net,
    calculatedNet: net,
    netSalary: net,
  };
  if (!next.hasSplits) {
    next.remainingBalance = net;
    next.grossPayable = net;
    return next;
  }
  const { applyPayrollSplits } = require("./payroll-splits");
  return applyPayrollSplits({ ...next, netSalary: net }, next.splits || [], next.deferredInSplits || []);
}

function waiveTrainingPortion(row, note) {
  const earnedNetSalary = round2(Number(row.calculatedNet ?? row.netSalary) || 0);
  const earnedBasicSalary = round2(Number(row.basicSalary) || 0);
  const monthNotes = note ? [row.monthNotes, note].filter(Boolean).join("\n\n") : row.monthNotes;
  const next = {
    ...row,
    earnedNetSalary,
    earnedBasicSalary,
    payrollSettled: true,
    basicSalary: 0,
    totalBonuses: 0,
    totalDeductions: 0,
    latenessDeduction: 0,
    otherDeductions: 0,
    commissionAmount: 0,
    transportAllowance: 0,
    netSalary: 0,
    calculatedNet: 0,
    netBasic: 0,
    trainingPayrollPaid: true,
    monthNotes,
  };
  if (!next.hasSplits) {
    next.remainingBalance = 0;
    next.grossPayable = 0;
    return next;
  }
  const { applyPayrollSplits } = require("./payroll-splits");
  return applyPayrollSplits({ ...next, netSalary: 0 }, next.splits || [], next.deferredInSplits || []);
}

function applyTrainingPortionAdjustments(row, adjustment) {
  if (!row || !adjustment) return row;
  if (adjustment.trainingPayrollPaid === true) {
    return waiveTrainingPortion(row, "Training payroll marked as paid.");
  }
  if (adjustment.trainingNetSalaryOverride != null && adjustment.trainingNetSalaryOverride !== "") {
    const v = Number(adjustment.trainingNetSalaryOverride);
    if (!Number.isNaN(v) && v >= 0) {
      if (v === 0) return waiveTrainingPortion(row, "Training salary removed.");
      return applyNetOverrideToPortion(row, v);
    }
  }
  return row;
}

function applyAgentPortionAdjustments(row, adjustment, { isDual = false } = {}) {
  if (!row || !adjustment) return row;
  if (!isDual) return row;
  if (adjustment.agentNetSalaryOverride != null && adjustment.agentNetSalaryOverride !== "") {
    const v = Number(adjustment.agentNetSalaryOverride);
    if (!Number.isNaN(v) && v >= 0) return applyNetOverrideToPortion(row, v);
  }
  return row;
}

function adjustmentForScopedCalc(adjustment, { payrollKind, isDual = false } = {}) {
  if (!adjustment) return null;
  const adj = { ...adjustment };
  if (payrollKind === "training" || (payrollKind === "agent" && isDual)) {
    delete adj.netSalaryOverride;
  }
  if (payrollKind === "training") {
    delete adj.monthlySalaryOverride;
    delete adj.salaryRaise;
    delete adj.agentNetSalaryOverride;
  }
  if (payrollKind === "agent" && isDual) {
    delete adj.trainingNetSalaryOverride;
    delete adj.trainingPayrollPaid;
  }
  return adj;
}

module.exports = {
  applyNetOverrideToPortion,
  waiveTrainingPortion,
  applyTrainingPortionAdjustments,
  applyAgentPortionAdjustments,
  adjustmentForScopedCalc,
};

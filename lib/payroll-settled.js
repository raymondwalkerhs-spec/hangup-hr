/**
 * Payroll rows marked paid / no payroll should contribute 0 to list totals
 * while preserving earned amounts for payslip detail ("12,000 EGP — Done").
 */
const { portionEarnedNet } = require("./payroll-hybrid");

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function payrollStatusNormalized(row) {
  return String(row?.payrollStatus || row?.adj?.payrollStatus || "")
    .trim()
    .toLowerCase();
}

function isNoPayroll(row) {
  if (!row) return false;
  if (row.noPayroll === true) return true;
  return payrollStatusNormalized(row) === "no payroll";
}

/** Whole payslip is settled — exclude monetary columns from payroll totals. */
function isPayrollSettled(row) {
  if (!row) return false;
  if (row.payrollSettled === true) return true;
  if (isNoPayroll(row)) return true;
  const status = payrollStatusNormalized(row);
  if (status === "paid") return true;
  if (row.payrollKind === "training" && row.trainingPayrollPaid === true) return true;
  return false;
}

/**
 * Paid amount for totals: settled/paid nets (not no-payroll, not deferred).
 * Dual rows with training marked paid contribute the waived training earned net.
 */
function payrollPaidNet(row) {
  if (!row || isTrainingDeferredRow(row) || isNoPayroll(row)) return 0;
  const status = payrollStatusNormalized(row);
  if (row.payrollSettled === true || status === "paid") {
    return payrollEarnedNet(row);
  }
  if (row.payrollKind === "training" && row.trainingPayrollPaid === true) {
    return payrollEarnedNet(row);
  }
  // Agent-tab flatten of dual rows carries training paid here (see flattenForAgentTab).
  if (row.paidTrainingNet != null && row.paidTrainingNet !== "") {
    const n = round2(Number(row.paidTrainingNet));
    if (n > 0) return n;
  }
  if (row.payrollKind === "dual") {
    const training = row.training || null;
    if (
      training &&
      (training.trainingPayrollPaid === true ||
        training.payrollSettled === true ||
        row.trainingPayrollPaid === true)
    ) {
      if (training.earnedNetSalary != null && training.earnedNetSalary !== "") {
        return round2(Number(training.earnedNetSalary));
      }
      return round2(Number(training.calculatedNet ?? training.netSalary) || 0);
    }
  }
  return 0;
}

function computeRowEarnedNet(row) {
  if (!row) return 0;
  if (row.payrollKind === "dual") {
    const trainingEarned =
      row.training?.earnedNetSalary != null
        ? Number(row.training.earnedNetSalary) || 0
        : portionEarnedNet(row.training);
    const agentEarned =
      row.agent?.earnedNetSalary != null
        ? Number(row.agent.earnedNetSalary) || 0
        : portionEarnedNet(row.agent);
    return round2(trainingEarned + agentEarned);
  }
  if (row.earnedNetSalary != null && row.earnedNetSalary !== "") {
    return round2(Number(row.earnedNetSalary));
  }
  if (row.hasSplits && row.calculatedNet != null) {
    return round2(Number(row.calculatedNet));
  }
  return round2(
    Number(row.basicSalary || 0) +
      Number(row.totalBonuses || 0) -
      Number(row.totalDeductions || 0) -
      Number(row.bonusTransferPayroll || 0)
  );
}

function payrollEarnedNet(row) {
  if (!row) return 0;
  const earned = computeRowEarnedNet(row);
  if (earned > 0) return earned;
  return round2(Number(row.netSalary ?? row.calculatedNet ?? row.combinedNet) || 0);
}

function payrollEarnedBasic(row) {
  if (!row) return 0;
  if (row.earnedBasicSalary != null && row.earnedBasicSalary !== "") {
    return round2(Number(row.earnedBasicSalary));
  }
  if (row.payrollKind === "dual") {
    const trainingBasic =
      row.training?.earnedBasicSalary != null
        ? Number(row.training.earnedBasicSalary) || 0
        : Number(row.training?.basicSalary) || 0;
    const agentBasic =
      row.agent?.earnedBasicSalary != null
        ? Number(row.agent.earnedBasicSalary) || 0
        : Number(row.agent?.basicSalary) || 0;
    return round2(trainingBasic + agentBasic);
  }
  return round2(Number(row.basicSalary) || 0);
}

function settledLabel(row) {
  if (!isPayrollSettled(row)) return "";
  if (row.noPayroll || payrollStatusNormalized(row) === "no payroll") return "No payroll";
  if (row.trainingPayrollPaid && row.payrollKind === "training") return "Training paid";
  return "Done";
}

function isTrainingDeferredRow(row) {
  return row?.payrollKind === "training_deferred_month";
}

module.exports = {
  isPayrollSettled,
  isNoPayroll,
  isTrainingDeferredRow,
  payrollEarnedNet,
  payrollEarnedBasic,
  payrollPaidNet,
  settledLabel,
  computeRowEarnedNet,
};

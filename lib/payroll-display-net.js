/**
 * Remaining unpaid net on payroll list / Net salary tile.
 * Excludes paid, no-payroll, and deferred training; not post-split balance.
 */
const { isPayrollSettled } = require("./payroll-settled");

function payrollRowDisplayNet(row) {
  if (!row) return 0;
  if (isPayrollSettled(row)) return 0;
  if (row.payrollKind === "training_deferred_month") return 0;
  if (row.payrollKind === "dual") {
    if (
      row.trainingPayrollPaid === true ||
      row.training?.trainingPayrollPaid === true ||
      row.training?.payrollSettled === true
    ) {
      return Number(row.agent?.calculatedNet ?? row.agent?.netSalary) || 0;
    }
    return Number(row.combinedNet ?? row.netSalary) || 0;
  }
  if (row.hasSplits) {
    return Number(row.calculatedNet ?? row.netSalary) || 0;
  }
  return Number(row.netSalary ?? row.calculatedNet) || 0;
}

module.exports = { payrollRowDisplayNet };

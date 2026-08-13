/** Client mirror of lib/payroll-settled.js for grid / payslip display. */

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function payrollStatusNormalized(row: Record<string, unknown>): string {
  const adj = row.adj as Record<string, unknown> | undefined;
  return String(row.payrollStatus || adj?.payrollStatus || "")
    .trim()
    .toLowerCase();
}

export function isNoPayroll(row: Record<string, unknown>): boolean {
  if (!row) return false;
  if (row.noPayroll === true) return true;
  return payrollStatusNormalized(row) === "no payroll";
}

export function isTrainingDeferredRow(row: Record<string, unknown>): boolean {
  return row?.payrollKind === "training_deferred_month";
}

export function isPayrollSettled(row: Record<string, unknown>): boolean {
  if (!row) return false;
  if (row.payrollSettled === true) return true;
  if (isNoPayroll(row)) return true;
  const status = payrollStatusNormalized(row);
  if (status === "paid") return true;
  if (row.payrollKind === "training" && row.trainingPayrollPaid === true) return true;
  return false;
}

function portionEarnedNet(portion: Record<string, unknown> | undefined): number {
  if (!portion) return 0;
  return Number(portion.calculatedNet ?? portion.netSalary) || 0;
}

export function payrollEarnedNet(row: Record<string, unknown>): number {
  if (!row) return 0;
  if (row.payrollKind === "dual") {
    const training = row.training as Record<string, unknown> | undefined;
    const agent = row.agent as Record<string, unknown> | undefined;
    const trainingEarned =
      training?.earnedNetSalary != null
        ? Number(training.earnedNetSalary) || 0
        : portionEarnedNet(training);
    const agentEarned =
      agent?.earnedNetSalary != null ? Number(agent.earnedNetSalary) || 0 : portionEarnedNet(agent);
    return round2(trainingEarned + agentEarned);
  }
  if (row.earnedNetSalary != null && row.earnedNetSalary !== "") {
    return round2(Number(row.earnedNetSalary));
  }
  if (row.hasSplits && row.calculatedNet != null) {
    return round2(Number(row.calculatedNet));
  }
  const computed = round2(
    Number(row.basicSalary || 0) +
      Number(row.totalBonuses || 0) -
      Number(row.totalDeductions || 0) -
      Number(row.bonusTransferPayroll || 0)
  );
  if (computed > 0) return computed;
  return round2(Number(row.netSalary ?? row.calculatedNet ?? row.combinedNet) || 0);
}

/** Paid / Done amounts for the Paid tile (excludes no-payroll and deferred). */
export function payrollPaidNet(row: Record<string, unknown>): number {
  if (!row || isTrainingDeferredRow(row) || isNoPayroll(row)) return 0;
  const status = payrollStatusNormalized(row);
  if (row.payrollSettled === true || status === "paid") {
    return payrollEarnedNet(row);
  }
  if (row.payrollKind === "training" && row.trainingPayrollPaid === true) {
    return payrollEarnedNet(row);
  }
  // Agent-tab flatten of dual rows carries training paid here.
  if (row.paidTrainingNet != null && row.paidTrainingNet !== "") {
    const n = round2(Number(row.paidTrainingNet));
    if (n > 0) return n;
  }
  if (row.payrollKind === "dual") {
    const training = row.training as Record<string, unknown> | undefined;
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

export function settledLabel(row: Record<string, unknown>): string {
  if (!isPayrollSettled(row)) return "";
  if (isNoPayroll(row)) return "No payroll";
  if (row.trainingPayrollPaid && row.payrollKind === "training") return "Training paid";
  return "Done";
}

export function trainingDeferredLabel(row: Record<string, unknown>): string {
  const anchor = String(row.trainingPayrollAnchorMonth || "").slice(0, 7);
  if (!anchor) return "Deferred";
  const [y, m] = anchor.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  const label = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return `Pays in ${label}`;
}

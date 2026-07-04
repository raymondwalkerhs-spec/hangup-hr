const SPLIT_KINDS = ["payment", "training_bonus", "training_payroll", "correction"];
const SPLIT_STATUSES = ["pending", "received", "deferred", "cancelled"];

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function sumAmount(splits, predicate = () => true) {
  return round2(
    (splits || []).filter(predicate).reduce((s, x) => s + Number(x.amount || 0), 0)
  );
}

function nextSplitId() {
  return `PS-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function buildSplitMaps(allSplits, yearMonth) {
  const byEmployeeMonth = new Map();
  const deferredIn = new Map();

  for (const s of allSplits || []) {
    if (s.status === "cancelled") continue;
    if (s.yearMonth === yearMonth) {
      if (!byEmployeeMonth.has(s.employeeId)) byEmployeeMonth.set(s.employeeId, []);
      byEmployeeMonth.get(s.employeeId).push(s);
    }
    if (s.status === "deferred" && s.deferToMonth === yearMonth) {
      if (!deferredIn.has(s.employeeId)) deferredIn.set(s.employeeId, []);
      deferredIn.get(s.employeeId).push(s);
    }
  }

  return { byEmployeeMonth, deferredIn };
}

function applyPayrollSplits(payslip, splitsForMonth = [], deferredIn = []) {
  const active = (splitsForMonth || []).filter((s) => s.status !== "cancelled");
  const calculatedNet = payslip.netSalary;
  const deferredInTotal = sumAmount(deferredIn);
  const receivedTotal = sumAmount(active, (s) => s.status === "received");
  const deferredOutTotal = sumAmount(active, (s) => s.status === "deferred");
  const pendingTotal = sumAmount(active, (s) => s.status === "pending");
  const correctionTotal = sumAmount(active, (s) => s.splitKind === "correction");
  const trainingBonusTotal = sumAmount(active, (s) => s.splitKind === "training_bonus" && s.status === "received");
  const trainingPayrollTotal = sumAmount(
    active,
    (s) => s.splitKind === "training_payroll" && s.status === "received"
  );

  const grossPayable = round2(calculatedNet + deferredInTotal + correctionTotal);
  const remainingBalance = round2(grossPayable - receivedTotal - deferredOutTotal);

  return {
    ...payslip,
    calculatedNet,
    deferredIn: deferredInTotal,
    deferredOut: deferredOutTotal,
    receivedTotal,
    pendingSplitsTotal: pendingTotal,
    correctionTotal,
    trainingBonusTotal,
    trainingPayrollTotal,
    grossPayable,
    remainingBalance,
    hasSplits: active.length > 0 || deferredInTotal > 0,
    splits: active,
    deferredInSplits: deferredIn || [],
    netSalary: remainingBalance,
  };
}

function buildValidationContext(calculatedNet, splitsForMonth = [], deferredIn = [], excludeSplitId = null) {
  const active = (splitsForMonth || []).filter(
    (s) => s.status !== "cancelled" && s.id !== excludeSplitId
  );
  const deferredInTotal = sumAmount(deferredIn);
  const correctionTotal = sumAmount(active, (s) => s.splitKind === "correction");
  const grossPayable = round2(calculatedNet + deferredInTotal + correctionTotal);
  const receivedTotal = sumAmount(active, (s) => s.status === "received");
  const deferredOut = sumAmount(active, (s) => s.status === "deferred");
  return { grossPayable, calculatedNet, splits: active, receivedTotal, deferredOut };
}

function validateSplit(split, payslipContext = null) {
  const amount = Number(split.amount);
  if (!split.employeeId || !split.yearMonth) {
    return "employeeId and yearMonth required";
  }
  const kind = split.splitKind || "payment";
  if (!SPLIT_KINDS.includes(kind)) {
    return "Invalid split kind";
  }
  if ((kind === "payment" || kind === "training_bonus" || kind === "training_payroll") && !(amount > 0)) {
    return `${kind === "training_bonus" ? "Training bonus" : kind === "training_payroll" ? "Training payroll" : "Payment"} split amount must be greater than 0`;
  }
  if (split.splitKind === "correction" && amount === 0) {
    return "Correction amount cannot be 0";
  }
  if (!SPLIT_STATUSES.includes(split.status || "pending")) {
    return "Invalid status";
  }
  if (split.status === "deferred") {
    if (!split.deferToMonth) return "deferToMonth required when deferring to another month";
    if (split.deferToMonth <= split.yearMonth) {
      return "deferToMonth must be after the source payroll month";
    }
  }
  if (payslipContext && split.status !== "cancelled") {
    const { grossPayable = payslipContext.calculatedNet, receivedTotal = 0, deferredOut = 0 } =
      payslipContext;
    const others = (payslipContext.splits || []).filter((s) => s.id !== split.id);
    const otherReceived = sumAmount(others, (s) => s.status === "received");
    const otherDeferred = sumAmount(others, (s) => s.status === "deferred");
    const addReceived = split.status === "received" ? amount : 0;
    const addDeferred = split.status === "deferred" ? amount : 0;
    if (otherReceived + otherDeferred + addReceived + addDeferred > grossPayable + 0.01) {
      return `Split total exceeds gross payable (${fmt(grossPayable)} EGP)`;
    }
  }
  return null;
}

function fmt(n) {
  return Math.round(n || 0).toLocaleString();
}

module.exports = {
  SPLIT_KINDS,
  SPLIT_STATUSES,
  nextSplitId,
  shiftMonth,
  buildSplitMaps,
  buildValidationContext,
  applyPayrollSplits,
  validateSplit,
  sumAmount,
};

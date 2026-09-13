const crypto = require("crypto");

const SCHEDULE_ACTIVE_STATUSES = new Set(["scheduled", "due"]);
const SCHEDULE_LOCKED_STATUSES = new Set(["paid", "in_payroll", "waived"]);
const SCHEDULE_DEDUCTABLE_STATUSES = new Set(["scheduled", "due"]);

function parseYearMonth(ym) {
  const [y, m] = String(ym || "").split("-").map(Number);
  return { year: y, month: m };
}

function nextMonth(ym) {
  const { year, month } = parseYearMonth(ym);
  const d = new Date(year, month, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function computeStartYearMonth(createdYearMonth, skipCurrentMonth) {
  return skipCurrentMonth ? nextMonth(createdYearMonth) : createdYearMonth;
}

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function newScheduleLineId() {
  return crypto.randomUUID();
}

/** Remaining principal from actual payment amounts when payments provided; else counter fallback. */
function remainingLoanAmount(loan, payments = null) {
  const total = Number(loan?.totalAmount) || 0;
  if (Array.isArray(payments)) {
    const paid = payments
      .filter((p) => p && p.loanId === loan.id)
      .reduce((s, p) => s + (Number(p.amount) || 0), 0);
    return Math.max(0, roundMoney(total - paid));
  }
  const paid = (loan.installmentsPaid || 0) * (loan.installmentAmount || 0);
  return Math.max(0, roundMoney(total - paid));
}

function installmentsRemaining(loan, payments = null) {
  const rem = remainingLoanAmount(loan, payments);
  const installment = Number(loan?.installmentAmount) || 0;
  if (rem <= 0) return 0;
  if (installment <= 0) return rem > 0 ? 1 : 0;
  return Math.max(1, Math.ceil(rem / installment - 1e-9));
}

function findOverride(overrides, loanId, yearMonth) {
  if (!Array.isArray(overrides)) return null;
  return (
    overrides.find(
      (o) => o && o.loanId === loanId && o.yearMonth === yearMonth && Number(o.amount) > 0
    ) || null
  );
}

function loanScheduleLinesFor(loanId, scheduleLines) {
  if (!Array.isArray(scheduleLines) || !loanId) return [];
  return scheduleLines.filter((l) => l && l.loanId === loanId && l.status !== "cancelled");
}

function hasSchedule(loanId, scheduleLines) {
  return loanScheduleLinesFor(loanId, scheduleLines).length > 0;
}

function isLineLocked(line) {
  if (!line) return true;
  if (line.locked === true) return true;
  return SCHEDULE_LOCKED_STATUSES.has(line.status);
}

function occupiedYearMonths(lines) {
  const set = new Set();
  for (const l of lines || []) {
    if (!l || l.status === "cancelled") continue;
    if (l.yearMonth) set.add(l.yearMonth);
  }
  return set;
}

function nextFreeMonth(occupied, afterYm) {
  let ym = nextMonth(afterYm);
  while (occupied.has(ym)) ym = nextMonth(ym);
  return ym;
}

function maxSeq(lines) {
  let max = 0;
  for (const l of lines || []) {
    const s = Number(l?.seq) || 0;
    if (s > max) max = s;
  }
  return max;
}

/**
 * Generate scheduled installment lines from principal / installment / start month.
 * Skips months already occupied (paid/skipped/etc).
 */
function generateScheduleLines(loan, opts = {}) {
  if (!loan?.id) throw new Error("loan.id required");
  const startYearMonth = opts.startYearMonth || loan.startYearMonth;
  if (!/^\d{4}-\d{2}$/.test(String(startYearMonth || ""))) {
    throw new Error("startYearMonth (YYYY-MM) required");
  }

  const remaining =
    opts.remainingAmount != null
      ? roundMoney(opts.remainingAmount)
      : roundMoney(Number(loan.totalAmount) || 0);
  if (remaining <= 0) return [];

  const installment = Number(loan.installmentAmount) || remaining;
  const occupied = occupiedYearMonths(opts.occupiedLines || opts.existingLines || []);
  for (const ym of opts.occupiedMonths || []) occupied.add(ym);

  const unit = opts.unit != null ? opts.unit : loan.unit || null;
  let rem = remaining;
  let ym = startYearMonth;
  let seq = Number(opts.fromSeq) > 0 ? Number(opts.fromSeq) : maxSeq(opts.existingLines || []) + 1;
  const lines = [];
  let guard = 0;

  while (rem > 0.005 && guard < 600) {
    guard += 1;
    while (occupied.has(ym)) ym = nextMonth(ym);
    const dueAmount = roundMoney(Math.min(installment, rem));
    if (dueAmount <= 0) break;
    const id = opts.idFactory ? opts.idFactory() : newScheduleLineId();
    lines.push({
      id,
      loanId: loan.id,
      seq,
      yearMonth: ym,
      dueAmount,
      status: "scheduled",
      paidAmount: null,
      paidAt: null,
      skipReason: "",
      deferredFromLineId: null,
      deferredToLineId: null,
      locked: false,
      unit,
      createdAt: opts.now || null,
      updatedAt: opts.now || null,
    });
    occupied.add(ym);
    rem = roundMoney(rem - dueAmount);
    ym = nextMonth(ym);
    seq += 1;
  }
  return lines;
}

/**
 * Skip current month: mark line skipped and defer installment to next free month.
 * Mutates a copy of the lines array; returns { lines, skipped, deferred }.
 */
function skipScheduleMonth(lines, { loanId, yearMonth, reason, unit } = {}) {
  if (!loanId || !/^\d{4}-\d{2}$/.test(String(yearMonth || ""))) {
    throw new Error("loanId and yearMonth (YYYY-MM) required");
  }
  const all = (lines || []).map((l) => ({ ...l }));
  const active = all.filter((l) => l.loanId === loanId && l.status !== "cancelled");
  const line = active.find(
    (l) =>
      l.yearMonth === yearMonth &&
      SCHEDULE_ACTIVE_STATUSES.has(l.status) &&
      !isLineLocked(l)
  );
  if (!line) {
    throw new Error(`No skippable schedule line for ${yearMonth}`);
  }

  const occupied = occupiedYearMonths(active);
  const freeYm = nextFreeMonth(occupied, yearMonth);
  const deferred = {
    id: newScheduleLineId(),
    loanId,
    seq: maxSeq(active) + 1,
    yearMonth: freeYm,
    dueAmount: roundMoney(line.dueAmount),
    status: "scheduled",
    paidAmount: null,
    paidAt: null,
    skipReason: "",
    deferredFromLineId: line.id,
    deferredToLineId: null,
    locked: false,
    unit: unit != null ? unit : line.unit || null,
    createdAt: null,
    updatedAt: null,
  };

  line.status = "skipped";
  line.skipReason = reason || "";
  line.deferredToLineId = deferred.id;
  line.locked = true;

  return {
    lines: [...all.filter((l) => l.id !== line.id), line, deferred],
    skipped: line,
    deferred,
  };
}

/**
 * Start-month shift: cancel unlocked future scheduled/due lines and regenerate from new start.
 * Locked/paid/skipped history is kept. Returns { lines, cancelled, created }.
 */
function shiftScheduleStartMonth(loan, lines, newStartYearMonth, payments = [], opts = {}) {
  if (!loan?.id) throw new Error("loan.id required");
  if (!/^\d{4}-\d{2}$/.test(String(newStartYearMonth || ""))) {
    throw new Error("newStartYearMonth (YYYY-MM) required");
  }

  const all = (lines || []).map((l) => ({ ...l }));
  const forLoan = all.filter((l) => l.loanId === loan.id);
  const cancelled = [];
  const kept = [];

  for (const line of forLoan) {
    if (line.status === "cancelled") {
      kept.push(line);
      continue;
    }
    if (
      SCHEDULE_DEDUCTABLE_STATUSES.has(line.status) &&
      !isLineLocked(line) &&
      line.yearMonth >= newStartYearMonth
    ) {
      cancelled.push({ ...line, status: "cancelled", locked: false });
      continue;
    }
    // Also cancel unlocked scheduled lines before new start that would conflict with regen placement? keep them if before new start
    if (SCHEDULE_DEDUCTABLE_STATUSES.has(line.status) && !isLineLocked(line)) {
      cancelled.push({ ...line, status: "cancelled", locked: false });
      continue;
    }
    kept.push(line);
  }

  const remaining = remainingLoanAmount(loan, payments);
  const created = generateScheduleLines(
    { ...loan, startYearMonth: newStartYearMonth },
    {
      startYearMonth: newStartYearMonth,
      remainingAmount: remaining,
      existingLines: kept.filter((l) => l.status !== "cancelled"),
      fromSeq: maxSeq(kept) + 1,
      unit: opts.unit != null ? opts.unit : loan.unit,
      idFactory: opts.idFactory,
      now: opts.now,
    }
  );

  const others = all.filter((l) => l.loanId !== loan.id);
  return {
    lines: [...others, ...kept, ...cancelled, ...created],
    cancelled,
    created,
  };
}

/**
 * Full regenerate of unlocked scheduled/due lines from remaining balance.
 */
function regenerateSchedule(loan, lines, payments = [], opts = {}) {
  const start =
    opts.startYearMonth ||
    loan.startYearMonth ||
    new Date().toISOString().slice(0, 7);
  return shiftScheduleStartMonth(loan, lines, start, payments, opts);
}

/**
 * Build schedule from historical payments + remaining balance (backfill helper).
 */
function backfillScheduleFromLoan(loan, payments = [], opts = {}) {
  if (!loan?.id) throw new Error("loan.id required");
  const loanPayments = (payments || [])
    .filter((p) => p && p.loanId === loan.id)
    .slice()
    .sort((a, b) => String(a.yearMonth).localeCompare(String(b.yearMonth)));

  const paidLines = loanPayments.map((p, i) => ({
    id: opts.idFactory ? opts.idFactory() : newScheduleLineId(),
    loanId: loan.id,
    seq: i + 1,
    yearMonth: p.yearMonth,
    dueAmount: roundMoney(p.amount),
    status: "paid",
    paidAmount: roundMoney(p.amount),
    paidAt: p.recordedAt || opts.now || null,
    skipReason: "",
    deferredFromLineId: null,
    deferredToLineId: null,
    locked: true,
    unit: opts.unit != null ? opts.unit : loan.unit || null,
    createdAt: opts.now || null,
    updatedAt: opts.now || null,
  }));

  const remaining = remainingLoanAmount(loan, loanPayments);
  let start = loan.startYearMonth || new Date().toISOString().slice(0, 7);
  if (paidLines.length) {
    start = nextMonth(paidLines[paidLines.length - 1].yearMonth);
  }

  const future = generateScheduleLines(loan, {
    startYearMonth: start,
    remainingAmount: remaining,
    existingLines: paidLines,
    fromSeq: paidLines.length + 1,
    occupiedMonths: paidLines.map((l) => l.yearMonth),
    unit: opts.unit != null ? opts.unit : loan.unit,
    idFactory: opts.idFactory,
    now: opts.now,
  });

  return [...paidLines, ...future];
}

function findScheduleLineForMonth(loanLines, yearMonth) {
  return (
    loanLines.find(
      (l) =>
        l.yearMonth === yearMonth && SCHEDULE_DEDUCTABLE_STATUSES.has(l.status) && !isLineLocked(l)
    ) || null
  );
}

function deductionFromSchedule(loan, yearMonth, payments, overrides, loanLines) {
  const allPayments = Array.isArray(payments) ? payments : [];
  const monthPayments = allPayments.filter((p) => p.yearMonth === yearMonth);
  const paidThisMonth = monthPayments.find((p) => p.loanId === loan.id && p.yearMonth === yearMonth);

  if (paidThisMonth) {
    const remAfter = remainingLoanAmount(loan, allPayments);
    return {
      loanId: loan.id,
      employeeId: loan.employeeId,
      amount: roundMoney(paidThisMonth.amount),
      installmentNumber: paidThisMonth.installmentNumber,
      installmentsTotal: loan.installmentsCount,
      remainingAfter: remAfter,
      notes: loan.notes || "",
      recorded: true,
      adjusted: false,
      scheduleLineId: paidThisMonth.scheduleLineId || null,
      fromSchedule: true,
    };
  }

  const paidLine = loanLines.find((l) => l.yearMonth === yearMonth && l.status === "paid");
  if (paidLine) {
    return {
      loanId: loan.id,
      employeeId: loan.employeeId,
      amount: roundMoney(paidLine.paidAmount != null ? paidLine.paidAmount : paidLine.dueAmount),
      installmentNumber: paidLine.seq,
      installmentsTotal: loan.installmentsCount,
      remainingAfter: remainingLoanAmount(loan, allPayments),
      notes: loan.notes || "",
      recorded: true,
      adjusted: false,
      scheduleLineId: paidLine.id,
      fromSchedule: true,
    };
  }

  const line = findScheduleLineForMonth(loanLines, yearMonth);
  if (!line) return null;

  const remaining = remainingLoanAmount(loan, allPayments);
  if (remaining <= 0) return null;

  const override = findOverride(overrides, loan.id, yearMonth);
  const defaultInstallment = roundMoney(line.dueAmount);
  let amount;
  let adjusted = false;
  if (override) {
    amount = Math.min(Number(override.amount) || 0, remaining);
    adjusted = true;
  } else {
    amount = Math.min(defaultInstallment, remaining);
  }
  if (amount <= 0) return null;

  amount = roundMoney(amount);
  return {
    loanId: loan.id,
    employeeId: loan.employeeId,
    amount,
    installmentNumber: line.seq,
    installmentsTotal: loan.installmentsCount,
    remainingAfter: roundMoney(remaining - amount),
    notes: override?.note ? `${loan.notes || ""} ${override.note}`.trim() : loan.notes || "",
    recorded: false,
    adjusted,
    overrideAmount: override ? roundMoney(override.amount) : null,
    defaultInstallment,
    scheduleLineId: line.id,
    fromSchedule: true,
  };
}

/**
 * Deduction for one loan/month.
 * Dual-read: if non-cancelled schedule rows exist for the loan → schedule path; else legacy counters.
 * @param {object} loan
 * @param {string} yearMonth
 * @param {array} payments
 * @param {array} overrides - loan_month_overrides rows
 * @param {array|null} scheduleLines - all (or loan-scoped) loan_schedule_lines
 */
function getLoanDeductionForMonth(loan, yearMonth, payments = [], overrides = [], scheduleLines = null) {
  const allPayments = Array.isArray(payments) ? payments : [];
  const monthPayments = allPayments.filter((p) => p.yearMonth === yearMonth);

  if (!loan || loan.status === "completed") {
    const paidThisMonth = monthPayments.find((p) => p.loanId === loan?.id && p.yearMonth === yearMonth);
    if (paidThisMonth) {
      return {
        loanId: loan.id,
        employeeId: loan.employeeId,
        amount: roundMoney(paidThisMonth.amount),
        installmentNumber: paidThisMonth.installmentNumber,
        installmentsTotal: loan.installmentsCount,
        remainingAfter: 0,
        notes: loan.notes || "",
        recorded: true,
        adjusted: false,
      };
    }
    return null;
  }
  if (loan.status !== "active") return null;
  if (loan.paused === true) return null;

  const loanLines = loanScheduleLinesFor(loan.id, scheduleLines);
  if (loanLines.length > 0) {
    return deductionFromSchedule(loan, yearMonth, allPayments, overrides, loanLines);
  }

  // Legacy path (installment counters + start month)
  if (yearMonth < loan.startYearMonth) return null;

  const paidThisMonth = monthPayments.find((p) => p.loanId === loan.id && p.yearMonth === yearMonth);
  if (paidThisMonth) {
    const remAfter = remainingLoanAmount(loan, allPayments);
    return {
      loanId: loan.id,
      employeeId: loan.employeeId,
      amount: roundMoney(paidThisMonth.amount),
      installmentNumber: paidThisMonth.installmentNumber,
      installmentsTotal: loan.installmentsCount,
      remainingAfter: remAfter,
      notes: loan.notes || "",
      recorded: true,
      adjusted: false,
    };
  }

  const remaining = remainingLoanAmount(loan, allPayments);
  if (remaining <= 0) return null;

  const override = findOverride(overrides, loan.id, yearMonth);
  const defaultInstallment = Number(loan.installmentAmount) || 0;
  let amount;
  let adjusted = false;
  if (override) {
    amount = Math.min(Number(override.amount) || 0, remaining);
    adjusted = true;
  } else {
    amount = Math.min(defaultInstallment, remaining);
  }
  if (amount <= 0) return null;

  amount = roundMoney(amount);
  const installmentNumber = (loan.installmentsPaid || 0) + 1;

  return {
    loanId: loan.id,
    employeeId: loan.employeeId,
    amount,
    installmentNumber,
    installmentsTotal: loan.installmentsCount,
    remainingAfter: roundMoney(remaining - amount),
    notes: override?.note ? `${loan.notes || ""} ${override.note}`.trim() : loan.notes || "",
    recorded: false,
    adjusted,
    overrideAmount: override ? roundMoney(override.amount) : null,
    defaultInstallment: roundMoney(defaultInstallment),
    fromSchedule: false,
  };
}

function getEmployeeLoanDeductions(
  loans,
  employeeId,
  yearMonth,
  payments = [],
  overrides = [],
  scheduleLines = null
) {
  return loans
    .filter((l) => l.employeeId === employeeId)
    .map((loan) =>
      getLoanDeductionForMonth(loan, yearMonth, payments, overrides, scheduleLines)
    )
    .filter(Boolean);
}

function totalLoanDeduction(deductions) {
  return roundMoney(deductions.reduce((s, d) => s + d.amount, 0));
}

function markScheduleLinePaid(line, amount, paidAt = null) {
  if (!line) return null;
  return {
    ...line,
    status: "paid",
    paidAmount: roundMoney(amount),
    paidAt: paidAt || new Date().toISOString(),
    locked: true,
  };
}

module.exports = {
  nextMonth,
  computeStartYearMonth,
  roundMoney,
  remainingLoanAmount,
  installmentsRemaining,
  findOverride,
  newScheduleLineId,
  generateScheduleLines,
  skipScheduleMonth,
  shiftScheduleStartMonth,
  regenerateSchedule,
  backfillScheduleFromLoan,
  hasSchedule,
  loanScheduleLinesFor,
  isLineLocked,
  markScheduleLinePaid,
  getLoanDeductionForMonth,
  getEmployeeLoanDeductions,
  totalLoanDeduction,
  SCHEDULE_ACTIVE_STATUSES,
  SCHEDULE_LOCKED_STATUSES,
};

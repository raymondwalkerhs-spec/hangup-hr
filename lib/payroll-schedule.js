/**
 * Payment due dates and Total payrolls (cash-out month) view.
 */
const { shiftMonth } = require("./payroll-splits");

function parseDate(s) {
  const d = String(s || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function dueDateInMonth(dueDate, calendarMonth) {
  return Boolean(dueDate && dueDate.startsWith(calendarMonth));
}

/** Agent accrual month M → paid on 15th of month M+1. */
function agentPaymentDueDate(accrualMonth) {
  if (!accrualMonth) return null;
  return `${shiftMonth(accrualMonth, 1)}-15`;
}

/** Training payout due when program passes / promotes / ends. */
function trainingPaymentDueDate(program) {
  if (!program) return null;
  const passed = parseDate(program.passedOnDate || program.passed_on_date);
  const promo = parseDate(program.promotionEffectiveDate || program.promotion_effective_date);
  const phases = program.allPhases || program.phases || [];
  let programEnd = null;
  for (const ph of phases) {
    const we = ph.weekEnd || ph.week_end;
    if (we && (!programEnd || we > programEnd)) programEnd = we;
  }
  return passed || promo || programEnd || null;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function isTrainingSplit(split) {
  return split.splitKind === "training_payroll" || split.payrollKind === "training";
}

function isAgentSplit(split) {
  return !isTrainingSplit(split) && split.splitKind !== "training_bonus";
}

function receivedSplitsForPayment(allSplits, employeeId, { accrualMonth, paymentDueDate, calendarMonth, kind }) {
  if (!dueDateInMonth(paymentDueDate, calendarMonth)) return [];
  return (allSplits || []).filter((s) => {
    if (s.employeeId !== employeeId || s.status !== "received") return false;
    if (s.yearMonth !== accrualMonth) return false;
    if (kind === "training") return isTrainingSplit(s);
    return isAgentSplit(s);
  });
}

function buildTotalPaidEntry(row, { accrualMonth, paymentDueDate, payrollKind, allSplits, calendarMonth }) {
  const kind = payrollKind === "training" ? "training" : "agent";
  const received = receivedSplitsForPayment(allSplits, row.employeeId, {
    accrualMonth,
    paymentDueDate,
    calendarMonth,
    kind,
  });
  const receivedAmount = round2(received.reduce((s, x) => s + Number(x.amount || 0), 0));
  const scheduledAmount = round2(row.netSalary ?? row.calculatedNet ?? 0);
  const netSalary = receivedAmount > 0 ? receivedAmount : scheduledAmount;

  return {
    ...row,
    accrualMonth,
    paymentDueDate,
    payrollKind: kind,
    scheduledAmount,
    receivedAmount,
    netSalary,
    hasReceivedPayment: receivedAmount > 0,
    receivedSplits: received,
  };
}

/**
 * Rows where payment is due or received in calendarMonth.
 * @param {string} calendarMonth YYYY-MM — cash-out month (Total tab)
 * @param {object} accrualByMonth { [ym]: enrichedRows[] }
 * @param {Array} allSplits
 * @param {Map} programsByEmployee
 */
function buildTotalPaidView(calendarMonth, accrualByMonth, allSplits, programsByEmployee) {
  const priorMonth = shiftMonth(calendarMonth, -1);
  const seen = new Set();
  const rows = [];

  const priorRows = accrualByMonth[priorMonth] || [];
  for (const enriched of priorRows) {
    const agentRow =
      enriched.payrollKind === "dual"
        ? enriched.agent
          ? { ...enriched.agent, employeeId: enriched.employeeId, name: enriched.name, unit: enriched.unit }
          : null
        : enriched.payrollKind === "training"
          ? null
          : enriched;
    if (!agentRow) continue;
    const due = agentPaymentDueDate(priorMonth);
    if (!dueDateInMonth(due, calendarMonth)) continue;
    const key = `${agentRow.employeeId}:agent:${priorMonth}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(
      buildTotalPaidEntry(agentRow, {
        accrualMonth: priorMonth,
        paymentDueDate: due,
        payrollKind: "agent",
        allSplits,
        calendarMonth,
      })
    );
  }

  for (const [accrualMonth, enrichedRows] of Object.entries(accrualByMonth)) {
    for (const enriched of enrichedRows) {
      const program = programsByEmployee?.get?.(enriched.employeeId);
      const trainingRow =
        enriched.payrollKind === "dual"
          ? enriched.training
            ? {
                ...enriched.training,
                employeeId: enriched.employeeId,
                name: enriched.name,
                unit: enriched.unit,
              }
            : null
          : enriched.payrollKind === "training"
            ? enriched
            : null;
      if (!trainingRow) continue;
      const due = trainingPaymentDueDate(program);
      if (!dueDateInMonth(due, calendarMonth)) continue;
      const key = `${trainingRow.employeeId}:training:${accrualMonth}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(
        buildTotalPaidEntry(trainingRow, {
          accrualMonth,
          paymentDueDate: due,
          payrollKind: "training",
          allSplits,
          calendarMonth,
        })
      );
    }
  }

  rows.sort(
    (a, b) =>
      (a.unit || "").localeCompare(b.unit || "") ||
      (a.name || "").localeCompare(b.name || "") ||
      (a.accrualMonth || "").localeCompare(b.accrualMonth || "")
  );

  const totals = {
    employees: rows.length,
    totalBasic: round2(rows.reduce((s, p) => s + (p.basicSalary || 0), 0)),
    totalBonuses: round2(rows.reduce((s, p) => s + (p.totalBonuses || 0), 0)),
    totalLateness: round2(rows.reduce((s, p) => s + (p.latenessDeduction || 0), 0)),
    totalDeductions: round2(rows.reduce((s, p) => s + (p.totalDeductions || 0), 0)),
    totalBonusTransfers: round2(rows.reduce((s, p) => s + (p.bonusTransferPayroll || 0), 0)),
    totalNet: round2(rows.reduce((s, p) => s + (p.netSalary || 0), 0)),
    totalReceived: round2(rows.reduce((s, p) => s + (p.receivedAmount || 0), 0)),
    totalScheduled: round2(rows.reduce((s, p) => s + (p.scheduledAmount || 0), 0)),
  };

  return { rows, totals, paymentMonth: calendarMonth };
}

module.exports = {
  agentPaymentDueDate,
  trainingPaymentDueDate,
  buildTotalPaidView,
  dueDateInMonth,
};

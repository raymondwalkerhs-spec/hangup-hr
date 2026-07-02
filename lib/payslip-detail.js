const { employeeDisplayName } = require("./attendance");

function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  const r = n % 10;
  if (r === 1) return `${n}st`;
  if (r === 2) return `${n}nd`;
  if (r === 3) return `${n}rd`;
  return `${n}th`;
}

function formatLongDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(`${String(dateStr).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  const month = d.toLocaleDateString("en-US", { month: "long" });
  return `${month} ${ordinal(d.getDate())} ${d.getFullYear()}`;
}

function monthPayrollFolderName(ym) {
  const [y, m] = ym.split("-").map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return `${label.replace(/ /g, "_")}_Payroll`;
}

function resolveEmployeeName(empMap, id) {
  if (!id) return "—";
  const emp = empMap.get(id);
  return emp ? employeeDisplayName(emp) : id;
}

function parseTlBonusTargetId(reason) {
  const m = String(reason || "").match(/paid to\s+(\S+)/i);
  return m ? m[1] : null;
}

function parseTlBonusSourceId(reason) {
  const m = String(reason || "").match(/deducted from\s+(\S+)\)/i);
  return m ? m[1] : null;
}

function buildAttendanceDetailLines(records, config) {
  const lines = [];
  const sorted = [...records].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const r of sorted) {
    const when = formatLongDate(r.date);
    if (r.status === "Lateness A") {
      lines.push({
        kind: "lateness",
        text: `Lateness A — ${config.latenessRules.tierA.amount} EGP on ${when}`,
        amount: config.latenessRules.tierA.amount,
      });
    } else if (r.status === "Lateness B") {
      lines.push({
        kind: "lateness",
        text: `Lateness B — ${config.latenessRules.tierB.amount} EGP on ${when}`,
        amount: config.latenessRules.tierB.amount,
      });
    } else if (r.status === "Quarter Day-Off") {
      lines.push({ kind: "attendance", text: `Quarter day on ${when}`, amount: 0 });
    } else if (r.status === "Half Day") {
      lines.push({ kind: "attendance", text: `Half day on ${when}`, amount: 0 });
    }
  }
  return lines;
}

function buildBonusDetailLines(payslip, bonusEvents, empMap) {
  const lines = [];
  const seen = new Set();

  for (const b of bonusEvents) {
    if (b.type === "Comission" || b.type === "Transportation") continue;
    const key = `${b.date}|${b.type}|${b.amount}`;
    seen.add(key);
    let detail = b.reason || "";
    const fromId = parseTlBonusSourceId(detail);
    if (b.type === "Bonus from TL / OP" && fromId) {
      detail = `Paid by ${resolveEmployeeName(empMap, fromId)}${detail ? ` — ${detail.replace(/\s*\(deducted from[^)]+\)\s*/i, "").trim()}` : ""}`;
    }
    lines.push({
      type: b.type,
      amount: b.amount,
      date: b.date,
      label: `${b.type} — ${b.amount} EGP — ${formatLongDate(b.date)}${detail ? ` — ${detail}` : ""}`,
    });
  }

  if (payslip.commissionAmount > 0) {
    const tierText = (payslip.commissionBreakdown || [])
      .map((t) => `${t.label}: ${t.amount}`)
      .join(" + ");
    lines.push({
      type: "Comission",
      amount: payslip.commissionAmount,
      date: payslip.yearMonth ? `${payslip.yearMonth}-01` : "",
      label: `Comission — ${payslip.commissionAmount} EGP${tierText ? ` (${tierText})` : ""}`,
    });
  }

  if (payslip.transportAllowance > 0) {
    lines.push({
      type: "Transportation",
      amount: payslip.transportAllowance,
      date: payslip.yearMonth ? `${payslip.yearMonth}-01` : "",
      label: `Transportation — ${payslip.transportAllowance} EGP (${payslip.transportDays} day-units)`,
    });
  }

  return lines;
}

function buildDeductionDetailLines(payslip, deductionEvents, empMap, attendanceLines, config) {
  const lines = [];
  const manualLateness = deductionEvents.filter((d) => d.type === "Lateness Deduction");

  if (manualLateness.length) {
    for (const d of manualLateness) {
      lines.push({
        type: d.type,
        amount: d.amount,
        date: d.date,
        label: `${d.type} — ${d.amount} EGP — ${formatLongDate(d.date)}${d.reason ? ` — ${d.reason}` : ""}`,
      });
    }
  } else if (attendanceLines.filter((l) => l.kind === "lateness").length) {
    for (const l of attendanceLines.filter((x) => x.kind === "lateness")) {
      lines.push({ type: "Lateness Deduction", amount: l.amount, label: l.text });
    }
  } else if (payslip.latenessDeduction > 0) {
    lines.push({
      type: "Lateness Deduction",
      amount: payslip.latenessDeduction,
      label: `Lateness — ${payslip.latenessDeduction} EGP${payslip.latenessDetail ? ` (${String(payslip.latenessDetail).replace(/\n/g, ", ")})` : ""}`,
    });
  }

  for (const d of deductionEvents) {
    if (d.type === "Lateness Deduction") continue;
    let label = `${d.type} — ${d.amount} EGP — ${formatLongDate(d.date)}`;
    if (d.type === "Bonus from TL / OP") {
      const targetId = parseTlBonusTargetId(d.reason);
      const targetName = resolveEmployeeName(empMap, targetId);
      label = `${d.amount} EGP deduction = bonus for ${targetName} on ${formatLongDate(d.date)}${d.reason && !targetId ? ` — ${d.reason}` : ""}`;
    } else if (d.reason) {
      label += ` — ${d.reason}`;
    }
    lines.push({ type: d.type, amount: d.amount, date: d.date, label });
  }

  for (const ld of payslip.loanDeductions || []) {
    lines.push({
      type: "Loan Repayment",
      amount: ld.amount,
      label: `Loan Repayment — ${ld.amount} EGP — installment ${ld.installmentNumber}/${ld.installmentsTotal}${ld.notes ? ` — ${ld.notes}` : ""}`,
    });
  }

  if (payslip.holdAmount > 0) {
    lines.push({
      type: "2-week hold",
      amount: payslip.holdAmount,
      label: `2-week hold — ${payslip.holdAmount} EGP`,
    });
  }

  return lines;
}

function buildPayslipPdfContext(payslip, { bonusEvents = [], deductionEvents = [], attendanceRecords = [], config, employees = [] }) {
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const attendanceLines = buildAttendanceDetailLines(attendanceRecords, config);
  return {
    bonusLines: buildBonusDetailLines(payslip, bonusEvents, empMap),
    deductionLines: buildDeductionDetailLines(payslip, deductionEvents, empMap, attendanceLines, config),
    attendanceLines: attendanceLines.filter((l) => l.kind === "attendance"),
  };
}

module.exports = {
  formatLongDate,
  monthPayrollFolderName,
  buildPayslipPdfContext,
  resolveEmployeeName,
  parseTlBonusTargetId,
  parseTlBonusSourceId,
};

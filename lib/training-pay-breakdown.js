/**
 * Training payslip breakdown by calendar month + week-1 withholding line.
 */
function parseDateLocal(s) {
  const d = String(s || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}
const { calcTransportAllowance } = require("./transport");
const {
  TRAINING_DAILY_RATE,
  TRAINING_DAYS_PER_MONTH,
  TRAINING_WEEKLY_SALARY,
  computeProgramTrainingPayDates,
  countTrainingPayUnits,
  isTrainingTransportDate,
} = require("./training-pay-rules");

function dateInRangeLocal(date, start, end) {
  return date >= start && date <= end;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function monthLabel(ym) {
  const [y, m] = String(ym || "").split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  if (Number.isNaN(d.getTime())) return ym;
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function payOptionsFromAdjustment(adjustment) {
  return {
    trainingPhase1PayException: adjustment?.trainingPhase1PayException === true,
  };
}

function recordsForPhase(program, attendance, phaseNumber) {
  const phases = program?.allPhases || program?.phases || [];
  const ph = phases.find((p) => (p.phaseNumber ?? p.phase_number) === phaseNumber);
  if (!ph) return [];
  const ws = ph.weekStart || ph.week_start;
  const we = ph.weekEnd || ph.week_end;
  return (attendance || []).filter((r) => {
    const d = parseDateLocal(r.date);
    return d && dateInRangeLocal(d, ws, we);
  });
}

function computePhase1Withheld(program, attendance) {
  const records = recordsForPhase(program, attendance, 1);
  const units = countTrainingPayUnits(records);
  const basic = round2(units * TRAINING_DAILY_RATE);
  return { units, basic, records };
}

function transportForRecords(records, program, config, transportEligible) {
  const filtered = (records || []).filter((r) =>
    isTrainingTransportDate(program, String(r.date).slice(0, 10))
  );
  const t = calcTransportAllowance(
    filtered,
    TRAINING_DAYS_PER_MONTH,
    config,
    transportEligible,
    { fullGrant: false }
  );
  return { amount: round2(t.amount), days: t.days };
}

function buildTrainingPayBreakdown(emp, program, programPayroll, ctx) {
  const attendance = programPayroll?.attendanceRecords || ctx?.attendanceRecords || [];
  const adjustment = ctx?.adjustment || null;
  const config = ctx?.config || {};
  const transportEligible = adjustment?.transportEligible !== false;
  const options = payOptionsFromAdjustment(adjustment);
  const spanMonths = programPayroll?.months?.length
    ? [...programPayroll.months].sort()
    : [...new Set(attendance.map((r) => String(r.date).slice(0, 7)))].sort();

  const payableDates = computeProgramTrainingPayDates(program, attendance, options);
  const months = [];

  for (const ym of spanMonths) {
    const datesInMonth = [...payableDates].filter((d) => d.startsWith(ym));
    if (!datesInMonth.length) continue;
    const monthRecords = attendance.filter((r) => datesInMonth.includes(String(r.date).slice(0, 10)));
    const units = countTrainingPayUnits(monthRecords);
    const basic = round2(units * TRAINING_DAILY_RATE);
    const transport = transportForRecords(monthRecords, program, config, transportEligible);
    const days = monthRecords
      .map((r) => ({
        date: String(r.date).slice(0, 10),
        status: String(r.status || "—"),
      }))
      .filter((d) => d.date)
      .sort((a, b) => a.date.localeCompare(b.date));
    months.push({
      ym,
      label: monthLabel(ym),
      units,
      basic,
      transport: transport.amount,
      transportDays: transport.days,
      net: round2(basic + transport.amount),
      days,
    });
  }

  const withheld = computePhase1Withheld(program, attendance);
  const deductions = [];
  if (!options.trainingPhase1PayException && withheld.basic > 0) {
    deductions.push({
      id: "phase1_target",
      label: "Week 1 — sales target not met (phase 1 withheld)",
      units: withheld.units,
      amount: withheld.basic,
    });
  }

  let phase1Exception = null;
  if (options.trainingPhase1PayException && withheld.basic > 0) {
    const ph1Ym = (() => {
      const ph1 = recordsForPhase(program, attendance, 1);
      const d = parseDateLocal(ph1[0]?.date);
      return d ? d.slice(0, 7) : spanMonths[0];
    })();
    phase1Exception = {
      ym: ph1Ym,
      label: monthLabel(ph1Ym),
      units: withheld.units,
      basic: withheld.basic,
      note: "Week 1 paid by HR exception",
    };
    const existing = months.find((m) => m.ym === ph1Ym);
    if (existing) {
      existing.units = round2(existing.units + withheld.units);
      existing.basic = round2(existing.basic + withheld.basic);
      existing.net = round2(existing.basic + existing.transport);
      existing.phase1Exception = true;
    } else {
      months.push({
        ym: ph1Ym,
        label: monthLabel(ph1Ym),
        units: withheld.units,
        basic: withheld.basic,
        transport: 0,
        transportDays: 0,
        net: withheld.basic,
        phase1Exception: true,
      });
      months.sort((a, b) => a.ym.localeCompare(b.ym));
    }
  }

  const totals = {
    basic: round2(months.reduce((s, m) => s + m.basic, 0)),
    transport: round2(months.reduce((s, m) => s + m.transport, 0)),
    deductions: round2(deductions.reduce((s, d) => s + d.amount, 0)),
    units: round2(months.reduce((s, m) => s + m.units, 0)),
  };
  // Withheld phase 1 is already excluded from month lines; deduction row is informational.
  totals.net = round2(totals.basic + totals.transport);

  return {
    months,
    deductions,
    phase1Exception,
    phase1ExceptionApplied: options.trainingPhase1PayException,
    weeklyReference: TRAINING_WEEKLY_SALARY,
    dailyRate: TRAINING_DAILY_RATE,
    totals,
  };
}

module.exports = {
  buildTrainingPayBreakdown,
  payOptionsFromAdjustment,
  computePhase1Withheld,
  monthLabel,
};

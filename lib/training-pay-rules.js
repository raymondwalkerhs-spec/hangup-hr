/**
 * Training payroll eligibility rules — phase outcomes, day sets, sales validation.
 */
const { isWeekend, getDaysInMonth, parseYearMonth } = require("./calendar");
const { shiftMonth } = require("./payroll-splits");

const PROGRAM_OUTCOMES = ["active", "passed", "failed", "voluntary_leave", "company_terminated"];
const PHASE_EXIT_REASONS = ["none", "agent_left", "company", "failed_evaluation"];
const MIN_SALES_PER_PHASE = 4;
const MIN_SALES_PROGRAM = 12;
const COMMISSION_SALES_THRESHOLD = 20;

/** Fixed training pay — code-authoritative (not Salaries lookup). */
const TRAINING_MONTHLY_SALARY = 12000;
const TRAINING_DAYS_PER_MONTH = 20;
const TRAINING_DAILY_RATE = 600;
const TRAINING_WEEKLY_SALARY = 3000;

const PAYABLE_PHASE_STATUSES = new Set(["passed", "passed_exception"]);

function parseDate(s) {
  const d = String(s || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function datesInMonth(ym) {
  const { year, month } = parseYearMonth(ym);
  return getDaysInMonth(year, month);
}

function weekdaysInMonth(ym) {
  return datesInMonth(ym).filter((d) => !isWeekend(d));
}

function dateInRange(date, start, end) {
  return date >= start && date <= end;
}

function phaseForDate(phases, date) {
  for (const ph of phases || []) {
    if (dateInRange(date, ph.weekStart || ph.week_start, ph.weekEnd || ph.week_end)) {
      return ph;
    }
  }
  return null;
}

function isWorkedDay(record) {
  if (!record) return false;
  const st = String(record.status || "");
  if (st === "Day-OFF" && !record.paidLeave) return false;
  if (st === "paused") return false;
  return true;
}

/**
 * Payable day-units for trainee basic (WFH included; fractional half/quarter).
 * Quarter Day-Off = 0.75 units (only 0.25 day unpaid) — gates Part D extra_days clear.
 */
function trainingPayUnitForRecord(record) {
  if (!record) return 0;
  const st = String(record.status || "");
  if (st === "Attended" || st === "WFH" || st === "Lateness A" || st === "Lateness B") return 1;
  if (st === "Half Day") return 0.5;
  if (st === "Quarter Day-Off") return 0.75;
  if (st === "Day-OFF" && record.paidLeave) return 1;
  return 0;
}

function countTrainingPayUnits(records) {
  return (records || []).reduce((sum, r) => sum + trainingPayUnitForRecord(r), 0);
}

function filterEligibleToPaidAttendance(eligibleDates, attendance) {
  const byDate = new Map();
  for (const r of attendance || []) {
    const d = parseDate(r.date);
    if (!d) continue;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(r);
  }
  const out = new Set();
  for (const d of eligibleDates) {
    if (countTrainingPayUnits(byDate.get(d) || []) > 0) out.add(d);
  }
  return out;
}

function workedDatesFromAttendance(attendance, { from, to } = {}) {
  const out = new Set();
  for (const r of attendance || []) {
    const d = parseDate(r.date);
    if (!d || isWeekend(d)) continue;
    if (from && d < from) continue;
    if (to && d > to) continue;
    if (isWorkedDay(r)) out.add(d);
  }
  return out;
}

function evaluateProgramSales(phases) {
  const phaseCounts = {};
  let totalPassed = 0;
  for (const ph of phases || []) {
    const n = ph.phaseNumber ?? ph.phase_number;
    if (n < 2) continue;
    const minReq = ph.minSalesRequired ?? ph.min_sales_required ?? MIN_SALES_PER_PHASE;
    const passed = Number(ph.salesPassed ?? ph.sales_passed ?? 0);
    phaseCounts[n] = { passed, minRequired: minReq, met: passed >= minReq };
    totalPassed += passed;
  }
  const phaseTargetsMet = [2, 3, 4].every((n) => phaseCounts[n]?.met === true);
  return {
    totalPassed,
    phaseCounts,
    meetsMinimum12: totalPassed >= MIN_SALES_PROGRAM,
    phaseTargetsMet,
    readyToPass: totalPassed >= MIN_SALES_PROGRAM && phaseTargetsMet,
  };
}

function validatePhaseSales(ph, salesPassed) {
  const n = ph.phaseNumber ?? ph.phase_number;
  const minReq = ph.minSalesRequired ?? ph.min_sales_required ?? MIN_SALES_PER_PHASE;
  if (n < 2) return { ok: true, warnings: [] };
  const passed = Number(salesPassed ?? ph.salesPassed ?? 0);
  const warnings = [];
  if (passed < minReq) {
    warnings.push(`Phase ${n}: ${passed}/${minReq} passed sales (minimum ${minReq})`);
  }
  return { ok: passed >= minReq || ph.status === "passed_exception", warnings };
}

function programHasExceptionPass(program) {
  return (program?.allPhases || program?.phases || []).some(
    (p) => p.status === "passed_exception"
  );
}

/** Trainee transport allowance starts week 2 (phase 2+). Phase 1 never earns transport. */
function isTrainingTransportDate(program, date) {
  const d = parseDate(date);
  if (!d) return false;
  const ph = phaseForDate(program?.allPhases || program?.phases || [], d);
  if (!ph) return false;
  const n = ph.phaseNumber ?? ph.phase_number;
  return n >= 2;
}

/**
 * Whether a single attendance date earns trainee basic pay (phase 2+ rules, v1.5 model).
 */
function isTrainingPayDate(program, date, attendance, ym, options = {}) {
  if (!date || !date.startsWith(ym) || isWeekend(date)) return false;
  const phases = program.allPhases || program.phases || [];
  const outcome = program.outcome || "active";
  const promotionDate = parseDate(program.promotionEffectiveDate || program.promotion_effective_date);
  const phase2Login = parseDate(program.phase2FirstLoginDate || program.phase2_first_login_date);
  const rejectedAt = program.rejectedAtPhase ?? program.rejected_at_phase;
  const worked = workedDatesFromAttendance(attendance);
  const ymDates = weekdaysInMonth(ym);

  if (outcome === "voluntary_leave") return false;
  if (outcome === "failed" && rejectedAt === 1) return false;
  if (outcome === "company_terminated" && rejectedAt != null && rejectedAt <= 2) return false;

  if (outcome === "failed" && rejectedAt === 2) {
    const ph2 = phases.find((p) => (p.phaseNumber ?? p.phase_number) === 2);
    if (!ph2) return false;
    const ws = ph2.weekStart || ph2.week_start;
    const we = ph2.weekEnd || ph2.week_end;
    return dateInRange(date, ws, we) && worked.has(date);
  }

  if (outcome === "company_terminated" && rejectedAt != null && rejectedAt >= 3) {
    const from = phase2Login || phases.find((p) => (p.phaseNumber ?? p.phase_number) === 2)?.weekStart;
    if (!from) return false;
    const lastWorked = [...worked].filter((d) => d.startsWith(ym)).sort().pop();
    const to = lastWorked || ymDates[ymDates.length - 1];
    return date >= from && date <= to && worked.has(date);
  }

  if (promotionDate && date >= promotionDate) return false;
  const ph = phaseForDate(phases, date);
  if (!ph) return false;
  const n = ph.phaseNumber ?? ph.phase_number;
  if (n === 1) {
    if (!options.trainingPhase1PayException) return false;
    if (rejectedAt && n > rejectedAt) return false;
    const st = ph.status;
    const strictPhasePay =
      programHasExceptionPass(program) ||
      outcome === "passed" ||
      outcome === "failed" ||
      outcome === "company_terminated" ||
      outcome === "voluntary_leave";
    if (strictPhasePay && !PAYABLE_PHASE_STATUSES.has(st)) return false;
    return countTrainingPayUnits((attendance || []).filter((r) => parseDate(r.date) === date)) > 0;
  }
  const st = ph.status;
  if (rejectedAt && n > rejectedAt) return false;

  const strictPhasePay =
    programHasExceptionPass(program) ||
    outcome === "passed" ||
    outcome === "failed" ||
    outcome === "company_terminated" ||
    outcome === "voluntary_leave";

  if (strictPhasePay) {
    return PAYABLE_PHASE_STATUSES.has(st);
  }

  // Active training — accrue phase 2+ days while weeks are in progress (pending ok).
  if (outcome === "active" && n >= 2) {
    return true;
  }

  return PAYABLE_PHASE_STATUSES.has(st);
}

/**
 * Payable training dates = attended (or lateness/half/paid leave) weekdays in eligible phases.
 */
function computeEligibleTrainingPayDates(program, attendance, ym, options = {}) {
  const out = new Set();
  for (const r of attendance || []) {
    const d = parseDate(r.date);
    if (!d || !d.startsWith(ym)) continue;
    if (countTrainingPayUnits([r]) <= 0) continue;
    if (isTrainingPayDate(program, d, attendance, ym, options)) out.add(d);
  }
  return out;
}

/** All payable training attendance dates across the program (any calendar month). */
function computeProgramTrainingPayDates(program, attendance, options = {}) {
  const out = new Set();
  for (const r of attendance || []) {
    const d = parseDate(r.date);
    if (!d || countTrainingPayUnits([r]) <= 0) continue;
    if (isTrainingPayDate(program, d, attendance, d.slice(0, 7), options)) out.add(d);
  }
  return out;
}

function computeProgramTrainingPayDatesBeforePromotion(program, attendance, options = {}) {
  const promo = parseDate(program.promotionEffectiveDate || program.promotion_effective_date);
  const dates = computeProgramTrainingPayDates(program, attendance, options);
  if (!promo) return dates;
  return new Set([...dates].filter((d) => d < promo));
}

/** Calendar months spanned by the training program (phase 1 start through promotion/end). */
function getProgramMonthSpan(program) {
  const phases = program.allPhases || program.phases || [];
  if (!phases.length) return [];
  const starts = phases
    .map((p) => parseDate(p.weekStart || p.week_start))
    .filter(Boolean)
    .sort();
  const ends = phases
    .map((p) => parseDate(p.weekEnd || p.week_end))
    .filter(Boolean)
    .sort();
  if (!starts.length) return [];
  let startYm = starts[0].slice(0, 7);
  const endDate =
    parseDate(program.promotionEffectiveDate || program.promotion_effective_date) ||
    parseDate(program.passedOnDate || program.passed_on_date) ||
    ends[ends.length - 1];
  if (!endDate) return [startYm];
  let endYm = endDate.slice(0, 7);
  const months = [];
  let cur = startYm;
  while (cur <= endYm) {
    months.push(cur);
    if (cur === endYm) break;
    cur = shiftMonth(cur, 1);
  }
  return months;
}

/**
 * Single accrual month for training payroll (one payslip even if training spans months).
 * Pay lands in the month training ends: phase 4 completion, promotion/pass date,
 * or termination after phase 3 (failed / voluntary / company).
 */
function trainingTerminationEndDate(program) {
  const phases = program?.allPhases || program?.phases || [];
  const outcome = program.outcome || "active";
  const rejectedAt = program.rejectedAtPhase ?? program.rejected_at_phase;

  if (outcome === "failed") {
    if (rejectedAt === 1) return null;
    const phaseNum = rejectedAt === 2 ? 2 : 3;
    const ph = phases.find((p) => (p.phaseNumber ?? p.phase_number) === phaseNum);
    return parseDate(ph?.weekEnd || ph?.week_end);
  }

  if (outcome === "voluntary_leave" || outcome === "company_terminated") {
    const phaseNum =
      rejectedAt != null && rejectedAt >= 2 ? Math.min(rejectedAt, 3) : 3;
    const ph = phases.find((p) => (p.phaseNumber ?? p.phase_number) === phaseNum);
    return parseDate(ph?.weekEnd || ph?.week_end);
  }

  return null;
}

function resolveTrainingPayrollAnchorMonth(program, attendance) {
  const promo = parseDate(program.promotionEffectiveDate || program.promotion_effective_date);
  const passed = parseDate(program.passedOnDate || program.passed_on_date);
  if (promo) return promo.slice(0, 7);
  if (passed) return passed.slice(0, 7);

  const outcome = program.outcome || "active";
  const phases = program.allPhases || program.phases || [];

  const terminationEnd = trainingTerminationEndDate(program);
  if (terminationEnd) return terminationEnd.slice(0, 7);

  if (outcome === "passed" || isProgramPhasesComplete(program)) {
    const ph4 = phases.find((p) => (p.phaseNumber ?? p.phase_number) === 4);
    const end = parseDate(ph4?.weekEnd || ph4?.week_end);
    if (end) return end.slice(0, 7);
  }

  // Active program — pay on phase 4 week end (not last backfilled attendance day).
  const ph4 = phases.find((p) => (p.phaseNumber ?? p.phase_number) === 4);
  const ph4End = parseDate(ph4?.weekEnd || ph4?.week_end);
  if (ph4End && outcome === "active") {
    return ph4End.slice(0, 7);
  }

  const dates = computeProgramTrainingPayDates(program, attendance);
  if (!dates.size) return null;
  return [...dates].sort().pop().slice(0, 7);
}

/** HR manual override on payroll adjustment, else computed anchor. */
function resolveTrainingAnchorMonth(program, attendance, ...adjustments) {
  for (const adj of adjustments) {
    if (!adj) continue;
    const manual = String(adj.trainingPayrollAnchorMonthOverride || "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(manual)) return manual;
  }
  return resolveTrainingPayrollAnchorMonth(program, attendance);
}

function computeAgentPayDates(program, ym) {
  const promotionDate = parseDate(program.promotionEffectiveDate || program.promotion_effective_date);
  if (!promotionDate) return new Set();
  if (!promotionDate.startsWith(ym)) return new Set();
  return new Set(weekdaysInMonth(ym).filter((d) => d >= promotionDate));
}

function hasDualPayrollInMonth(program, ym) {
  if (!program) return false;
  const outcome = program.outcome || "active";
  const promo = parseDate(program.promotionEffectiveDate || program.promotion_effective_date);
  if (!promo || !promo.startsWith(ym)) return false;
  return outcome === "passed" || outcome === "active";
}

function addDays(dateStr, days) {
  const { addCalendarDays } = require("./date-iso");
  const out = addCalendarDays(parseDate(dateStr) || dateStr, days);
  return out || null;
}

function isProgramPhasesComplete(program) {
  const phases = program?.allPhases || program?.phases || [];
  if (phases.length < 4) return false;
  return phases.every((p) => PAYABLE_PHASE_STATUSES.has(p.status));
}

function inferPromotionDateFromProgram(program) {
  const promo = parseDate(program?.promotionEffectiveDate || program?.promotion_effective_date);
  if (promo) return promo;
  const passed = parseDate(program?.passedOnDate || program?.passed_on_date);
  if (passed) return passed;
  const phases = program?.allPhases || program?.phases || [];
  const ends = phases
    .map((p) => parseDate(p.weekEnd || p.week_end))
    .filter(Boolean)
    .sort();
  const lastEnd = ends[ends.length - 1];
  if (!lastEnd) return null;
  return addDays(lastEnd, 3);
}

function isGraduatedFromTraining(emp, program) {
  if (emp?.training_passed === true) return true;
  if (!program) return false;
  const outcome = program.outcome || "active";
  return outcome === "passed";
}

function trainingPayPreview(program, attendance, ym, traineeDailyRate) {
  const dailyRate = traineeDailyRate ?? TRAINING_DAILY_RATE;
  const trainingDays = computeEligibleTrainingPayDates(program, attendance, ym);
  const agentDays = computeAgentPayDates(program, ym);
  const payRecords = (attendance || []).filter((r) => {
    const d = parseDate(r.date);
    return d && trainingDays.has(d);
  });
  const trainingPayUnits = countTrainingPayUnits(payRecords);
  const trainingBasic = Math.round(trainingPayUnits * dailyRate * 100) / 100;
  return {
    trainingDayCount: trainingPayUnits,
    trainingPayDates: trainingDays.size,
    trainingPayUnits,
    agentDayCount: agentDays.size,
    trainingDays: [...trainingDays].sort(),
    agentDays: [...agentDays].sort(),
    estimatedTrainingBasic: trainingBasic,
    dualPayroll: hasDualPayrollInMonth(program, ym),
  };
}

module.exports = {
  PROGRAM_OUTCOMES,
  PHASE_EXIT_REASONS,
  MIN_SALES_PER_PHASE,
  MIN_SALES_PROGRAM,
  COMMISSION_SALES_THRESHOLD,
  TRAINING_MONTHLY_SALARY,
  TRAINING_DAYS_PER_MONTH,
  TRAINING_DAILY_RATE,
  TRAINING_WEEKLY_SALARY,
  PAYABLE_PHASE_STATUSES,
  datesInMonth,
  weekdaysInMonth,
  phaseForDate,
  evaluateProgramSales,
  validatePhaseSales,
  isTrainingPayDate,
  computeEligibleTrainingPayDates,
  computeProgramTrainingPayDates,
  computeProgramTrainingPayDatesBeforePromotion,
  getProgramMonthSpan,
  resolveTrainingPayrollAnchorMonth,
  resolveTrainingAnchorMonth,
  trainingTerminationEndDate,
  computeAgentPayDates,
  hasDualPayrollInMonth,
  trainingPayPreview,
  workedDatesFromAttendance,
  countTrainingPayUnits,
  trainingPayUnitForRecord,
  filterEligibleToPaidAttendance,
  isProgramPhasesComplete,
  inferPromotionDateFromProgram,
  isGraduatedFromTraining,
  addDays,
  programHasExceptionPass,
  isTrainingTransportDate,
};

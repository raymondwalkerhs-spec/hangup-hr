function parseIsoDate(value) {
  if (!value) return null;
  const s = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T12:00:00");
  return Number.isNaN(d.getTime()) ? null : s;
}

function monthInRange(ym, startDate, endDate) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return false;
  const monthStart = `${ym}-01`;
  const [y, m] = ym.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const monthEnd = `${ym}-${String(lastDay).padStart(2, "0")}`;
  if (startDate && monthEnd < startDate) return false;
  if (endDate && monthStart > endDate) return false;
  return true;
}

function dateInActivePeriod(date, periods) {
  const d = parseIsoDate(date);
  if (!d || !periods?.length) return true;
  return periods.some((p) => {
    const start = parseIsoDate(p.startDate || p.start_date);
    const end = parseIsoDate(p.endDate || p.end_date);
    if (!start) return false;
    if (d < start) return false;
    if (end && d > end) return false;
    return true;
  });
}

function isMonthEmployed(employeeId, yearMonth, periodsByEmployee) {
  const periods = periodsByEmployee?.[employeeId] || periodsByEmployee || [];
  if (!Array.isArray(periods)) return true;
  return periods.some((p) =>
    monthInRange(yearMonth, parseIsoDate(p.startDate || p.start_date), parseIsoDate(p.endDate || p.end_date))
  );
}

function getCurrentPeriod(periods) {
  if (!periods?.length) return null;
  return periods.find((p) => p.isCurrent || p.is_current) || periods[periods.length - 1];
}

function mondayOfWeek(dateStr) {
  return require("./date-iso").mondayOfWeek(dateStr) || null;
}

function fridayOfWeek(mondayStr) {
  return require("./date-iso").fridayOfWeek(mondayStr) || null;
}

function dateInRange(dateStr, startStr, endStr) {
  const d = parseIsoDate(dateStr);
  const a = parseIsoDate(startStr);
  const b = parseIsoDate(endStr);
  if (!d || !a || !b) return false;
  return d >= a && d <= b;
}

/**
 * Widest editable span from employment_periods + employee hire/depart fields.
 * Open current period (no end_date) removes the end cap so HR can fix attendance
 * before depart is finalized. Period end dates win over an early stale depart_date.
 */
function computeEditableEmploymentSpan(employee, periods = []) {
  const { parseIsoDate: parseDay } = require("./date-iso");
  const { effectiveDepartDate } = require("./depart-attendance");
  const { isOutStatus } = require("./employee-status");
  let start = parseDay(employee?.employment_date);
  let end = parseDay(effectiveDepartDate(employee));
  let hasOpenPeriod = false;
  const active = !isOutStatus(employee?.status);

  for (const p of periods || []) {
    const ps = parseDay(p.startDate || p.start_date);
    const pe = parseDay(p.endDate || p.end_date);
    const current = p.isCurrent === true || p.is_current === true;
    if (ps && (!start || ps < start)) start = ps;
    if (current && !pe) hasOpenPeriod = true;
    if (!active && pe && (!end || pe > end)) end = pe;
  }
  if (hasOpenPeriod || active) end = "";
  return { start, end, hasOpenPeriod: hasOpenPeriod || active };
}

function dateWithinEmploymentSpan(date, span) {
  const { parseIsoDate: parseDay } = require("./date-iso");
  const d = parseDay(date);
  if (!d) return false;
  if (span?.start && d < span.start) return false;
  if (span?.end && d > span.end) return false;
  return true;
}

module.exports = {
  parseIsoDate,
  monthInRange,
  dateInActivePeriod,
  isMonthEmployed,
  getCurrentPeriod,
  mondayOfWeek,
  fridayOfWeek,
  dateInRange,
  computeEditableEmploymentSpan,
  dateWithinEmploymentSpan,
};

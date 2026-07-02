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
  const d = parseIsoDate(dateStr);
  if (!d) return null;
  const dt = new Date(d + "T12:00:00");
  const day = dt.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diff);
  return dt.toISOString().slice(0, 10);
}

function fridayOfWeek(mondayStr) {
  const d = parseIsoDate(mondayStr);
  if (!d) return null;
  const dt = new Date(d + "T12:00:00");
  dt.setDate(dt.getDate() + 4);
  return dt.toISOString().slice(0, 10);
}

function dateInRange(dateStr, startStr, endStr) {
  const d = parseIsoDate(dateStr);
  const a = parseIsoDate(startStr);
  const b = parseIsoDate(endStr);
  if (!d || !a || !b) return false;
  return d >= a && d <= b;
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
};

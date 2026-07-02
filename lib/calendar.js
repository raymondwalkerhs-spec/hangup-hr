function parseYearMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return { year: y, month: m };
}

function formatYearMonth(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function getDaysInMonth(year, month) {
  const days = [];
  let d = 1;
  while (true) {
    const dt = new Date(year, month - 1, d);
    if (dt.getMonth() !== month - 1) break;
    days.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    d++;
  }
  return days;
}

function isWeekend(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

function countWeekdaysInMonth(year, month) {
  return getDaysInMonth(year, month).filter((d) => !isWeekend(d)).length;
}

function shiftMonth(ym, delta) {
  const { year, month } = parseYearMonth(ym);
  const d = new Date(year, month - 1 + delta, 1);
  return formatYearMonth(d.getFullYear(), d.getMonth() + 1);
}

function monthLabel(ym) {
  const { year, month } = parseYearMonth(ym);
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function dayLabel(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", day: "numeric" });
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getMonthCalendar(yearMonth) {
  const { year, month } = parseYearMonth(yearMonth);
  return getDaysInMonth(year, month).map((date) => {
    const d = new Date(date + "T12:00:00");
    const dow = d.getDay();
    return {
      date,
      weekdayName: WEEKDAY_NAMES[dow],
      dayOfMonth: d.getDate(),
      isWeekend: isWeekend(date),
      isWorkingDay: !isWeekend(date),
    };
  });
}

function autoWorkingDays(yearMonth) {
  const { year, month } = parseYearMonth(yearMonth);
  return countWeekdaysInMonth(year, month);
}

function ensureMonthWorkingDays(config, yearMonth) {
  if (config.workingDaysByMonth?.[yearMonth] != null) {
    return config.workingDaysByMonth[yearMonth];
  }
  return autoWorkingDays(yearMonth);
}

module.exports = {
  parseYearMonth,
  formatYearMonth,
  getDaysInMonth,
  isWeekend,
  countWeekdaysInMonth,
  shiftMonth,
  monthLabel,
  dayLabel,
  getMonthCalendar,
  autoWorkingDays,
  ensureMonthWorkingDays,
  WEEKDAY_NAMES,
};

const { isWeekend } = require("./calendar");
const { lookupSalary } = require("./month-profile");

const NO_NOTICE_DAYS = 10;
const DEDUCTION_TYPE = "Other Deductions";

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function collectWorkingDaysBefore(departDate, count) {
  const days = [];
  const d = new Date(String(departDate).slice(0, 10) + "T12:00:00");
  d.setDate(d.getDate() - 1);
  while (days.length < count) {
    const iso = formatDate(d);
    if (!isWeekend(iso)) days.unshift(iso);
    d.setDate(d.getDate() - 1);
    if (days.length === 0 && d.getFullYear() < 2000) break;
  }
  return days;
}

function groupDaysByMonth(days) {
  const map = new Map();
  for (const date of days) {
    const ym = date.slice(0, 7);
    if (!map.has(ym)) map.set(ym, []);
    map.get(ym).push(date);
  }
  return map;
}

async function dailyRateForMonth(store, emp, yearMonth) {
  const config = store.getConfig();
  const rates = store.getPositionRates();
  const workingDays = await store.getWorkingDaysForMonth(yearMonth);
  const monthlyBasic = lookupSalary(emp.position, rates);
  if (!workingDays || !monthlyBasic) return { dailyRate: 0, workingDays, monthlyBasic };
  return { dailyRate: monthlyBasic / workingDays, workingDays, monthlyBasic };
}

/**
 * Create no-notice departure deductions: 10 working days before depart,
 * daily rate = monthly basic / month working days, split across months.
 */
async function createNoNoticeDeductions(emp, departDate, store, username) {
  if (!emp?.id || !departDate) throw new Error("Employee and depart date required");

  const workDays = collectWorkingDaysBefore(departDate, NO_NOTICE_DAYS);
  if (workDays.length < NO_NOTICE_DAYS) {
    throw new Error(`Could not resolve ${NO_NOTICE_DAYS} working days before depart date`);
  }

  const byMonth = groupDaysByMonth(workDays);
  const created = [];

  for (const [yearMonth, dates] of byMonth) {
    const { dailyRate, workingDays, monthlyBasic } = await dailyRateForMonth(store, emp, yearMonth);
    if (!dailyRate) {
      throw new Error(`No salary rate for position "${emp.position || ""}" (${yearMonth})`);
    }
    const amount = Math.round(dailyRate * dates.length * 100) / 100;
    const record = {
      employeeId: emp.id,
      date: dates[dates.length - 1],
      amount,
      type: DEDUCTION_TYPE,
      reason: `No-notice departure: ${dates.length} working day(s) @ ${Math.round(dailyRate * 100) / 100} EGP (${yearMonth}, ${workingDays} wd/mo, basic ${monthlyBasic})`,
      unit: emp.unit || "",
    };
    await store.upsertDeduction(record, username);
    created.push(record);
  }

  return created;
}

module.exports = {
  NO_NOTICE_DAYS,
  DEDUCTION_TYPE,
  collectWorkingDaysBefore,
  createNoNoticeDeductions,
};

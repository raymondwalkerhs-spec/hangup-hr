const { isWeekend } = require("./calendar");
const { lookupSalary } = require("./month-profile");

const NO_NOTICE_DAYS = 10;
const DEDUCTION_TYPE = "No-Notice Departure Penalty";
const TRANSPORT_DEDUCTION_TYPE = "No-Notice Transport Penalty";

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
  const rates = store.getPositionRates(yearMonth);
  const workingDays = await store.getWorkingDaysForMonth(yearMonth);
  const adjustment = store.getPayrollAdjustment(yearMonth, emp.id);
  const monthlyBasic =
    lookupSalary(emp.position, rates) + (Number(adjustment?.salaryRaise) || 0);
  if (!workingDays || !monthlyBasic) {
    return { dailyRate: 0, transportDailyRate: 0, workingDays, monthlyBasic, transportEligible: false };
  }
  const transportEligible = adjustment?.transportEligible !== false;
  const monthlyBudget = Number(config.transportAllowanceMonthly) || 3000;
  const transportDailyRate =
    transportEligible && workingDays > 0
      ? Math.round((monthlyBudget / workingDays) * 100) / 100
      : 0;
  return {
    dailyRate: monthlyBasic / workingDays,
    transportDailyRate,
    workingDays,
    monthlyBasic,
    transportEligible,
  };
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
    const { dailyRate, transportDailyRate, workingDays, monthlyBasic, transportEligible } =
      await dailyRateForMonth(store, emp, yearMonth);
    if (!dailyRate) {
      throw new Error(`No salary rate for position "${emp.position || ""}" (${yearMonth})`);
    }
    const basicAmount = Math.round(dailyRate * dates.length * 100) / 100;
    const basicRecord = {
      employeeId: emp.id,
      date: dates[dates.length - 1],
      amount: basicAmount,
      type: DEDUCTION_TYPE,
      penaltyKind: "basic",
      reason: `No-notice departure: ${dates.length} working day(s) basic @ ${Math.round(dailyRate * 100) / 100} EGP (${yearMonth}, ${workingDays} wd/mo, basic ${monthlyBasic})`,
      unit: emp.unit || "",
    };
    await store.upsertDeduction(basicRecord, username);
    created.push(basicRecord);

    if (transportEligible && transportDailyRate > 0) {
      const transportAmount = Math.round(transportDailyRate * dates.length * 100) / 100;
      const transportRecord = {
        employeeId: emp.id,
        date: dates[dates.length - 1],
        amount: transportAmount,
        type: TRANSPORT_DEDUCTION_TYPE,
        penaltyKind: "transport",
        reason: `No-notice departure: ${dates.length} working day(s) transport @ ${transportDailyRate} EGP (${yearMonth})`,
        unit: emp.unit || "",
      };
      await store.upsertDeduction(transportRecord, username);
      created.push(transportRecord);
    }
  }

  return created;
}

module.exports = {
  NO_NOTICE_DAYS,
  DEDUCTION_TYPE,
  TRANSPORT_DEDUCTION_TYPE,
  collectWorkingDaysBefore,
  createNoNoticeDeductions,
  dailyRateForMonth,
};

/**
 * Resignation notice-period pay scale and no-notice deductions.
 */
const { lookupSalary } = require("./month-profile");
const { createNoNoticeDeductions, NO_NOTICE_DAYS } = require("./departure-deductions");

const NOTICE_PAY_SCALE = [
  { minSales: 10, payPercent: 100 },
  { minSales: 9, payPercent: 90 },
  { minSales: 8, payPercent: 80 },
  { minSales: 7, payPercent: 70 },
  { minSales: 6, payPercent: 60 },
  { minSales: 5, payPercent: 50 },
];

function noticePayPercent(passedSalesInNotice) {
  const n = Number(passedSalesInNotice) || 0;
  if (n < 5) return 0;
  for (const tier of NOTICE_PAY_SCALE) {
    if (n >= tier.minSales) return tier.payPercent;
  }
  return 0;
}

function calcNoticePeriodBasicScale({ basicSalary, passedSalesInNotice }) {
  const pct = noticePayPercent(passedSalesInNotice);
  const scaled = Math.round(basicSalary * (pct / 100) * 100) / 100;
  return {
    payPercent: pct,
    scaledBasic: scaled,
    cancelled: pct === 0,
    passedSalesInNotice: Number(passedSalesInNotice) || 0,
  };
}

async function applyNoNoticeDeduction(emp, departDate, store, username) {
  return createNoNoticeDeductions(emp, departDate, store, username);
}

async function applyNoticePeriodPayAdjustment(emp, yearMonth, { passedSalesInNotice, store, username }) {
  const adjustment = store.getPayrollAdjustment(yearMonth, emp.id) || { employeeId: emp.id };
  const rates = store.getPositionRates(yearMonth);
  const config = store.getConfig();
  const workingDays = await store.getWorkingDaysForMonth(yearMonth);
  const monthlyBasic = lookupSalary(emp.position, rates);
  const dailyRate = workingDays > 0 ? monthlyBasic / workingDays : 0;
  const records = store.getAttendanceEvents(yearMonth).filter((r) => r.employeeId === emp.id);
  const { summarizeEmployeeMonth } = require("./attendance");
  const summary = summarizeEmployeeMonth(emp, records, config);
  const fullBasic =
    (summary.workingDays -
      summary.halfDays * 0.5 -
      summary.quarterOff * 0.25 -
      summary.nsnc * 2 -
      (summary.nsncHalf || 0) * 1.5) *
    dailyRate;
  const scale = calcNoticePeriodBasicScale({ basicSalary: fullBasic, passedSalesInNotice });
  const note = scale.cancelled
    ? `Notice period: ${scale.passedSalesInNotice} passed sales (<5) — notice-period salary cancelled`
    : `Notice period: ${scale.passedSalesInNotice} passed sales — ${scale.payPercent}% basic (${scale.scaledBasic} EGP)`;

  await store.upsertPayrollAdjustment(
    {
      ...adjustment,
      employeeId: emp.id,
      yearMonth,
      monthNotes: [adjustment.monthNotes, note].filter(Boolean).join("\n"),
      noticePayPercent: scale.payPercent,
      noticePayScaledBasic: scale.scaledBasic,
    },
    username
  );
  return scale;
}

module.exports = {
  NOTICE_PAY_SCALE,
  NO_NOTICE_DAYS,
  noticePayPercent,
  calcNoticePeriodBasicScale,
  applyNoNoticeDeduction,
  applyNoticePeriodPayAdjustment,
};

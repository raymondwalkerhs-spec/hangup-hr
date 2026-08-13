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

function addDays(dateStr, days) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function countPassedSalesInNoticeWindow(emp, departDate, store) {
  const depart = String(departDate || emp?.depart_date || "").slice(0, 10);
  if (!depart || !emp?.id) return 0;
  const noticeStart = addDays(depart, -13);
  if (!noticeStart) return 0;

  let sales = [];
  try {
    const business = require("./business-repo");
    sales = await business.readSales({ employeeId: emp.id }, { skipCache: true });
  } catch {
    return 0;
  }

  return (sales || []).filter((s) => {
    const d = String(s.date || s.saleDate || s.sale_date || "").slice(0, 10);
    if (!d || d < noticeStart || d > depart) return false;
    const st = String(s.status || "").toLowerCase();
    return st === "passed" || st === "postdated";
  }).length;
}

async function applyNoNoticeDeduction(emp, departDate, store, username) {
  return createNoNoticeDeductions(emp, departDate, store, username);
}

async function applyNoticePeriodPayAdjustment(emp, yearMonth, { passedSalesInNotice, store, username }) {
  const adjustment = store.getPayrollAdjustment(yearMonth, emp.id) || { employeeId: emp.id };
  const rates = store.getPositionRates(yearMonth);
  const config = store.getConfig();
  const workingDays = await store.getWorkingDaysForMonth(yearMonth);
  const monthlyBasic =
    lookupSalary(emp.position, rates) + (Number(adjustment.salaryRaise) || 0);
  const dailyRate = workingDays > 0 ? monthlyBasic / workingDays : 0;
  const depart = String(emp.depart_date || "").slice(0, 10);
  let records = store.getAttendanceEvents(yearMonth).filter((r) => r.employeeId === emp.id);
  if (depart && depart.startsWith(yearMonth)) {
    records = records.filter((r) => String(r.date).slice(0, 10) <= depart);
  }
  const { summarizeEmployeeMonth, countUnpaidFractionDeductions } = require("./attendance");
  const summary = summarizeEmployeeMonth(emp, records, config);
  const { unpaidHalfDays, unpaidQuarterOff } = countUnpaidFractionDeductions(records);
  const fullBasic =
    (summary.workingDays -
      unpaidHalfDays * 0.5 -
      unpaidQuarterOff * 0.25 -
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
  countPassedSalesInNoticeWindow,
};

const { countWeekdaysInMonth, getDaysInMonth, isWeekend, parseYearMonth } = require("./calendar");

const PAYROLL_ACTIVE_STATUSES = new Set([
  "Active",
  "OUT BUT STILL GET PAID",
  "Paused",
  "Paused still get paid",
]);

const ATTENDANCE_STATUSES = [
  "Attended",
  "Day-OFF",
  "Half Day",
  "Quarter Day-Off",
  "WFH",
  "Lateness A",
  "Lateness B",
  "NSNC",
  "NSNC Half Day",
  "Not Approved day off",
  "paused",
  "OUT",
];

function employeeDisplayName(emp) {
  return (emp.american_name && emp.american_name.trim()) ||
    (emp.arabic_name && emp.arabic_name.trim()) ||
    emp.id;
}

function isPayrollEligible(emp) {
  if (!emp.id) return false;
  return PAYROLL_ACTIVE_STATUSES.has(emp.status);
}

function countStatus(records, status) {
  return records.filter((r) => r.status === status).length;
}

function countLateness(records) {
  return records.filter((r) => r.status === "Lateness A" || r.status === "Lateness B").length;
}

function calcLatenessDeduction(records, config, actionPlans = []) {
  if (actionPlans?.length) {
    return require("./action-plans").calcLatenessWithAip(records, config, actionPlans);
  }
  const a = countStatus(records, "Lateness A");
  const b = countStatus(records, "Lateness B");
  const amount = a * config.latenessRules.tierA.amount + b * config.latenessRules.tierB.amount;
  return { amount, detail: `${a} Lateness before 3:00PM\n${b} Lateness After 3:00PM`, aipNotes: [] };
}

function summarizeEmployeeMonth(emp, records, config, actionPlans = []) {
  const attended = countStatus(records, "Attended");
  const paidLeaveDays = records.filter((r) => r.status === "Day-OFF" && r.paidLeave).length;
  const halfDays = countStatus(records, "Half Day");
  const quarterOff = countStatus(records, "Quarter Day-Off");
  const lateness = countLateness(records);
  const { amount, detail, aipNotes = [] } = calcLatenessDeduction(records, config, actionPlans);

  return {
    employeeId: emp.id,
    name: employeeDisplayName(emp),
    unit: emp.unit,
    email: emp.email,
    workingDays: attended + paidLeaveDays + halfDays + quarterOff + lateness,
    paidLeaveDays,
    daysOff: countStatus(records, "Day-OFF"),
    halfDays,
    quarterOff,
    wfh: countStatus(records, "WFH"),
    lateness,
    nsnc: countStatus(records, "NSNC") + countStatus(records, "Not Approved day off"),
    nsncHalf: countStatus(records, "NSNC Half Day"),
    paused: countStatus(records, "paused"),
    extraDays: 0,
    latenessDeductions: amount,
    latenessDetail: detail,
    aipNotes,
  };
}

function recordsToMap(records) {
  const map = new Map();
  for (const r of records) map.set(`${r.employeeId}|${r.date}`, r);
  return map;
}

function getWorkingDaysForMonth(ym, config) {
  if (config.workingDaysByMonth?.[ym] != null) return config.workingDaysByMonth[ym];
  const { year, month } = parseYearMonth(ym);
  return countWeekdaysInMonth(year, month);
}

function buildMonthSkeleton(employees, ym, existing = []) {
  const { year, month } = parseYearMonth(ym);
  const days = getDaysInMonth(year, month);
  const existingMap = recordsToMap(existing);
  const result = [];

  for (const emp of employees) {
    if (!emp.american_name && !emp.arabic_name && !isPayrollEligible(emp)) continue;
    for (const date of days) {
      const key = `${emp.id}|${date}`;
      const prev = existingMap.get(key);
      if (prev) {
        result.push(prev);
        continue;
      }
      if (isWeekend(date)) {
        result.push({
          employeeId: emp.id,
          date,
          status: "Day-OFF",
          fpLateness: null,
          isWeekendDefault: true,
          unit: emp.unit,
          name: employeeDisplayName(emp),
          email: emp.email,
        });
      }
    }
  }

  for (const r of existing) {
    const key = `${r.employeeId}|${r.date}`;
    if (!result.some((x) => `${x.employeeId}|${x.date}` === key)) result.push(r);
  }
  return result;
}

function upsertRecord(records, update) {
  const key = `${update.employeeId}|${update.date}`;
  const idx = records.findIndex((r) => `${r.employeeId}|${r.date}` === key);
  const record = {
    ...update,
    isWeekendDefault: isWeekend(update.date) && update.status === "Day-OFF",
  };
  if (idx >= 0) {
    const next = [...records];
    next[idx] = { ...next[idx], ...record };
    return next;
  }
  return [...records, record];
}

module.exports = {
  ATTENDANCE_STATUSES,
  PAYROLL_ACTIVE_STATUSES,
  employeeDisplayName,
  isPayrollEligible,
  summarizeEmployeeMonth,
  buildMonthSkeleton,
  upsertRecord,
  getWorkingDaysForMonth,
};

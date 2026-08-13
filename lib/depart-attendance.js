const { isOutStatus } = require("./employee-status");
const { parseIsoDate, isAfterIsoDate } = require("./date-iso");
const { computeEditableEmploymentSpan } = require("./employment-periods");

const WORKING_STATUSES = new Set([
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
]);

function effectiveDepartDate(emp) {
  if (!emp) return "";
  // depart_date only applies once HR has marked the employee Out.
  // Active/Paused agents may still carry a stale depart from a mistaken OUT cell or partial depart flow.
  if (!isOutStatus(emp.status)) return "";
  return parseIsoDate(emp?.depart_date) || "";
}

function normalizeEmployeeDepart(emp) {
  if (!emp) return emp;
  const effective = effectiveDepartDate(emp);
  const raw = parseIsoDate(emp.depart_date);
  if (!effective && raw) return { ...emp, depart_date: null };
  return emp;
}

function departDateStr(emp) {
  return effectiveDepartDate(emp);
}

function isAfterDepartDate(emp, date) {
  const depart = departDateStr(emp);
  if (!depart) return false;
  return isAfterIsoDate(date, depart);
}

function isDepartDay(emp, date) {
  const depart = departDateStr(emp);
  const d = parseIsoDate(date);
  return Boolean(depart && d === depart);
}

function departLockEnd(emp, periods) {
  const depart = departDateStr(emp);
  if (!periods?.length) return depart;
  const span = computeEditableEmploymentSpan(emp, periods);
  if (span.hasOpenPeriod) return "";
  if (span.end && (!depart || span.end > depart)) return span.end;
  return depart;
}

/** Post-depart lock for grid/API — only applies once HR has marked the employee Out. */
function attendanceLockEnd(emp, periods) {
  if (!emp || !isOutStatus(emp.status)) return "";
  return departLockEnd(emp, periods);
}

function isLockedDepartDay(emp, date, periods) {
  if (!isOutStatus(emp?.status)) return false;
  const end = attendanceLockEnd(emp, periods);
  if (!end) return false;
  return isAfterIsoDate(date, end);
}

function employeeWorkedInMonth(emp, records, yearMonth) {
  if (!emp?.id || !yearMonth) return false;
  const ym = String(yearMonth).slice(0, 7);
  const monthRecords = (records || []).filter(
    (r) => r.employeeId === emp.id && String(r.date).slice(0, 7) === ym
  );
  for (const r of monthRecords) {
    if (r.status === "OUT") continue;
    if (WORKING_STATUSES.has(r.status)) return true;
  }
  const depart = departDateStr(emp);
  if (depart && depart.slice(0, 7) === ym) {
    const departDay = monthRecords.find((r) => String(r.date).slice(0, 10) === depart);
    if (departDay && departDay.status !== "OUT") return true;
    if (!departDay && depart <= `${ym}-31`) return true;
  }
  return false;
}

function applyDepartAutoOut(emp, records, yearMonth) {
  const depart = departDateStr(emp);
  if (!depart || String(depart).slice(0, 7) !== String(yearMonth).slice(0, 7)) {
    return records;
  }
  const ym = String(yearMonth).slice(0, 7);
  const byKey = new Map(records.map((r) => [`${r.employeeId}|${r.date}`, { ...r }]));
  const daysInMonth = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
  for (let d = 1; d <= daysInMonth; d += 1) {
    const date = `${ym}-${String(d).padStart(2, "0")}`;
    if (!isAfterDepartDate(emp, date)) continue;
    const key = `${emp.id}|${date}`;
    const prev = byKey.get(key) || { employeeId: emp.id, date, status: "" };
    byKey.set(key, {
      ...prev,
      employeeId: emp.id,
      date,
      status: "OUT",
      autoDepartOut: true,
    });
  }
  return [...byKey.values()];
}

function applyDepartAutoOutForMonth(employees, records, yearMonth) {
  let result = [...records];
  for (const emp of employees) {
    if (!departDateStr(emp)) continue;
    result = applyDepartAutoOut(emp, result, yearMonth);
  }
  return result;
}

function buildAutoOutRecordsAfterDepart(employeeId, departDate, monthsAhead = 24) {
  const depart = String(departDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(depart) || !employeeId) return [];

  const records = [];
  let year = Number(depart.slice(0, 4));
  let month = Number(depart.slice(5, 7));

  for (let i = 0; i <= monthsAhead; i += 1) {
    const ym = `${year}-${String(month).padStart(2, "0")}`;
    const daysInMonth = new Date(year, month, 0).getDate();
    const startDay = ym === depart.slice(0, 7) ? Number(depart.slice(8, 10)) + 1 : 1;
    for (let d = startDay; d <= daysInMonth; d += 1) {
      const date = `${ym}-${String(d).padStart(2, "0")}`;
      records.push({
        employeeId,
        date,
        status: "OUT",
        autoDepartOut: true,
      });
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return records;
}

function shouldShowInMonth(emp, yearMonth, records, { hideOut = true, showLegacyEmployees = false } = {}) {
  const { shouldShowEmployeeInMonth } = require("./employee-visibility");
  return shouldShowEmployeeInMonth(emp, yearMonth, records, { hideOut, showLegacyEmployees });
}

module.exports = {
  WORKING_STATUSES,
  effectiveDepartDate,
  normalizeEmployeeDepart,
  departDateStr,
  isAfterDepartDate,
  isDepartDay,
  departLockEnd,
  attendanceLockEnd,
  isLockedDepartDay,
  employeeWorkedInMonth,
  applyDepartAutoOut,
  applyDepartAutoOutForMonth,
  buildAutoOutRecordsAfterDepart,
  shouldShowInMonth,
};

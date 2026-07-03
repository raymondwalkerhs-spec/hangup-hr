const { isOutStatus } = require("./employee-status");

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

function departDateStr(emp) {
  return String(emp?.depart_date || "").slice(0, 10);
}

function isAfterDepartDate(emp, date) {
  const depart = departDateStr(emp);
  if (!depart) return false;
  return String(date).slice(0, 10) > depart;
}

function isDepartDay(emp, date) {
  const depart = departDateStr(emp);
  return depart && String(date).slice(0, 10) === depart;
}

function isLockedDepartDay(emp, date) {
  return isAfterDepartDate(emp, date);
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

function shouldShowInMonth(emp, yearMonth, records, { hideOut = true } = {}) {
  if (!emp?.id) return false;
  if (!hideOut) return true;
  if (!isOutStatus(emp.status)) return true;
  return employeeWorkedInMonth(emp, records, yearMonth);
}

module.exports = {
  WORKING_STATUSES,
  departDateStr,
  isAfterDepartDate,
  isDepartDay,
  isLockedDepartDay,
  employeeWorkedInMonth,
  applyDepartAutoOut,
  applyDepartAutoOutForMonth,
  shouldShowInMonth,
};

/**
 * Team × date sales grid for day / week / month views.
 */
const salesScope = require("./sales-scope");
const { datesInRange } = require("./leave-attendance");
const { employeeDisplayName } = require("./attendance");
const { shiftMonth } = require("./calendar");

function buildPeriodBounds(period, date) {
  const d = date || new Date().toISOString().slice(0, 10);
  let from = d;
  let to = d;
  if (period === "week") {
    const dt = new Date(`${d}T12:00:00`);
    const day = dt.getDay();
    const monday = new Date(dt);
    monday.setDate(dt.getDate() - ((day + 6) % 7));
    from = monday.toISOString().slice(0, 10);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    to = sunday.toISOString().slice(0, 10);
  } else if (period === "month") {
    const ym = d.slice(0, 7);
    from = `${ym}-01`;
    const [y, m] = ym.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    to = `${ym}-${String(last).padStart(2, "0")}`;
  }
  return { from, to, dates: datesInRange(from, to) };
}

function resolveBounds({ period, date, from, to }) {
  if (from && to) {
    return { from, to, dates: datesInRange(from, to) };
  }
  return buildPeriodBounds(period || "day", date);
}

function saleInDateRange(sale, from, to) {
  const eff = sale.effectiveDate || "";
  const sub = sale.submissionDate || "";
  const inEff = eff >= from && eff <= to;
  const inSub = sub >= from && sub <= to;
  return inEff || inSub;
}

function saleCountsOnDate(sale, date) {
  const { counted } = salesScope.countSaleForDashboard(sale, date);
  if (!counted) return false;
  if (sale.status === "postdated") return sale.effectiveDate === date;
  if (sale.status === "passed") {
    const countDate = sale.effectiveDate || sale.submissionDate;
    return countDate === date;
  }
  return false;
}

function collectTeams(employees, sales) {
  const teamSet = new Set();
  for (const e of employees) {
    if (e.team) teamSet.add(e.team);
  }
  for (const s of sales) {
    teamSet.add(s.team || "—");
  }
  return [...teamSet].sort();
}

function buildAgentsOff(attendanceRecords, employees, dates) {
  const empById = new Map(employees.map((e) => [e.id, e]));
  const dateSet = new Set(dates);
  const agentsOff = {};
  const seen = new Map();

  for (const rec of attendanceRecords) {
    if (rec.status !== "Day-OFF") continue;
    if (!dateSet.has(rec.date)) continue;
    if (!seen.has(rec.date)) seen.set(rec.date, new Set());
    const daySeen = seen.get(rec.date);
    if (daySeen.has(rec.employeeId)) continue;
    daySeen.add(rec.employeeId);
    const emp = empById.get(rec.employeeId);
    const name = emp ? employeeDisplayName(emp) : rec.employeeId;
    if (!agentsOff[rec.date]) agentsOff[rec.date] = [];
    agentsOff[rec.date].push({ employeeId: rec.employeeId, name });
  }

  for (const d of dates) {
    if (!agentsOff[d]) agentsOff[d] = [];
    else agentsOff[d].sort((a, b) => a.name.localeCompare(b.name));
  }
  return agentsOff;
}

function buildPeriodGrid({ sales, employees, attendanceRecords, period, date, from, to }) {
  const bounds = resolveBounds({ period, date, from, to });
  const { from: rangeFrom, to: rangeTo, dates } = bounds;
  const inRange = sales.filter((s) => saleInDateRange(s, rangeFrom, rangeTo));
  const teams = collectTeams(employees, inRange);

  const matrix = {};
  for (const team of teams) {
    matrix[team] = {};
    for (const d of dates) matrix[team][d] = 0;
  }

  for (const sale of inRange) {
    const team = sale.team || "—";
    if (!matrix[team]) {
      matrix[team] = {};
      for (const d of dates) matrix[team][d] = 0;
    }
    for (const d of dates) {
      if (saleCountsOnDate(sale, d)) matrix[team][d] += 1;
    }
  }

  const agentsOff = buildAgentsOff(attendanceRecords || [], employees, dates);

  return {
    period: period || "day",
    from: rangeFrom,
    to: rangeTo,
    teams,
    dates,
    matrix,
    agentsOff,
  };
}

function attendanceMonthsInRange(from, to) {
  const months = [];
  let ym = from.slice(0, 7);
  const endYm = to.slice(0, 7);
  while (ym <= endYm) {
    months.push(ym);
    ym = shiftMonth(ym, 1);
  }
  return months;
}

function filterAttendanceForRange(records, from, to) {
  return records.filter((r) => r.date >= from && r.date <= to);
}

module.exports = {
  buildPeriodBounds,
  buildPeriodGrid,
  attendanceMonthsInRange,
  filterAttendanceForRange,
};

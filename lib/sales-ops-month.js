/**
 * Role-scoped monthly sales trend + attendance counts for the Dashboard.
 */
const salesScope = require("./sales-scope");
const periodGrid = require("./sales-period-grid");
const roles = require("./roles");
const { datesInRange } = require("./leave-attendance");

const COMPANY_OPS_ROLES = ["quality", "rtm", "hr", "admin", "ceo", "finance"];

const ATTENDANCE_GROUPS = {
  dayOff: ["Day-OFF"],
  nsnc: ["NSNC", "NSNC Half Day"],
  halfDay: ["Half Day"],
  wfh: ["WFH"],
  attended: ["Attended"],
};

function idsMatch(a, b) {
  const x = String(a || "").trim();
  const y = String(b || "").trim();
  if (!x || !y) return false;
  return x === y || x.toUpperCase() === y.toUpperCase();
}

function isCompanyOpsRole(userRole) {
  return COMPANY_OPS_ROLES.includes(String(userRole?.role || "").toLowerCase());
}

function isOpsCloser(userRole) {
  return roles.hasCloserTeamAssignment(userRole);
}

function isOpsTl(userRole) {
  const role = String(userRole?.role || "").toLowerCase();
  return role === "tl" || roles.hasLeadTeamAssignment(userRole);
}

function describeScope(userRole) {
  if (isCompanyOpsRole(userRole)) return "company";
  const role = String(userRole?.role || "").toLowerCase();
  if (role === "op") return "unit";
  if (isOpsCloser(userRole) && isOpsTl(userRole)) return "team+closed";
  if (isOpsCloser(userRole)) return "closer";
  if (isOpsTl(userRole)) return "team";
  return "self";
}

function saleMatchesOps(sale, userRole) {
  if (isCompanyOpsRole(userRole)) return true;
  const role = String(userRole?.role || "").toLowerCase();
  if (role === "op") {
    return roles.employeeInOpUnitScope(userRole, { unit: sale.unit });
  }
  const empId = userRole?.employeeId;
  const closer = isOpsCloser(userRole);
  const tl = isOpsTl(userRole);
  if (closer && tl) {
    return (empId && idsMatch(sale.closerId, empId)) || salesScope.isTeamLeadOfSale(sale, userRole);
  }
  if (closer) return Boolean(empId && idsMatch(sale.closerId, empId));
  if (tl) return salesScope.isTeamLeadOfSale(sale, userRole);
  return Boolean(empId && idsMatch(sale.agentId, empId));
}

function employeeMatchesOps(emp, userRole) {
  if (!emp) return false;
  if (isCompanyOpsRole(userRole)) return true;
  const role = String(userRole?.role || "").toLowerCase();
  if (role === "op") {
    return roles.employeeInOpUnitScope(userRole, emp);
  }
  const empId = userRole?.employeeId;
  if (isOpsTl(userRole)) return roles.employeeInLedTeamScope(userRole, emp);
  return Boolean(empId && idsMatch(emp.id, empId));
}

function filterSalesForDashboardOps(sales, userRole) {
  return (sales || []).filter((s) => saleMatchesOps(s, userRole));
}

function filterEmployeesForDashboardOps(employees, userRole) {
  return (employees || []).filter((e) => employeeMatchesOps(e, userRole));
}

function saleDayKey(sale) {
  const wd = String(sale.workingDay || "").slice(0, 10);
  if (wd) return wd;
  const eff = String(sale.effectiveDate || "").slice(0, 10);
  if (eff) return eff;
  return String(sale.submissionDate || "").slice(0, 10);
}

function addDays(iso, delta) {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function expandRangeForWorkingDay(from, to) {
  return { from: addDays(from, -1), to: addDays(to, 1) };
}

function countStatuses(records, names) {
  const set = new Set(names);
  return (records || []).filter((r) => set.has(r.status)).length;
}

function buildOpsMonth({ month, sales, employees, attendanceRecords, userRole }) {
  const bounds = periodGrid.buildPeriodBounds("month", `${month}-01`);
  const dates = bounds.dates && bounds.dates.length ? bounds.dates : datesInRange(bounds.from, bounds.to);
  const scopedSales = filterSalesForDashboardOps(sales, userRole);
  const scopedEmps = filterEmployeesForDashboardOps(employees, userRole);
  const empIds = new Set(scopedEmps.map((e) => e.id));

  const dailySales = dates.map((date) => ({
    date,
    sales: scopedSales.filter((s) => saleDayKey(s) === date).length,
  }));

  const att = (attendanceRecords || []).filter(
    (r) => empIds.has(r.employeeId) && r.date >= bounds.from && r.date <= bounds.to
  );

  return {
    month,
    from: bounds.from,
    to: bounds.to,
    scope: describeScope(userRole),
    dailySales,
    attendance: {
      dayOff: countStatuses(att, ATTENDANCE_GROUPS.dayOff),
      nsnc: countStatuses(att, ATTENDANCE_GROUPS.nsnc),
      halfDay: countStatuses(att, ATTENDANCE_GROUPS.halfDay),
      wfh: countStatuses(att, ATTENDANCE_GROUPS.wfh),
      attended: countStatuses(att, ATTENDANCE_GROUPS.attended),
    },
    employeeCount: scopedEmps.length,
  };
}

function resolveDashboardRange(query = {}) {
  const month = String(query.month || "").trim();
  if (query.from && query.to) {
    return {
      from: String(query.from).slice(0, 10),
      to: String(query.to).slice(0, 10),
      period: query.period || "day",
      date: query.date || query.from,
    };
  }
  if (/^\d{4}-\d{2}$/.test(month)) {
    const b = periodGrid.buildPeriodBounds("month", `${month}-01`);
    return { from: b.from, to: b.to, period: "month", date: `${month}-01` };
  }
  const period = query.period || "month";
  const date = query.date || new Date().toISOString().slice(0, 10);
  const b = periodGrid.buildPeriodBounds(period, date);
  return { from: b.from, to: b.to, period, date };
}

module.exports = {
  COMPANY_OPS_ROLES,
  ATTENDANCE_GROUPS,
  saleMatchesOps,
  employeeMatchesOps,
  filterSalesForDashboardOps,
  filterEmployeesForDashboardOps,
  saleDayKey,
  expandRangeForWorkingDay,
  buildOpsMonth,
  resolveDashboardRange,
  describeScope,
};

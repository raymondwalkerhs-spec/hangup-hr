/**
 * Team dashboard agent roster — active dialing agents only (no TL/OP/closers, no paused).
 */
const { filterDialingAgents } = require("./dialing-agents");
const { isLeadershipId } = require("./employee-ids");
const { normalizeStatusKey } = require("./employee-status");
const { collectLeadershipEmployeeIds, isSalesLeadershipEmployee } = require("./sale-program-employee");

const APP_LEADERSHIP_ROLES = new Set(["tl", "op"]);

function collectAppLeadershipEmployeeIds(appUsers = []) {
  const ids = new Set();
  for (const user of appUsers || []) {
    const role = String(user?.role || "").trim().toLowerCase();
    if (!APP_LEADERSHIP_ROLES.has(role)) continue;
    const empId = String(user?.employeeId || user?.employee_id || "").trim();
    if (empId) ids.add(empId);
  }
  return ids;
}

function collectExcludedEmployeeIds(teamsMeta = [], appUsers = []) {
  const ids = collectLeadershipEmployeeIds(teamsMeta);
  for (const id of collectAppLeadershipEmployeeIds(appUsers)) {
    ids.add(id);
  }
  return ids;
}

function isExcludedFromTeamDashboardRoster(emp, excludedIds) {
  if (!emp?.id) return true;
  if (isSalesLeadershipEmployee(emp, excludedIds)) return true;
  return false;
}

function isActiveDashboardAgent(emp) {
  return normalizeStatusKey(emp?.status) === "active";
}

function filterTeamDashboardAgents(employees, { teamsMeta = [], appUsers = [] } = {}) {
  const excludedIds = collectExcludedEmployeeIds(teamsMeta, appUsers);
  const dialing = filterDialingAgents(employees, { includeOut: false, activeOnly: true });
  return dialing.filter((e) => !isExcludedFromTeamDashboardRoster(e, excludedIds));
}

function teamTargetPercentage(approved, activeAgentCount, divisor = 1) {
  const count = Number(activeAgentCount) || 0;
  const sales = Number(approved) || 0;
  const days = Math.max(1, Number(divisor) || 1);
  if (count <= 0) return sales > 0 ? "—" : "0.00%";
  const dailyEquivalent = sales / days;
  return `${((dailyEquivalent / count) * 100).toFixed(2)}%`;
}

/** Working-day units for target: 1/day, 5/week, 5×weeks/month. */
function targetDivisorForPeriod(period, from, to) {
  const p = String(period || "day").toLowerCase();
  if (p === "week") return 5;
  if (p === "month") {
    const month = String(from || to || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return 5;
    try {
      const { listWeeksForMonth } = require("./rpm-weekly-dashboard");
      const weeks = listWeeksForMonth(month);
      return 5 * Math.max(1, weeks.length);
    } catch {
      return 5 * 4;
    }
  }
  return 1;
}

module.exports = {
  collectExcludedEmployeeIds,
  collectAppLeadershipEmployeeIds,
  isExcludedFromTeamDashboardRoster,
  isActiveDashboardAgent,
  filterTeamDashboardAgents,
  teamTargetPercentage,
  targetDivisorForPeriod,
};

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

function teamTargetPercentage(approved, activeAgentCount) {
  const count = Number(activeAgentCount) || 0;
  const sales = Number(approved) || 0;
  if (count <= 0) return sales > 0 ? "—" : "0.00%";
  return `${((sales / count) * 100).toFixed(2)}%`;
}

module.exports = {
  collectExcludedEmployeeIds,
  collectAppLeadershipEmployeeIds,
  isExcludedFromTeamDashboardRoster,
  isActiveDashboardAgent,
  filterTeamDashboardAgents,
  teamTargetPercentage,
};

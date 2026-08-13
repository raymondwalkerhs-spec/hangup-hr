/**
 * Classify employees for MLA / RPM sales program flags.
 */
const { isLeadershipId } = require("./employee-ids");
const { isDialingAgent } = require("./dialing-agents");
const { isOutStatus, normalizeStatusKey } = require("./employee-status");

function isEligibleForSalesProgramBackfill(emp) {
  if (!emp) return false;
  const key = normalizeStatusKey(emp.status);
  if (isOutStatus(emp.status)) return false;
  if (key === "deleted") return false;
  return true;
}

/** @deprecated use isEligibleForSalesProgramBackfill */
function isActiveForSalesProgram(emp) {
  return isEligibleForSalesProgramBackfill(emp);
}

function collectLeadershipEmployeeIds(orgTeams = []) {
  const ids = new Set();
  for (const team of orgTeams || []) {
    if (team.tlEmployeeId) ids.add(String(team.tlEmployeeId).trim());
    for (const id of team.tlEmployeeIds || []) {
      if (id) ids.add(String(id).trim());
    }
    for (const id of team.closerEmployeeIds || []) {
      if (id) ids.add(String(id).trim());
    }
  }
  return ids;
}

function isSalesLeadershipEmployee(emp, leadershipIds = null) {
  if (!emp?.id) return false;
  const id = String(emp.id).trim();
  if (isLeadershipId(id)) return true;
  const set = leadershipIds instanceof Set ? leadershipIds : new Set(leadershipIds || []);
  return set.has(id);
}

function resolveSalesProgramFlags(emp, { leadershipIds = null } = {}) {
  if (!isEligibleForSalesProgramBackfill(emp)) {
    return null;
  }
  if (isSalesLeadershipEmployee(emp, leadershipIds)) {
    return { sales_mla_enabled: true, sales_rpm_enabled: true };
  }
  if (isDialingAgent(emp, { includeOut: false, activeOnly: false })) {
    return { sales_mla_enabled: false, sales_rpm_enabled: true };
  }
  return null;
}

module.exports = {
  isEligibleForSalesProgramBackfill,
  isActiveForSalesProgram,
  collectLeadershipEmployeeIds,
  isSalesLeadershipEmployee,
  resolveSalesProgramFlags,
};

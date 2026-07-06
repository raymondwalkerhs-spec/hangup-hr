/**
 * Role-based agent/closer/unit scope for new sale submission.
 */
const { teamsMatch } = require("./team-names");

const MANAGE_ROLES = ["admin", "ceo", "hr"];
const ALL_UNIT_ROLES = ["admin", "ceo", "hr", "finance"];
const BROAD_SUBMIT_ROLES = new Set([
  "admin",
  "ceo",
  "hr",
  "finance",
  "quality",
  "rtm",
  "public_relations",
]);

function normalizeRole(role) {
  return String(role || "agent").trim().toLowerCase();
}

function isDialingEmployee(e) {
  const id = String(e?.id || "");
  if (/^(TL|CL|OP|HR|MG|OF|NW|DEL|RTM|quality)/i.test(id)) return false;
  if (String(e?.status || "").toLowerCase() === "deleted") return false;
  return true;
}

function isCloserCandidate(e) {
  const id = String(e?.id || "");
  const role = normalizeRole(e?.role);
  if (/^(TL|CL|OP)/i.test(id)) return true;
  if (["tl", "op"].includes(role)) return true;
  return isDialingEmployee(e);
}

function unitsForSubmit(userRole) {
  const units = new Set();
  if (userRole?.unit) units.add(userRole.unit);
  for (const lt of userRole?.leadTeams || []) {
    if (lt.unit) units.add(lt.unit);
  }
  return [...units];
}

function isBroadSubmitter(userRole) {
  const role = normalizeRole(userRole?.role);
  return BROAD_SUBMIT_ROLES.has(role) || MANAGE_ROLES.includes(role) || ALL_UNIT_ROLES.includes(role);
}

function isDualRoleAgent(userRole) {
  return normalizeRole(userRole?.role) === "agent" && (userRole?.leadTeams || []).length > 0;
}

function employeesInUnits(employees, units) {
  const set = new Set(units);
  return (employees || []).filter((e) => set.has(e.unit));
}

function employeesForAgentPicker(userRole, employees) {
  if (isBroadSubmitter(userRole)) {
    return (employees || []).filter((e) => isDialingEmployee(e));
  }
  const role = normalizeRole(userRole?.role);
  if (role === "tl" || role === "op") {
    const unit = userRole?.unit;
    return (employees || []).filter((e) => isDialingEmployee(e) && (!unit || e.unit === unit));
  }
  if (role === "agent") {
    if (isDualRoleAgent(userRole)) {
      const units = unitsForSubmit(userRole);
      return employeesInUnits(employees, units).filter((e) => isDialingEmployee(e));
    }
    return (employees || []).filter((e) => e.id === userRole?.employeeId);
  }
  return (employees || []).filter((e) => isDialingEmployee(e));
}

function employeesForCloserPicker(userRole, employees) {
  if (isBroadSubmitter(userRole)) {
    return (employees || []).filter((e) => isCloserCandidate(e));
  }
  const role = normalizeRole(userRole?.role);
  if (role === "tl" || role === "op") {
    const unit = userRole?.unit;
    return (employees || []).filter((e) => isCloserCandidate(e) && (!unit || e.unit === unit));
  }
  if (role === "agent") {
    const units = isDualRoleAgent(userRole) ? unitsForSubmit(userRole) : userRole?.unit ? [userRole.unit] : [];
    if (!units.length) {
      return (employees || []).filter((e) => e.id === userRole?.employeeId);
    }
    return employeesInUnits(employees, units).filter((e) => isCloserCandidate(e));
  }
  return (employees || []).filter((e) => isCloserCandidate(e));
}

function agentPickerLocked(userRole) {
  const role = normalizeRole(userRole?.role);
  return role === "agent" && !isDualRoleAgent(userRole);
}

function unitPickerLocked(userRole) {
  const role = normalizeRole(userRole?.role);
  if (role === "tl" || role === "op") return true;
  return role === "agent" && !isDualRoleAgent(userRole);
}

function allowedUnitsForSubmit(userRole, orgTeams) {
  if (isBroadSubmitter(userRole)) {
    const dialing = (orgTeams || []).filter((t) => t.dialsSales !== false);
    return [...new Set(dialing.map((t) => t.unit).filter(Boolean))].sort();
  }
  const role = normalizeRole(userRole?.role);
  if (role === "tl" || role === "op") {
    return userRole?.unit ? [userRole.unit] : unitsForSubmit(userRole);
  }
  if (role === "agent") {
    if (isDualRoleAgent(userRole)) return unitsForSubmit(userRole).sort();
    return userRole?.unit ? [userRole.unit] : [];
  }
  return unitsForSubmit(userRole);
}

function validateSaleSubmitAssignment(userRole, { agentId, closerId, unit, team }, employees) {
  const agents = employeesForAgentPicker(userRole, employees);
  const closers = employeesForCloserPicker(userRole, employees);
  const agentIds = new Set(agents.map((e) => e.id));
  const closerIds = new Set(closers.map((e) => e.id));

  if (!agentId || !agentIds.has(agentId)) {
    return { ok: false, error: "Agent not allowed for your role" };
  }
  const resolvedCloser = closerId || userRole?.employeeId || "";
  if (!resolvedCloser || !closerIds.has(resolvedCloser)) {
    return { ok: false, error: "Closer not allowed for your role" };
  }
  if (unit && !unitPickerLocked(userRole)) {
    const allowed = new Set(allowedUnitsForSubmit(userRole));
    if (allowed.size && !allowed.has(unit)) {
      return { ok: false, error: "Unit not allowed for your role" };
    }
  }
  const agentEmp = (employees || []).find((e) => e.id === agentId);
  if (team && agentEmp?.team && !teamsMatch(agentEmp.team, team)) {
    return { ok: false, error: "Agent must belong to the selected team" };
  }
  return { ok: true, closerId: resolvedCloser };
}

module.exports = {
  unitsForSubmit,
  isDualRoleAgent,
  isBroadSubmitter,
  agentPickerLocked,
  unitPickerLocked,
  allowedUnitsForSubmit,
  employeesForAgentPicker,
  employeesForCloserPicker,
  isDialingEmployee,
  isCloserCandidate,
  validateSaleSubmitAssignment,
};

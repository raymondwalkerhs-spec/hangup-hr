/**
 * Per-employee MLA / RPM sales program flags.
 */
const roles = require("./roles");

function normalizeRole(role) {
  return String(role || "agent").trim().toLowerCase();
}

const MANAGEMENT_SUBMIT_ROLES = new Set(["admin", "ceo", "hr", "finance", "quality", "rtm"]);

function flagValue(emp, snake, camel) {
  if (!emp) return false;
  if (emp[snake] === true || emp[camel] === true) return true;
  return false;
}

function hasExplicitProgramFlags(emp) {
  if (!emp) return false;
  return ["sales_mla_enabled", "salesMlaEnabled", "sales_rpm_enabled", "salesRpmEnabled"].some(
    (key) => emp[key] === true || emp[key] === false
  );
}

function canBypassProgramGate(userRole) {
  const role = normalizeRole(userRole?.role);
  if (MANAGEMENT_SUBMIT_ROLES.has(role)) return true;
  if (["tl", "op"].includes(role)) return true;
  if (typeof roles.hasCloserTeamAssignment === "function" && roles.hasCloserTeamAssignment(userRole)) return true;
  if (typeof roles.hasLeadTeamAssignment === "function" && roles.hasLeadTeamAssignment(userRole)) return true;
  const username = String(userRole?.username || "").trim().toLowerCase();
  if (roles.SYSTEM_ADMIN_USERNAMES?.has?.(username)) return true;
  if (typeof roles.canManageAppUsers === "function" && roles.canManageAppUsers(username)) return true;
  return false;
}

function employeePrograms(emp) {
  const programs = [];
  if (flagValue(emp, "sales_mla_enabled", "salesMlaEnabled")) programs.push("mla");
  if (flagValue(emp, "sales_rpm_enabled", "salesRpmEnabled")) programs.push("rpm");
  return programs;
}

function employeeHasProgram(emp, program) {
  const p = String(program || "").toLowerCase();
  if (p === "mla") return flagValue(emp, "sales_mla_enabled", "salesMlaEnabled");
  if (p === "rpm") return flagValue(emp, "sales_rpm_enabled", "salesRpmEnabled");
  return false;
}

function assertAgentProgramEnabled(agentEmp, program, userRole) {
  if (userRole && canBypassProgramGate(userRole)) return { ok: true };
  const p = String(program || "mla").toLowerCase();
  if (!agentEmp) return { ok: false, error: "Agent not found" };
  if (!hasExplicitProgramFlags(agentEmp)) return { ok: true };
  if (!employeeHasProgram(agentEmp, p)) {
    const label = p === "rpm" ? "RPM" : "MLA";
    return { ok: false, error: `Agent is not enabled for ${label} sales` };
  }
  return { ok: true };
}

function filterEmployeesByProgram(employees, program, opts = {}) {
  const p = String(program || "").toLowerCase();
  const keepIds = new Set((opts.alwaysIncludeIds || []).map(String));
  return (employees || []).filter((e) => {
    if (keepIds.has(String(e.id))) return true;
    if (!hasExplicitProgramFlags(e)) return true;
    return employeeHasProgram(e, p);
  });
}

function enabledProgramsForSubmitter(userRole, employees) {
  const role = normalizeRole(userRole?.role);
  if (MANAGEMENT_SUBMIT_ROLES.has(role) || canBypassProgramGate(userRole)) {
    return ["mla", "rpm"];
  }
  const empId = userRole?.employeeId;
  const self = (employees || []).find((e) => e.id === empId);
  if (self && hasExplicitProgramFlags(self)) {
    const programs = employeePrograms(self);
    if (programs.length) return programs;
    return [];
  }
  if (empId || ["agent", "tl", "op"].includes(role)) return ["mla", "rpm"];
  return [];
}

module.exports = {
  employeePrograms,
  employeeHasProgram,
  hasExplicitProgramFlags,
  assertAgentProgramEnabled,
  filterEmployeesByProgram,
  enabledProgramsForSubmitter,
  canBypassProgramGate,
  MANAGEMENT_SUBMIT_ROLES,
};

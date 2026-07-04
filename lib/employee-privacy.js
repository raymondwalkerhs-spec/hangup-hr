/**
 * Strip sensitive employee fields for role-scoped API responses.
 */
const roles = require("./roles");

function isAgentRole(role) {
  return String(role || "").toLowerCase() === "agent";
}

function canSeeNationality(emp, userRole) {
  if (!emp || !userRole) return false;
  if (userRole.employeeId && userRole.employeeId === emp.id) return true;
  return roles.canViewEmployeeNationality(userRole, emp);
}

function canSeeCompliance(emp, userRole) {
  if (!emp || !userRole) return false;
  if (userRole.employeeId && userRole.employeeId === emp.id) return true;
  return roles.canViewEmployeeCompliance(userRole, emp);
}

function sanitizeEmployee(emp, userRole) {
  if (!emp) return emp;
  const copy = { ...emp };
  const role = userRole?.role || userRole;
  if (isAgentRole(role)) delete copy.internal_id;
  if (!canSeeNationality(emp, userRole)) delete copy.nationality;
  if (!canSeeCompliance(emp, userRole)) {
    delete copy.work_permit;
    delete copy.insurance_status;
  }
  return copy;
}

function sanitizeEmployees(list, userRole) {
  if (!Array.isArray(list)) return list;
  return list.map((e) => sanitizeEmployee(e, userRole));
}

module.exports = {
  isAgentRole,
  canSeeNationality,
  canSeeCompliance,
  sanitizeEmployee,
  sanitizeEmployees,
};

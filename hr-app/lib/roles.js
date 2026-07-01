const ROLE_RANK = { agent: 1, tl: 2, finance: 3, hr: 4, admin: 5 };

function resolveUserRole(username) {
  return { role: "hr", unit: null, employeeId: null, username };
}

function canAccessUnit(userRole, unit) {
  if (!unit) return true;
  if (["admin", "hr", "finance"].includes(userRole.role)) return true;
  if (userRole.role === "tl") return !userRole.unit || userRole.unit === unit;
  return false;
}

function canEditAttendance(userRole) {
  return ROLE_RANK[userRole.role] >= ROLE_RANK.tl;
}

function canViewPayroll(userRole) {
  return ROLE_RANK[userRole.role] >= ROLE_RANK.finance;
}

function canManageAll(userRole) {
  return ["admin", "hr"].includes(userRole.role);
}

function canUploadProfilePhoto(userRole, emp, username) {
  if (!emp) return false;
  if (!canAccessUnit(userRole, emp.unit)) return false;
  if (canManageAll(userRole)) return true;
  const u = String(username || "").trim().toLowerCase();
  if (!u) return false;
  if (String(emp.id || "").toLowerCase() === u) return true;
  if (String(emp.american_name || "").toLowerCase() === u) return true;
  if (userRole.employeeId && userRole.employeeId === emp.id) return true;
  return false;
}

function filterEmployeesForUser(employees, userRole) {
  if (["admin", "hr", "finance"].includes(userRole.role)) return employees;
  if (userRole.role === "tl" && userRole.unit) {
    return employees.filter((e) => e.unit === userRole.unit);
  }
  if (userRole.role === "agent" && userRole.employeeId) {
    return employees.filter((e) => e.id === userRole.employeeId);
  }
  return employees;
}

module.exports = {
  resolveUserRole,
  canAccessUnit,
  canEditAttendance,
  canViewPayroll,
  canManageAll,
  canUploadProfilePhoto,
  filterEmployeesForUser,
};

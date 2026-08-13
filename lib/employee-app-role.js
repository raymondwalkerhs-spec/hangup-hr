/**
 * Resolve app role for employee pickers (sales reviewer/verifier filters).
 * Prefers linked app_users.role; falls back to ID-prefix inference.
 */
const usersAdmin = require("./users-admin");

function roleMapFromAppUsers(appUsers) {
  const map = new Map();
  for (const u of appUsers || []) {
    const role = String(u.role || "").trim().toLowerCase();
    if (!role) continue;
    const employeeId = String(u.employee_id || "").trim();
    if (employeeId) map.set(employeeId, role);
    const username = String(u.username || "").trim();
    if (username && !map.has(username)) map.set(username, role);
  }
  return map;
}

function lookupLiveAppRole(emp, roleByEmployeeId = null) {
  const id = String(emp?.id || "").trim();
  if (roleByEmployeeId && id) {
    const fromLogin = String(roleByEmployeeId.get(id) || "").trim().toLowerCase();
    if (fromLogin) return fromLogin;
  }
  try {
    const store = require("./data-store");
    const cached = String(store.getAppUserRoleForEmployee?.(id) || "").trim().toLowerCase();
    if (cached) return cached;
  } catch {
    /* optional */
  }
  return "";
}

function liveAppRoleForEmployee(emp, roleByEmployeeId = null) {
  const lookedUp = lookupLiveAppRole(emp, roleByEmployeeId);
  if (lookedUp) return lookedUp;
  const fromEmp = String(emp?.role || "").trim().toLowerCase();
  if (fromEmp && fromEmp !== "none") return fromEmp;
  return "";
}

function inferAppRoleForEmployee(emp, roleByEmployeeId = null) {
  const live = liveAppRoleForEmployee(emp, roleByEmployeeId);
  if (live) return live;
  return usersAdmin.inferRoleFromEmployeeId(emp?.id);
}

function enrichEmployeeWithAppRole(emp, roleByEmployeeId = null) {
  if (!emp) return emp;
  return {
    ...emp,
    role: inferAppRoleForEmployee(emp, roleByEmployeeId),
  };
}

function enrichEmployeesWithAppRole(employees, appUsersOrRoleMap = null) {
  const roleByEmployeeId =
    appUsersOrRoleMap instanceof Map
      ? appUsersOrRoleMap
      : roleMapFromAppUsers(appUsersOrRoleMap);
  return (employees || []).map((e) => enrichEmployeeWithAppRole(e, roleByEmployeeId));
}

/** Stamp app_users.role only — never infer TL/CL/HR from the employee ID. */
function enrichEmployeeWithLiveAppRole(emp, roleByEmployeeId = null) {
  if (!emp) return emp;
  const live = lookupLiveAppRole(emp, roleByEmployeeId);
  if (!live) return emp;
  return { ...emp, role: live };
}

function enrichEmployeesWithLiveAppRole(employees, appUsersOrRoleMap = null) {
  const roleByEmployeeId =
    appUsersOrRoleMap instanceof Map
      ? appUsersOrRoleMap
      : roleMapFromAppUsers(appUsersOrRoleMap);
  return (employees || []).map((e) => enrichEmployeeWithLiveAppRole(e, roleByEmployeeId));
}

function isEligibleReviewerEmployee(emp) {
  const live = liveAppRoleForEmployee(emp);
  const role = String(live || inferAppRoleForEmployee(emp)).toLowerCase();
  if (["quality", "rtm", "admin", "ceo"].includes(role)) return true;
  if (live) return false;
  const id = String(emp?.id || "");
  if (/^(QA|RTM|MG)/i.test(id)) return true;
  if (/^HR/i.test(id) && String(emp?.team || "").toLowerCase() === "quality") return true;
  return false;
}

module.exports = {
  roleMapFromAppUsers,
  lookupLiveAppRole,
  liveAppRoleForEmployee,
  inferAppRoleForEmployee,
  enrichEmployeeWithAppRole,
  enrichEmployeesWithAppRole,
  enrichEmployeeWithLiveAppRole,
  enrichEmployeesWithLiveAppRole,
  isEligibleReviewerEmployee,
};

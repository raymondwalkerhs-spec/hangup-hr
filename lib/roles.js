// none = no app access. ceo ranks at the top with the same reach as admin.
const ROLE_RANK = {
  none: 0,
  agent: 1,
  office_assistant: 1,
  quality: 1,
  rtm: 1,
  tl: 2,
  op: 2,
  finance: 3,
  hr: 4,
  admin: 5,
  ceo: 6,
};

const ADMIN_ROLES = ["admin", "ceo"];
const LOG_ROLES = ["admin", "ceo"];
const MANAGE_ROLES = ["admin", "ceo", "hr"];
const ALL_UNIT_ROLES = ["admin", "ceo", "hr", "finance"];
const SELF_SCOPED_ROLES = ["agent", "office_assistant", "quality", "rtm"];
const BONUS_VIEW_ROLES = ["agent", "office_assistant", "quality", "rtm", "tl", "op", "finance", "hr", "admin", "ceo"];
const TRANSFER_BONUS_ROLES = ["tl", "op", "quality", "rtm"];
const BONUS_REQUEST_SUBMIT_ROLES = ["tl", "op", "admin", "hr", "quality", "rtm"];
const PAYSLIP_ONLY_BONUS_ROLES = ["rtm", "quality", "admin", "office_assistant", "hr", "ceo"];
const FINANCE_ACCESS_USERS = ["mark", "phoebe", "raymond"];

const ROLE_ALIASES = {
  administrator: "admin",
  owner: "admin",
  superadmin: "admin",
  "chief executive": "ceo",
  "chief executive officer": "ceo",
  founder: "ceo",
  manager: "hr",
  "human resources": "hr",
  accountant: "finance",
  finances: "finance",
  payroll: "finance",
  "team lead": "tl",
  teamlead: "tl",
  "team leader": "tl",
  team_leader: "tl",
  leader: "tl",
  supervisor: "tl",
  employee: "agent",
  user: "agent",
  staff: "agent",
  "op manager": "op",
  operations: "op",
  "quality agent": "quality",
  qa: "quality",
  "office assistant": "office_assistant",
  assistant: "office_assistant",
};

const DEFAULT_ROLE = "none";

function normalizeRole(role) {
  const raw = String(role || "").trim().toLowerCase();
  if (!raw) return DEFAULT_ROLE;
  if (ROLE_RANK[raw] !== undefined && raw !== "none") return raw;
  if (ROLE_ALIASES[raw]) return ROLE_ALIASES[raw];
  return DEFAULT_ROLE;
}

function resolveUserRole(username, role) {
  return { role: normalizeRole(role), unit: null, team: null, employeeId: null, username };
}

function enrichUserRole(userRole, employees) {
  const u = String(userRole.username || "").trim().toLowerCase();
  const emp = (employees || []).find(
    (e) =>
      String(e.id || "").toLowerCase() === u ||
      String(e.american_name || "").trim().toLowerCase() === u ||
      String(e.arabic_name || "").trim().toLowerCase() === u
  );
  if (emp) {
    userRole.employeeId = emp.id;
    userRole.unit = emp.unit || null;
    userRole.team = emp.team || null;
  }
  return userRole;
}

function hasAppAccess(userRole) {
  return (ROLE_RANK[userRole?.role] || 0) >= ROLE_RANK.agent;
}

function canViewLogs(userRole) {
  return LOG_ROLES.includes(userRole?.role);
}

const SYSTEM_ADMIN_USERNAME = "raymond";

function canManageAppUsers(username) {
  return String(username || "").trim().toLowerCase() === SYSTEM_ADMIN_USERNAME;
}

const LEAVE_APPROVERS = ["mark", "raymond", "phoebe"];

function canApproveLeave(username) {
  return LEAVE_APPROVERS.includes(String(username || "").trim().toLowerCase());
}

function canManageSessions(username) {
  return canManageAppUsers(username);
}

function canAccessEmployee(userRole, emp) {
  if (!emp) return false;
  if (ALL_UNIT_ROLES.includes(userRole.role)) return true;
  if (MANAGE_ROLES.includes(userRole.role)) return true;
  if (userRole.role === "op") {
    return !userRole.unit || emp.unit === userRole.unit;
  }
  if (userRole.role === "tl") {
    return !userRole.team || emp.team === userRole.team;
  }
  if (SELF_SCOPED_ROLES.includes(userRole.role)) {
    return Boolean(userRole.employeeId && emp.id === userRole.employeeId);
  }
  return false;
}

function canAccessUnit(userRole, unit) {
  if (!unit) return true;
  if (ALL_UNIT_ROLES.includes(userRole.role)) return true;
  if (userRole.role === "op") return !userRole.unit || userRole.unit === unit;
  return false;
}

function canEditAttendance(userRole) {
  if (MANAGE_ROLES.includes(userRole.role)) return true;
  return userRole.role === "tl";
}

function canViewPayroll(userRole) {
  return ROLE_RANK[userRole?.role] >= ROLE_RANK.finance;
}

function canViewBonusesDeductions(userRole) {
  return BONUS_VIEW_ROLES.includes(userRole?.role);
}

function canTransferBonus(userRole) {
  if (canManageAll(userRole)) return true;
  return TRANSFER_BONUS_ROLES.includes(userRole?.role);
}

function canManageAll(userRole) {
  return MANAGE_ROLES.includes(userRole.role);
}

function canUploadProfilePhoto(userRole, emp, username) {
  if (!emp) return false;
  if (!canAccessEmployee(userRole, emp)) return false;
  if (canManageAll(userRole)) return true;
  const u = String(username || "").trim().toLowerCase();
  if (!u) return false;
  if (String(emp.id || "").toLowerCase() === u) return true;
  if (String(emp.american_name || "").toLowerCase() === u) return true;
  if (userRole.employeeId && userRole.employeeId === emp.id) return true;
  return false;
}

function filterEmployeesForUser(employees, userRole) {
  if (ALL_UNIT_ROLES.includes(userRole.role)) return employees;
  if (MANAGE_ROLES.includes(userRole.role)) return employees;
  if (userRole.role === "op" && userRole.unit) {
    return employees.filter((e) => e.unit === userRole.unit);
  }
  if (userRole.role === "tl" && userRole.team) {
    return employees.filter((e) => e.team === userRole.team);
  }
  if (SELF_SCOPED_ROLES.includes(userRole.role) && userRole.employeeId) {
    return employees.filter((e) => e.id === userRole.employeeId);
  }
  return employees;
}

function scopedEmployeeIds(employees, userRole) {
  return new Set(filterEmployeesForUser(employees, userRole).map((e) => e.id));
}

function filterBonusesForUser(bonuses, deductions, userRole, employees) {
  const scope = scopedEmployeeIds(employees, userRole);
  let filtered = bonuses.filter((b) => scope.has(b.employeeId));

  if (SELF_SCOPED_ROLES.includes(userRole.role) && userRole.employeeId) {
    const transferBonuses = bonuses.filter((b) => {
      if (b.type !== "Bonus from TL / OP" || scope.has(b.employeeId)) return false;
      return (deductions || []).some(
        (d) =>
          d.employeeId === userRole.employeeId &&
          d.type === "Bonus from TL / OP" &&
          d.date === b.date &&
          Number(d.amount) === Number(b.amount) &&
          String(d.reason || "").includes(b.employeeId)
      );
    });
    filtered = [...filtered, ...transferBonuses];
  }

  return filtered;
}

function filterDeductionsForUser(deductions, userRole, employees) {
  const scope = scopedEmployeeIds(employees, userRole);
  return deductions.filter((d) => scope.has(d.employeeId));
}

function canGrantTransferBonus(userRole, recipient, giverEmp) {
  if (!recipient || !giverEmp) return false;
  if (canManageAll(userRole)) return true;
  if (!canTransferBonus(userRole)) return false;
  if (userRole.role === "tl" || userRole.role === "op") {
    return canAccessEmployee(userRole, recipient) && canAccessEmployee(userRole, giverEmp);
  }
  if (SELF_SCOPED_ROLES.includes(userRole.role)) {
    return (
      giverEmp.id === userRole.employeeId &&
      recipient.id !== userRole.employeeId &&
      (!userRole.team || recipient.team === userRole.team)
    );
  }
  return canAccessEmployee(userRole, recipient) && canAccessEmployee(userRole, giverEmp);
}

function isLeadershipEmployeeId(employeeId) {
  return /^(TL|CL|OP|HR)/i.test(String(employeeId || "").trim());
}

function isPayslipOnlyBonusRecipient(employeeId, authUsers) {
  if (isLeadershipEmployeeId(employeeId)) return true;
  const u = String(employeeId || "").trim().toLowerCase();
  const auth = (authUsers || []).find((a) => String(a.user || "").trim().toLowerCase() === u);
  if (auth && PAYSLIP_ONLY_BONUS_ROLES.includes(normalizeRole(auth.role))) return true;
  return false;
}

function canReceiveBonusViaRequest(employeeId, authUsers) {
  return !isPayslipOnlyBonusRecipient(employeeId, authUsers);
}

function canSubmitBonusRequest(userRole) {
  return BONUS_REQUEST_SUBMIT_ROLES.includes(userRole?.role);
}

function canApproveBonusRequest(userRole) {
  return MANAGE_ROLES.includes(userRole?.role) || ADMIN_ROLES.includes(userRole?.role);
}

function canAccessCostsFull(userRole, username) {
  const u = String(username || "").trim().toLowerCase();
  if (FINANCE_ACCESS_USERS.includes(u)) return true;
  return userRole?.role === "finance" || ADMIN_ROLES.includes(userRole?.role);
}

function canSubmitExpense(userRole, username) {
  if (canAccessCostsFull(userRole, username)) return true;
  return userRole?.role === "hr" || userRole?.role === "rtm";
}

function canViewSales(userRole) {
  return hasAppAccess(userRole);
}

function canEditSale(userRole) {
  const role = userRole?.role;
  if (["hr", "admin", "ceo", "quality", "rtm"].includes(role)) return true;
  if (role === "op") return true;
  return false;
}

function canManageHolidayActivation(userRole) {
  return ADMIN_ROLES.includes(normalizeRole(userRole?.role || userRole));
}

module.exports = {
  ROLE_RANK,
  SELF_SCOPED_ROLES,
  resolveUserRole,
  enrichUserRole,
  normalizeRole,
  hasAppAccess,
  canViewLogs,
  canManageAppUsers,
  canApproveLeave,
  canManageSessions,
  LEAVE_APPROVERS,
  SYSTEM_ADMIN_USERNAME,
  canAccessUnit,
  canAccessEmployee,
  canEditAttendance,
  canViewPayroll,
  canViewBonusesDeductions,
  canTransferBonus,
  canGrantTransferBonus,
  canManageAll,
  canManageHolidayActivation,
  canSubmitBonusRequest,
  canApproveBonusRequest,
  canReceiveBonusViaRequest,
  isPayslipOnlyBonusRecipient,
  isLeadershipEmployeeId,
  canAccessCostsFull,
  canSubmitExpense,
  canViewSales,
  canEditSale,
  PAYSLIP_ONLY_BONUS_ROLES,
  FINANCE_ACCESS_USERS,
  canUploadProfilePhoto,
  filterEmployeesForUser,
  filterBonusesForUser,
  filterDeductionsForUser,
  scopedEmployeeIds,
};

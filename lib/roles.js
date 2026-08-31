// none = no app access. ceo ranks at the top with the same reach as admin.
const ROLE_RANK = {
  none: 0,
  agent: 1,
  office_assistant: 1,
  checker: 1,
  quality: 1,
  rtm: 1,
  public_relations: 1,
  tl: 2,
  op: 2,
  finance: 3,
  it: 4,
  hr: 4,
  admin: 5,
  ceo: 6,
};

const ADMIN_ROLES = ["admin", "ceo"];
const LOG_ROLES = ["admin", "ceo"];
const MANAGE_ROLES = ["admin", "ceo", "hr"];
const ALL_UNIT_ROLES = ["admin", "ceo", "hr", "finance"];
const SELF_SCOPED_ROLES = ["agent", "office_assistant"];
const COMPANY_EMPLOYEE_ROLES = ["quality", "rtm", "public_relations"];
const BONUS_VIEW_ROLES = ["agent", "office_assistant", "checker", "quality", "rtm", "tl", "op", "finance", "hr", "admin", "ceo"];
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
  accounting: "finance",
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
  checker: "checker",
  "rpm checker": "checker",
  "quality checker": "checker",
  "public relations": "public_relations",
  pr: "public_relations",
  "public_relations": "public_relations",
  "information technology": "it",
  tech: "it",
};

const DEFAULT_ROLE = "none";

const rolePermissions = require("./role-permissions");
const userPermissions = require("./user-permissions");

function perm(key, userRole, legacyFn) {
  const username = String(userRole?.username || "").trim().toLowerCase();
  if (username) {
    const userHit = userPermissions.getOverrideSync(username, key);
    if (userHit !== undefined) return userHit;
  }
  return rolePermissions.isAllowedSync(key, userRole, legacyFn);
}

function normalizeRole(role) {
  const raw = String(role || "").trim().toLowerCase();
  if (!raw) return DEFAULT_ROLE;
  if (ROLE_RANK[raw] !== undefined && raw !== "none") return raw;
  if (ROLE_ALIASES[raw]) return ROLE_ALIASES[raw];
  return DEFAULT_ROLE;
}

function resolveUserRole(username, role) {
  return {
    role: normalizeRole(role),
    unit: null,
    team: null,
    employeeId: null,
    username,
    leadTeams: [],
    closerTeams: [],
    opUnits: [],
    checkerUnits: [],
    isIt: false,
  };
}

/** Prefer live app_users.role over a session role frozen at login. */
function effectiveLoginRole(sessionRole, appUser) {
  const fromDb = String(appUser?.role || "").trim();
  return fromDb ? normalizeRole(fromDb) : normalizeRole(sessionRole);
}

function buildLeadTeams(employeeId, orgTeams = []) {
  if (!employeeId) return [];
  return (orgTeams || [])
    .filter((t) => t.tlEmployeeId === employeeId || (t.tlEmployeeIds || []).includes(employeeId))
    .map((t) => ({ unit: t.unit || "", team: t.name || "" }));
}

function buildCloserTeams(employeeId, orgTeams = []) {
  if (!employeeId) return [];
  const out = [];
  for (const t of orgTeams || []) {
    if ((t.closerEmployeeIds || []).includes(employeeId)) {
      out.push({ unit: t.unit || "", team: t.name || "" });
    }
  }
  return out;
}

function attachLeadTeams(userRole, orgTeams = []) {
  userRole.leadTeams = buildLeadTeams(userRole.employeeId, orgTeams);
  userRole.closerTeams = buildCloserTeams(userRole.employeeId, orgTeams);
  return userRole;
}

function parseExtraTeamEntries(raw) {
  const { normalizeTeamName } = require("./team-names");
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((t) => {
      if (t && typeof t === "object") {
        return { unit: t.unit || "", team: normalizeTeamName(t.team || t.name || "") };
      }
      const name = normalizeTeamName(t);
      return name ? { unit: "", team: name } : null;
    })
    .filter((t) => t && t.team);
}

function attachTeamDashboardExtraTeams(userRole, employees) {
  const emp = (employees || []).find((e) => e.id === userRole.employeeId);
  const raw = emp?.team_dashboard_extra_teams ?? emp?.teamDashboardExtraTeams ?? [];
  userRole.teamDashboardExtraTeams = parseExtraTeamEntries(raw);
  userRole.canSubmitChecksQFeedback =
    emp?.can_submit_checks_q_feedback === true || emp?.canSubmitChecksQFeedback === true;
  userRole.checksSubmitScope =
    String(emp?.checks_submit_scope || emp?.checksSubmitScope || "self").toLowerCase() === "team"
      ? "team"
      : "self";
  return userRole;
}

function employeeInExtraTeamScope(userRole, emp) {
  const { teamsMatch } = require("./team-names");
  for (const xt of userRole?.teamDashboardExtraTeams || []) {
    if (xt.unit && emp.unit !== xt.unit) continue;
    if (teamsMatch(emp.team, xt.team)) return true;
  }
  return false;
}

function employeeInOwnTeamScope(userRole, emp) {
  if (!emp || !userRole?.employeeId) return false;
  if (emp.id === userRole.employeeId) return true;
  const { teamsMatch } = require("./team-names");
  if (!userRole.team) return false;
  if (userRole.unit && emp.unit && emp.unit !== userRole.unit) return false;
  return teamsMatch(emp.team, userRole.team);
}

function attachOpUnits(userRole, unitOpsByUnit = {}) {
  const units = new Set();
  if (userRole?.unit) units.add(userRole.unit);
  const id = userRole?.employeeId;
  if (id) {
    for (const [unit, ids] of Object.entries(unitOpsByUnit || {})) {
      if ((ids || []).includes(id)) units.add(unit);
    }
  }
  userRole.opUnits = [...units];
  return userRole;
}

/** Explicit org assignments only — home unit is not auto-included. */
function attachCheckerUnits(userRole, unitCheckersByUnit = {}) {
  const units = new Set();
  const id = userRole?.employeeId;
  if (id) {
    for (const [unit, ids] of Object.entries(unitCheckersByUnit || {})) {
      if ((ids || []).includes(id)) units.add(unit);
    }
  }
  userRole.checkerUnits = [...units];
  return userRole;
}

function opUnitSet(userRole) {
  const units = new Set(userRole?.opUnits || []);
  if (userRole?.unit) units.add(userRole.unit);
  return units;
}

function checkerUnitSet(userRole) {
  return new Set(userRole?.checkerUnits || []);
}

function employeeInOpUnitScope(userRole, emp) {
  if (!emp) return false;
  const units = opUnitSet(userRole);
  if (!units.size) return true;
  return units.has(emp.unit);
}

function employeeInCheckerUnitScope(userRole, emp) {
  if (!emp) return false;
  if (userRole?.employeeId && emp.id === userRole.employeeId) return true;
  const units = checkerUnitSet(userRole);
  if (!units.size) return false;
  return units.has(emp.unit);
}

function hasCheckerUnitAssignment(userRole) {
  return checkerUnitSet(userRole).size > 0;
}

function enrichUserRole(userRole, employees, appUser = null, orgTeams = []) {
  const u = String(userRole.username || "").trim().toLowerCase();
  if (appUser) {
    userRole.isIt = appUser.is_it === true || appUser.isIt === true;
    if (appUser.employee_id) {
      const byLink = (employees || []).find((e) => e.id === appUser.employee_id);
      if (byLink) {
        userRole.employeeId = byLink.id;
        userRole.unit = byLink.unit || null;
        userRole.team = byLink.team || null;
        attachLeadTeams(userRole, orgTeams);
        return attachTeamDashboardExtraTeams(userRole, employees);
      }
    }
  }
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
  attachLeadTeams(userRole, orgTeams);
  return attachTeamDashboardExtraTeams(userRole, employees);
}

function isLedTeamMember(userRole, emp) {
  const { teamsMatch } = require("./team-names");
  for (const lt of userRole?.leadTeams || []) {
    if (lt.unit && emp.unit !== lt.unit) continue;
    if (teamsMatch(emp.team, lt.team)) return true;
  }
  return false;
}

function employeeInLedTeamScope(userRole, emp) {
  if (!emp || !userRole?.employeeId) return false;
  if (emp.id === userRole.employeeId) return true;
  return isLedTeamMember(userRole, emp);
}

function isCloserTeamMember(userRole, emp) {
  const { teamsMatch } = require("./team-names");
  for (const ct of userRole?.closerTeams || []) {
    if (ct.unit && emp.unit !== ct.unit) continue;
    if (teamsMatch(emp.team, ct.team)) return true;
  }
  return false;
}

function employeeInCloserTeamScope(userRole, emp) {
  if (!emp || !userRole?.employeeId) return false;
  if (emp.id === userRole.employeeId) return true;
  return isCloserTeamMember(userRole, emp);
}

function isActiveAgentEmployee(emp) {
  if (!emp) return false;
  const { normalizeStatusKey } = require("./employee-status");
  const key = normalizeStatusKey(emp.status);
  return key === "active" || key === "paused" || key === "paused_still_paid";
}

function isOnBehalfAgentTarget(emp) {
  if (!isActiveAgentEmployee(emp)) return false;
  const { isDialingAgent } = require("./dialing-agents");
  return isDialingAgent(emp, { activeOnly: true });
}

function hasLeadTeamAssignment(userRole) {
  return (userRole?.leadTeams || []).length > 0;
}

function hasCloserTeamAssignment(userRole) {
  return (userRole?.closerTeams || []).length > 0;
}

function uniqueCloserTeamCount(userRole) {
  const names = new Set();
  for (const t of userRole?.closerTeams || []) {
    const name = String(t.team || t.name || "").trim().toLowerCase();
    if (name) names.add(name);
  }
  return names.size;
}

function usesCloseTeamsDashboardKpi(userRole) {
  const role = normalizeRole(userRole?.role);
  return role === "tl" || hasCloserTeamAssignment(userRole);
}

function canSubmitLeaveOnBehalf(userRole, emp) {
  if (!emp || !isOnBehalfAgentTarget(emp)) return false;
  const role = normalizeRole(userRole?.role);
  if (MANAGE_ROLES.includes(role)) return true;
  if (role === "op") {
    return employeeInOpUnitScope(userRole, emp);
  }
  if (role === "tl" || hasLeadTeamAssignment(userRole)) {
    if (employeeInLedTeamScope(userRole, emp)) return true;
    if (role === "tl" && userRole.team) {
      const { teamsMatch } = require("./team-names");
      return teamsMatch(emp.team, userRole.team);
    }
    return false;
  }
  return false;
}

function canSubmitItOnBehalf(userRole, emp) {
  if (!emp) return false;
  if (emp.id === userRole?.employeeId) return isActiveAgentEmployee(emp);
  if (!isOnBehalfAgentTarget(emp)) return false;
  const role = normalizeRole(userRole?.role);
  if (MANAGE_ROLES.includes(role) || ALL_UNIT_ROLES.includes(role)) return true;
  if (hasItAccess(userRole) || role === "it") {
    return !userRole.unit || emp.unit === userRole.unit;
  }
  if (role === "op") {
    return employeeInOpUnitScope(userRole, emp);
  }
  if (role === "tl" || hasLeadTeamAssignment(userRole)) {
    if (employeeInLedTeamScope(userRole, emp)) return true;
    if (role === "tl" && userRole.team) {
      const { teamsMatch } = require("./team-names");
      return teamsMatch(emp.team, userRole.team);
    }
    return false;
  }
  if (hasCloserTeamAssignment(userRole)) {
    return employeeInCloserTeamScope(userRole, emp);
  }
  return false;
}

function employeesMatchingTeamEntries(employees, teamEntries, { activeOnly = true, agentsOnly = false } = {}) {
  const { teamsMatch } = require("./team-names");
  return (employees || []).filter((e) => {
    if (activeOnly && !isActiveAgentEmployee(e)) return false;
    if (agentsOnly && !isOnBehalfAgentTarget(e)) return false;
    return (teamEntries || []).some(
      (entry) => (!entry.unit || e.unit === entry.unit) && teamsMatch(e.team, entry.team)
    );
  });
}

function employeesForLeaveOnBehalf(userRole, employees) {
  const role = normalizeRole(userRole?.role);
  if (MANAGE_ROLES.includes(role) || ALL_UNIT_ROLES.includes(role)) {
    return (employees || []).filter((e) => isOnBehalfAgentTarget(e));
  }
  if (role === "op" && opUnitSet(userRole).size) {
    return (employees || []).filter((e) => employeeInOpUnitScope(userRole, e) && isOnBehalfAgentTarget(e));
  }
  if (role === "tl" || hasLeadTeamAssignment(userRole)) {
    const scoped = employeesMatchingTeamEntries(employees, userRole.leadTeams || [], {
      activeOnly: true,
      agentsOnly: true,
    });
    if (scoped.length || !userRole.team) return scoped;
    const { teamsMatch } = require("./team-names");
    return (employees || []).filter(
      (e) => teamsMatch(e.team, userRole.team) && isOnBehalfAgentTarget(e)
    );
  }
  return [];
}

function employeesForItOnBehalf(userRole, employees) {
  const role = normalizeRole(userRole?.role);
  if (MANAGE_ROLES.includes(role) || ALL_UNIT_ROLES.includes(role) || role === "quality") {
    return (employees || []).filter((e) => isOnBehalfAgentTarget(e));
  }
  if (hasItAccess(userRole) || role === "it") {
    if (userRole?.unit) {
      return (employees || []).filter((e) => e.unit === userRole.unit && isOnBehalfAgentTarget(e));
    }
    return (employees || []).filter((e) => isOnBehalfAgentTarget(e));
  }
  if (role === "op" && opUnitSet(userRole).size) {
    return (employees || []).filter((e) => employeeInOpUnitScope(userRole, e) && isOnBehalfAgentTarget(e));
  }
  const teamEntries = [
    ...(userRole?.leadTeams || []),
    ...(userRole?.closerTeams || []),
  ];
  if (role === "tl" || hasLeadTeamAssignment(userRole) || hasCloserTeamAssignment(userRole)) {
    const seen = new Set();
    const out = [];
    for (const e of employeesMatchingTeamEntries(employees, teamEntries, {
      activeOnly: true,
      agentsOnly: true,
    })) {
      if (!seen.has(e.id)) {
        seen.add(e.id);
        out.push(e);
      }
    }
    return out;
  }
  return [];
}

function employeesForCoachingOnBehalf(userRole, employees, opts) {
  return require("./coaching-scope").employeesForCoachingAgent(userRole, employees, opts || {});
}

function filterEmployeesForTeamDashboard(employees, userRole) {
  const r = userRole?.role;
  let base;
  // Checkers: all employees in assigned checker units (+ self)
  if (r === "checker") {
    base = (employees || []).filter((e) => employeeInCheckerUnitScope(userRole, e));
    return base;
  }
  // Agents (no lead teams): own team only on Team Dashboard
  if (
    (r === "agent" || SELF_SCOPED_ROLES.includes(r)) &&
    !hasLeadTeamAssignment(userRole) &&
    !hasCloserTeamAssignment(userRole)
  ) {
    base = (employees || []).filter((e) => employeeInOwnTeamScope(userRole, e));
  } else {
    base = filterEmployeesForUser(employees, userRole);
  }
  const ids = new Set(base.map((e) => e.id));
  const extra = [];
  for (const e of employees || []) {
    if (ids.has(e.id)) continue;
    if (hasCloserTeamAssignment(userRole) && isCloserTeamMember(userRole, e)) {
      ids.add(e.id);
      extra.push(e);
      continue;
    }
    if (employeeInExtraTeamScope(userRole, e)) {
      ids.add(e.id);
      extra.push(e);
    }
  }
  return extra.length ? [...base, ...extra] : base;
}

function hasAppAccess(userRole) {
  return (ROLE_RANK[userRole?.role] || 0) >= ROLE_RANK.agent;
}

function canViewLogs(userRole) {
  return LOG_ROLES.includes(userRole?.role);
}

const SYSTEM_ADMIN_USERNAMES = new Set(["raymond", "mark"]);
const IMPERSONATE_USERNAMES = new Set(["raymond"]);

function canManageAppUsers(username) {
  return SYSTEM_ADMIN_USERNAMES.has(String(username || "").trim().toLowerCase());
}

function canImpersonateUsers(username) {
  return IMPERSONATE_USERNAMES.has(String(username || "").trim().toLowerCase());
}

const LEAVE_APPROVERS = ["mark", "raymond", "phoebe"];
const EXECUTIVE_APPROVERS = LEAVE_APPROVERS;

function canApproveLoanRequest(username) {
  return EXECUTIVE_APPROVERS.includes(String(username || "").trim().toLowerCase());
}

function canViewLoanRequests(username) {
  return canApproveLoanRequest(username);
}

/**
 * Leave approval: routes through perm() so it can be controlled in Access Control.
 * Default: named executives (mark/raymond/phoebe) OR any hr/admin/ceo role user.
 * Accepts (username) or (username, userRole) to support both call sites.
 */
function canApproveLeave(username, userRole) {
  const uname = String(username || "").trim().toLowerCase();
  // Named executive shortcut — always allowed regardless of Access Control
  if (LEAVE_APPROVERS.includes(uname)) return true;
  // Route through perm() so Access Control can grant/deny this for any role
  if (userRole) {
    return perm("approveLeave", userRole, () => {
      const role = normalizeRole(userRole?.role || "");
      return ["hr", "admin", "ceo"].includes(role);
    });
  }
  return false;
}

function canManageSessions(username) {
  return canManageAppUsers(username);
}

function canAccessEmployee(userRole, emp) {
  if (!emp) return false;
  if (ALL_UNIT_ROLES.includes(userRole.role)) return true;
  if (MANAGE_ROLES.includes(userRole.role)) return true;
  if (COMPANY_EMPLOYEE_ROLES.includes(userRole.role)) return true;
  if (userRole.role === "op") {
    return employeeInOpUnitScope(userRole, emp);
  }
  if (userRole.role === "checker") {
    return Boolean(userRole.employeeId && emp.id === userRole.employeeId);
  }
  if (userRole.role === "tl") {
    const leadTeams = userRole.leadTeams || [];
    if (leadTeams.length) {
      return employeeInLedTeamScope(userRole, emp);
    }
    return Boolean(userRole.employeeId && emp.id === userRole.employeeId);
  }
  if (COMPANY_EMPLOYEE_ROLES.includes(userRole.role)) return true;
  if (SELF_SCOPED_ROLES.includes(userRole.role) || userRole.role === "agent") {
    return employeeInLedTeamScope(userRole, emp);
  }
  return false;
}

function canAccessUnit(userRole, unit) {
  if (!unit) return true;
  if (ALL_UNIT_ROLES.includes(userRole.role)) return true;
  if (userRole.role === "op") {
    const units = opUnitSet(userRole);
    if (!units.size) return true;
    return units.has(unit);
  }
  if (userRole.role === "checker") {
    return checkerUnitSet(userRole).has(unit);
  }
  return false;
}

function canEditAttendance(userRole) {
  return perm("editAttendance", userRole, () => MANAGE_ROLES.includes(userRole.role));
}

function canUseNullAttendanceStatus(userRole) {
  const username = String(userRole?.username || "").trim().toLowerCase();
  if (username === "raymond") return true;
  return perm("useNullAttendanceStatus", userRole, () => false);
}

function canViewTransportControls(userRole) {
  return perm("viewTransportControls", userRole, () => MANAGE_ROLES.includes(userRole?.role));
}

function canViewPayroll(userRole) {
  return perm("viewPayroll", userRole, () => ROLE_RANK[userRole?.role] >= ROLE_RANK.finance);
}

function canViewBonusesDeductions(userRole) {
  return perm("viewBonuses", userRole, () => BONUS_VIEW_ROLES.includes(userRole?.role));
}

function canTransferBonus(userRole) {
  return perm("transferBonus", userRole, () => {
    if (MANAGE_ROLES.includes(userRole?.role)) return true;
    return TRANSFER_BONUS_ROLES.includes(userRole?.role);
  });
}

function canManageAll(userRole) {
  return canManageEmployees(userRole);
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
  if (userRole.role === "op") {
    const units = opUnitSet(userRole);
    if (!units.size) return employees;
    return employees.filter((e) => units.has(e.unit));
  }
  if (userRole.role === "checker") {
    if (!userRole.employeeId) return [];
    return employees.filter((e) => e.id === userRole.employeeId);
  }
  if (userRole.role === "tl") {
    const leadTeams = userRole.leadTeams || [];
    const extraTeams = userRole.teamDashboardExtraTeams || [];
    const { teamsMatch } = require("./team-names");
    if (leadTeams.length || extraTeams.length) {
      return employees.filter((e) => {
        if (e.id === userRole.employeeId) return true;
        if (
          leadTeams.some(
            (lt) => (!lt.unit || e.unit === lt.unit) && teamsMatch(e.team, lt.team)
          )
        ) {
          return true;
        }
        return extraTeams.some(
          (xt) => (!xt.unit || e.unit === xt.unit) && teamsMatch(e.team, xt.team)
        );
      });
    }
    // Home-team fallback (same as daily / RPM weekly) when Org leadTeams is empty
    if (userRole.team) {
      return employees.filter(
        (e) =>
          e.id === userRole.employeeId ||
          (e.team && teamsMatch(e.team, userRole.team) && (!userRole.unit || e.unit === userRole.unit))
      );
    }
    if (!userRole.employeeId) return [];
    return employees.filter((e) => e.id === userRole.employeeId);
  }
  if (COMPANY_EMPLOYEE_ROLES.includes(userRole.role)) return employees;
  if (SELF_SCOPED_ROLES.includes(userRole.role) || userRole.role === "agent") {
    if (!userRole.employeeId) return [];
    return employees.filter((e) => employeeInLedTeamScope(userRole, e));
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
  let filtered = deductions.filter((d) => scope.has(d.employeeId));
  if (!canViewTlOpBonusTransfers(userRole)) {
    filtered = filtered.filter((d) => d.type !== "Bonus from TL / OP");
  }
  return filtered;
}

function canViewTlOpBonusTransfers(userRole) {
  return perm("viewTlOpBonusTransfers", userRole, () =>
    ["tl", "op", "hr", "admin", "ceo", "rtm"].includes(userRole?.role)
  );
}

function canViewBonusTransferSource(userRole) {
  return perm("viewBonusTransferSource", userRole, () => MANAGE_ROLES.includes(userRole?.role));
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
      canAccessEmployee(userRole, recipient)
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
  return perm("submitBonusRequest", userRole, () => BONUS_REQUEST_SUBMIT_ROLES.includes(userRole?.role));
}

function canApproveBonusRequest(userRole) {
  return perm("approveBonusRequest", userRole, () =>
    MANAGE_ROLES.includes(userRole?.role) || ADMIN_ROLES.includes(userRole?.role)
  );
}

function canAccessCostsFull(userRole, username) {
  return perm("accessCostsFull", userRole, () => {
    const u = String(username || userRole?.username || "").trim().toLowerCase();
    if (FINANCE_ACCESS_USERS.includes(u)) return true;
    return userRole?.role === "finance" || ADMIN_ROLES.includes(userRole?.role);
  });
}

function canSubmitExpense(userRole, username) {
  return perm("submitExpense", userRole, () => {
    if (canAccessCostsFull(userRole, username)) return true;
    return userRole?.role === "hr" || userRole?.role === "rtm";
  });
}

function canViewSales(userRole) {
  return perm("viewSales", userRole, () => {
    if (normalizeRole(userRole?.role) === "checker") return false;
    return hasAppAccess(userRole);
  });
}

function canViewSalesThisMonth(userRole) {
  // Agents/TL are restricted to "today only" in RPM sales logs unless explicitly allowed.
  return perm("viewSalesThisMonth", userRole, () =>
    ["op", "admin", "ceo", "hr", "rtm", "quality"].includes(normalizeRole(userRole?.role))
  );
}

function canViewSalesLogFilters(userRole) {
  return perm("viewSalesLogFilters", userRole, () =>
    ["op", "admin", "ceo", "hr", "rtm", "quality"].includes(normalizeRole(userRole?.role))
  );
}

function canViewSalesRankings(userRole) {
  return perm("viewSalesRankings", userRole, () =>
    ["op", "admin", "ceo", "hr", "rtm", "quality"].includes(normalizeRole(userRole?.role))
  );
}

function canSubmitSales(userRole) {
  return perm("submitSales", userRole, () => {
    const role = normalizeRole(userRole?.role);
    return ["agent", "tl", "op", "admin", "ceo", "hr", "rtm", "quality", "public_relations"].includes(role);
  });
}

function canWorkQualityTicket(userRole) {
  return perm("workQualityTicket", userRole, () => {
    const role = normalizeRole(userRole?.role);
    if (["quality", "rtm", "admin", "ceo", "public_relations"].includes(role)) return true;
    try {
      const store = require("./data-store");
      const live = normalizeRole(
        store.getAppUserRoleForEmployee(userRole?.employeeId) ||
          store.getAppUserRoleForEmployee(userRole?.username)
      );
      return ["quality", "rtm", "admin", "ceo", "public_relations"].includes(live);
    } catch {
      return false;
    }
  });
}

function canEditSale(userRole) {
  return perm("editSales", userRole, () => {
    const role = userRole?.role;
    return ["hr", "admin", "ceo", "quality", "rtm", "public_relations"].includes(role);
  });
}

function canDeleteSales(userRole) {
  return perm("deleteSales", userRole, () => {
    const role = normalizeRole(userRole?.role);
    return ["admin", "rtm"].includes(role);
  });
}

function canReassignSaleLead(userRole) {
  return perm("reassignSaleLead", userRole, () => {
    const role = normalizeRole(userRole?.role);
    return ["admin", "rtm", "ceo"].includes(role);
  });
}

function canViewSale(userRole) {
  return perm("viewSale", userRole, () => {
    if (normalizeRole(userRole?.role) === "checker") return false;
    return hasAppAccess(userRole);
  });
}

function canOpenQualityTicketOnSale(userRole, sale) {
  if (canWorkQualityTicket(userRole)) return true;
  const role = normalizeRole(userRole?.role);
  if (!["op", "tl"].includes(role)) return false;
  const assignVerifier = sale?.formData?.assignVerifier || sale?.assignVerifier;
  return Boolean(
    assignVerifier && userRole?.employeeId && String(userRole.employeeId) === String(assignVerifier)
  );
}

function canManageHolidayActivation(userRole) {
  return ADMIN_ROLES.includes(normalizeRole(userRole?.role || userRole));
}

const ORG_STRUCTURE_ROLES = ["admin", "ceo", "hr"];
const NOTES_VIEW_ROLES = ["hr", "admin", "ceo"];
const NOTES_WRITE_ROLES = ["tl", "op", "quality", "hr", "admin", "ceo", "rtm"];
const QUALITY_NOTES_VIEW_ROLES = ["hr", "admin", "ceo", "quality", "rtm", "tl", "op"];
const QUALITY_NOTES_WRITE_ROLES = ["quality", "tl", "op", "hr", "admin", "ceo", "rtm"];
const EQUIPMENT_ALL_ROLES = ["it", "hr", "admin", "ceo"];
const EQUIPMENT_UNIT_ROLES = ["op"];
const DASHBOARD_PAYROLL_ROLES = ["finance", "hr", "admin", "ceo"];
const DASHBOARD_FULL_ROLES = ["tl", "op", "hr", "admin", "ceo", "finance", "rtm", "quality"];

function canManageOrgStructure(userRole) {
  return perm("manageOrgStructure", userRole, () => ORG_STRUCTURE_ROLES.includes(userRole?.role));
}

function canViewOrgFull(userRole) {
  return perm("viewOrgFull", userRole, () =>
    MANAGE_ROLES.includes(userRole?.role) ||
    ALL_UNIT_ROLES.includes(userRole?.role) ||
    ["rtm", "quality"].includes(userRole?.role)
  );
}

function canViewOrgScoped(userRole) {
  return ["agent", "office_assistant", "tl", "op"].includes(userRole?.role);
}

function canViewOrgAgentScope(userRole) {
  return canViewOrgScoped(userRole);
}

function canManageEmployees(userRole) {
  return perm("manageEmployees", userRole, () => MANAGE_ROLES.includes(userRole?.role));
}

function canEditEmployeeRecord(userRole, emp) {
  if (!emp) return false;
  return perm("editEmployeeRecord", userRole, () => {
    if (MANAGE_ROLES.includes(userRole?.role)) return true;
    if (userRole?.role === "tl" || userRole?.role === "op") return false;
    return false;
  });
}

function canViewEmployeeNotes(userRole) {
  return perm("viewEmployeeNotes", userRole, () => NOTES_VIEW_ROLES.includes(userRole?.role));
}

function canWriteEmployeeNotes(userRole) {
  return perm("writeEmployeeNotes", userRole, () => NOTES_WRITE_ROLES.includes(userRole?.role));
}

function canViewQualityNotes(userRole) {
  return perm("viewQualityNotes", userRole, () => QUALITY_NOTES_VIEW_ROLES.includes(userRole?.role));
}

function canWriteQualityNotes(userRole) {
  return perm("writeQualityNotes", userRole, () => QUALITY_NOTES_WRITE_ROLES.includes(userRole?.role));
}

function canManageQualityNote(userRole, note, username) {
  if (!note) return false;
  const role = normalizeRole(userRole?.role);
  if (["hr", "admin", "ceo"].includes(role)) return true;
  if (String(note.authorUsername || "").toLowerCase() === String(username || "").toLowerCase()) {
    return true;
  }
  return false;
}

function canViewEmployeeDirectory(userRole) {
  return perm("viewEmployeeDirectory", userRole, () => {
    if (normalizeRole(userRole?.role) === "checker") return false;
    return hasAppAccess(userRole);
  });
}

function canOpenEmployeeCard(userRole, emp) {
  if (!emp) return false;
  if (canManageEmployees(userRole)) return true;
  if (userRole?.employeeId && emp.id === userRole.employeeId) return true;
  if (userRole?.role === "tl" || userRole?.role === "op") return false;
  if (SELF_SCOPED_ROLES.includes(userRole?.role)) return false;
  return canAccessEmployee(userRole, emp);
}

function canExportSales(userRole) {
  if (!userRole) return false;
  return perm("exportSales", userRole, () => {
    return ["quality", "rtm", "ceo", "admin"].includes(normalizeRole(userRole.role));
  });
}

function canApproveSales(userRole) {
  return perm("approveSales", userRole, () => {
    const role = normalizeRole(userRole?.role);
    return ["quality", "rtm", "admin", "ceo", "hr"].includes(role);
  });
}

function canViewDashboardUnits(userRole) {
  return perm("viewDashboardUnits", userRole, () =>
    ["hr", "rtm", "admin", "ceo", "quality"].includes(userRole?.role)
  );
}

function canViewTeamDashboard(userRole) {
  return perm("viewTeamDashboard", userRole, () => {
    if (normalizeRole(userRole?.role) === "checker") return true;
    return canViewSales(userRole);
  });
}

function canViewRpmWeeklyDashboard(userRole) {
  return perm("viewRpmWeeklyDashboard", userRole, () => {
    const r = userRole?.role;
    if (["admin", "rtm", "quality", "op", "tl"].includes(r)) return true;
    // Dual-role TL (agent login with leadTeams)
    return Array.isArray(userRole?.leadTeams) && userRole.leadTeams.length > 0;
  });
}

function canEditRpmWeeklyTargets(userRole) {
  return perm("editRpmWeeklyTargets", userRole, () =>
    ["admin", "rtm", "quality", "op"].includes(userRole?.role)
  );
}

function employeeHasChecksSubmitFlag(userRole) {
  return userRole?.canSubmitChecksQFeedback === true;
}

function canSubmitRpmChecks(userRole) {
  return perm("submitRpmChecks", userRole, () => {
    const r = userRole?.role;
    if (["admin", "ceo", "rtm", "quality", "tl", "op", "checker"].includes(r)) return true;
    if (hasCloserTeamAssignment(userRole)) return true;
    return employeeHasChecksSubmitFlag(userRole);
  });
}

function canSubmitRpmQFeedback(userRole) {
  return perm("submitRpmQFeedback", userRole, () => {
    const r = userRole?.role;
    if (["admin", "ceo", "rtm", "quality", "tl", "op"].includes(r)) return true;
    if (hasCloserTeamAssignment(userRole)) return true;
    return employeeHasChecksSubmitFlag(userRole);
  });
}

function canEditRpmChecks(userRole) {
  return perm("editRpmChecks", userRole, () =>
    ["admin", "ceo", "rtm", "quality", "tl", "checker"].includes(userRole?.role)
  );
}

function canEditRpmQFeedback(userRole) {
  return perm("editRpmQFeedback", userRole, () =>
    ["admin", "ceo", "op", "rtm", "quality", "tl"].includes(userRole?.role)
  );
}

function canViewRpmChecksDashboard(userRole) {
  return perm("viewRpmChecksDashboard", userRole, () => {
    if (canSubmitRpmChecks(userRole) || canSubmitRpmQFeedback(userRole)) return true;
    const r = userRole?.role;
    return (
      ["admin", "ceo", "rtm", "quality", "tl", "op", "checker"].includes(r) ||
      hasLeadTeamAssignment(userRole) ||
      hasCloserTeamAssignment(userRole)
    );
  });
}

function canViewRpmChecks(userRole) {
  return perm("viewRpmChecks", userRole, () => {
    if (canSubmitRpmChecks(userRole) || canViewRpmChecksDashboard(userRole)) return true;
    const r = userRole?.role;
    return (
      ["admin", "ceo", "rtm", "quality", "tl", "op", "checker"].includes(r) ||
      hasLeadTeamAssignment(userRole) ||
      hasCloserTeamAssignment(userRole)
    );
  });
}

function canViewRpmQFeedback(userRole) {
  return perm("viewRpmQFeedback", userRole, () => {
    if (canSubmitRpmQFeedback(userRole) || canViewRpmChecksDashboard(userRole)) return true;
    const r = userRole?.role;
    return (
      ["admin", "ceo", "rtm", "quality", "tl", "op"].includes(r) ||
      hasLeadTeamAssignment(userRole) ||
      hasCloserTeamAssignment(userRole)
    );
  });
}

/** Analysis tab: OP / TL / RTM / Quality / HR (+ admin / CEO). */
function canViewRpmQFeedbackAnalysis(userRole) {
  return perm("viewRpmQFeedbackAnalysis", userRole, () => {
    const r = normalizeRole(userRole?.role);
    return ["op", "tl", "rtm", "quality", "hr", "admin", "ceo"].includes(r);
  });
}

function canImportRpmSaleFromCheck(userRole) {
  return perm("importRpmSaleFromCheck", userRole, () => {
    if (!canSubmitSales(userRole)) return false;
    const r = userRole?.role;
    return (
      ["admin", "ceo", "rtm", "quality", "tl", "op"].includes(r) ||
      hasCloserTeamAssignment(userRole)
    );
  });
}

function canViewRpmCheckDuplicates(userRole) {
  return perm("viewRpmCheckDuplicates", userRole, () =>
    ["admin", "rtm"].includes(userRole?.role)
  );
}

function canIssueEquipment(userRole) {
  return perm("issueEquipment", userRole, () => EQUIPMENT_ALL_ROLES.includes(userRole?.role));
}

function canViewEquipmentAll(userRole) {
  return perm("viewEquipmentAll", userRole, () => EQUIPMENT_ALL_ROLES.includes(userRole?.role));
}

function canViewEquipmentUnit(userRole) {
  return perm("viewEquipmentUnit", userRole, () => userRole?.role === "op");
}

function canViewEquipment(userRole) {
  if (canViewEquipmentAll(userRole) || canViewEquipmentUnit(userRole)) return true;
  return perm("viewEquipment", userRole, () => {
    if (userRole?.role === "finance") return false;
    return (ROLE_RANK[userRole?.role] || 0) >= ROLE_RANK.agent;
  });
}

function canViewEquipmentInventory(userRole) {
  return canViewEquipmentAll(userRole) || canViewEquipmentUnit(userRole);
}

function canViewEmployeeNationality(userRole, targetEmp) {
  if (targetEmp && userRole?.employeeId && userRole.employeeId === targetEmp.id) return true;
  return perm("viewEmployeeNationality", userRole, () => MANAGE_ROLES.includes(userRole?.role));
}

function canViewEmployeeNationalityGlobal(userRole) {
  return perm("viewEmployeeNationality", userRole, () => MANAGE_ROLES.includes(userRole?.role));
}

function canViewEmployeeCompliance(userRole, targetEmp) {
  if (!targetEmp) return false;
  if (userRole?.employeeId && userRole.employeeId === targetEmp.id) return true;
  return perm("viewEmployeeCompliance", userRole, () => MANAGE_ROLES.includes(userRole?.role));
}

function canViewEmployeeComplianceFilters(userRole) {
  return perm("viewEmployeeComplianceFilters", userRole, () => MANAGE_ROLES.includes(userRole?.role));
}

function canViewReports(userRole) {
  return perm("viewReports", userRole, () =>
    ["finance", "hr", "admin", "ceo"].includes(userRole?.role)
  );
}

function canSettingsThemeUnlocks(userRole) {
  return perm("settingsThemeUnlocks", userRole, () => MANAGE_ROLES.includes(userRole?.role));
}

function canViewAnalytics(userRole) {
  return perm("viewAnalytics", userRole, () =>
    ["finance", "hr", "admin", "ceo"].includes(userRole?.role)
  );
}

function canManageAppUsersPerm(userRole, username) {
  const u = String(username || userRole?.username || "").trim().toLowerCase();
  return perm("manageAppUsers", userRole, () => canManageAppUsers(u));
}

function canViewSalesAdmin(userRole) {
  return perm("viewSalesAdmin", userRole, () => canManageSalesFieldPermissions(userRole));
}

function canViewSettingsSection(userRole, section) {
  const sectionKeys = {
    holidays: "settingsHolidays",
    session: "settingsSession",
    managingUnits: "settingsManagingUnits",
    hideOut: "settingsHideOut",
    sync: "settingsSync",
    theme: "settingsTheme",
    themeUnlocks: "settingsThemeUnlocks",
    profilePhoto: "settingsProfilePhoto",
  };
  const key = sectionKeys[section];
  if (!key) return hasAppAccess(userRole);
  return perm(key, userRole, () => {
    const role = userRole?.role;
    if (section === "holidays") return MANAGE_ROLES.includes(role);
    if (section === "managingUnits") return MANAGE_ROLES.includes(role);
    if (section === "session") return MANAGE_ROLES.includes(role) || ADMIN_ROLES.includes(role);
    if (section === "hideOut") return MANAGE_ROLES.includes(role);
    if (section === "sync") return true;
    if (section === "theme") return true;
    if (section === "themeUnlocks") return MANAGE_ROLES.includes(role);
    if (section === "profilePhoto") return Boolean(userRole?.employeeId);
    return hasAppAccess(userRole);
  });
}

function canViewAgentPayslip(userRole, emp, adjustment) {
  if (!userRole || !emp) return false;
  if (canViewPayroll(userRole) && canAccessEmployee(userRole, emp)) return true;
  if (
    (userRole.role === "agent" || userRole.role === "office_assistant") &&
    userRole.employeeId === emp.id &&
    adjustment?.payslipVisibleToAgent === true
  ) {
    return true;
  }
  return false;
}

function canGrantSalesVisibility(userRole) {
  return perm("grantSalesVisibility", userRole, () =>
    ["op", "admin", "ceo", "hr", "rtm"].includes(userRole?.role)
  );
}

function canManageSalesFieldPermissions(userRole) {
  return perm("manageSalesFieldPermissions", userRole, () =>
    ["admin", "ceo", "rtm"].includes(userRole?.role)
  );
}

function canViewDashboardPayroll(userRole) {
  return perm("viewDashboardPayroll", userRole, () => DASHBOARD_PAYROLL_ROLES.includes(userRole?.role));
}

function canViewDashboardFull(userRole) {
  return perm("viewDashboardFull", userRole, () => DASHBOARD_FULL_ROLES.includes(userRole?.role));
}

function canUseEmployeeFilters(userRole) {
  return perm("useEmployeeFilters", userRole, () => MANAGE_ROLES.includes(userRole?.role));
}

function canAddEmployee(userRole) {
  return perm("addEmployee", userRole, () => MANAGE_ROLES.includes(userRole?.role));
}

function canManageAccessControl(userRole) {
  return perm("manageAccessControl", userRole, () => ADMIN_ROLES.includes(userRole?.role));
}

function canManageTrainingProgram(userRole) {
  return perm("manageTrainingProgram", userRole, () => MANAGE_ROLES.includes(userRole?.role));
}

function canViewTrainingPayPreview(userRole) {
  return perm("viewTrainingPayPreview", userRole, () =>
    MANAGE_ROLES.includes(userRole?.role) || userRole?.role === "finance"
  );
}

function canApproveTrainingPayslip(userRole) {
  return perm("approveTrainingPayslip", userRole, () =>
    MANAGE_ROLES.includes(userRole?.role) || userRole?.role === "finance"
  );
}

function canManageResignationPayRules(userRole) {
  return perm("manageResignationPayRules", userRole, () => MANAGE_ROLES.includes(userRole?.role));
}

/** HS-2 company switcher, org, payroll, attendance — CEO / Admin / HR only.
 *  OP / TL / agent cannot receive this via Access Control (Hangup OP must stay on their unit). */
const HS2_MANAGE_DENIED_ROLES = new Set(["op", "tl", "agent"]);

function canManageHs2Company(userRole) {
  const role = normalizeRole(userRole?.role);
  if (HS2_MANAGE_DENIED_ROLES.has(role)) return false;
  return perm("manageHs2Company", userRole, () =>
    ["admin", "ceo", "hr"].includes(role)
  );
}

/** HS-2 company context: managers who can switch, or native HS-2 staff (unit → hs2). */
function canAccessHs2CompanyContext(userRole) {
  const companyCtx = require("./company-context");
  return canManageHs2Company(userRole) || companyCtx.getCompanyForUser(userRole) === "hs2";
}

function canManageCompanies(userRole) {
  return perm("manageCompanies", userRole, () =>
    ["admin", "ceo"].includes(normalizeRole(userRole?.role))
  );
}

/** HS-2 unit in sales log / quality work — management + Quality */
function canSeeHs2InSales(userRole) {
  return perm("seeHs2InSales", userRole, () =>
    ["admin", "ceo", "hr", "quality"].includes(normalizeRole(userRole?.role))
  );
}

const MEETING_REVIEW_ROLES = ["admin", "ceo", "hr"];

function canViewMeetingRequests(userRole) {
  return perm("viewMeetingRequests", userRole, () =>
    MEETING_REVIEW_ROLES.includes(normalizeRole(userRole?.role)) || Boolean(userRole?.employeeId)
  );
}

function canSubmitMeetingRequest(userRole) {
  return perm("submitMeetingRequest", userRole, () => Boolean(userRole?.employeeId));
}

function canReviewMeetingRequest(userRole) {
  return perm("reviewMeetingRequest", userRole, () => MEETING_REVIEW_ROLES.includes(normalizeRole(userRole?.role)));
}

function canViewRequestFilters(userRole) {
  return perm("viewRequestFilters", userRole, () =>
    ["hr", "admin", "ceo", "op", "tl", "rtm", "finance"].includes(normalizeRole(userRole?.role))
  );
}

function canViewItRequestFilters(userRole) {
  return perm("viewItRequestFilters", userRole, () =>
    ["hr", "admin", "ceo", "op", "it", "rtm"].includes(normalizeRole(userRole?.role))
  );
}

function canViewInterviews(userRole) {
  return perm("viewInterviews", userRole, () =>
    ["hr", "admin", "ceo", "op", "tl", "quality"].includes(normalizeRole(userRole?.role))
  );
}

function canEditInterview(userRole) {
  return perm("editInterview", userRole, () =>
    ["hr", "admin", "ceo", "quality"].includes(normalizeRole(userRole?.role))
  );
}

function canDeleteInterview(userRole) {
  return perm("deleteInterview", userRole, () =>
    ["hr", "admin", "ceo"].includes(normalizeRole(userRole?.role))
  );
}

function canViewTraining(userRole) {
  return perm("viewTraining", userRole, () =>
    ["hr", "admin", "ceo", "op", "tl", "quality"].includes(normalizeRole(userRole?.role))
  );
}

function canEditTraining(userRole) {
  return perm("editTraining", userRole, () =>
    ["hr", "admin", "ceo", "op", "tl"].includes(normalizeRole(userRole?.role))
  );
}

function canViewRules(userRole) {
  return perm("viewRules", userRole, () => hasAppAccess(userRole));
}

function canAccessRulesCompany(userRole, company) {
  const normalizedCompany = String(company || "hangup").toLowerCase();
  if (normalizedCompany === "hs2" || normalizedCompany === "hs-2") {
    const companyCtx = require("./company-context");
    if (companyCtx.getCompanyForUser(userRole) === "hs2") return true;
    return canManageHs2Company(userRole);
  }
  return true;
}

function canEditRules(userRole) {
  return perm("editRules", userRole, () => ["admin", "ceo", "hr"].includes(normalizeRole(userRole?.role)));
}

function canViewAnnouncements(userRole) {
  return perm("viewAnnouncements", userRole, () => hasAppAccess(userRole));
}

function canEditAnnouncements(userRole) {
  return perm("editAnnouncements", userRole, () =>
    ["admin", "ceo", "hr", "rtm"].includes(normalizeRole(userRole?.role))
  );
}

function canViewCoaching(userRole) {
  return perm("viewCoaching", userRole, () => {
    const role = normalizeRole(userRole?.role);
    if (["tl", "op", "quality", "hr", "rtm", "admin", "ceo"].includes(role)) return true;
    if (hasCloserTeamAssignment(userRole) || hasLeadTeamAssignment(userRole)) return true;
    return Boolean(userRole?.employeeId);
  });
}

function canSubmitCoaching(userRole) {
  return perm("submitCoaching", userRole, () => {
    const role = normalizeRole(userRole?.role);
    if (["tl", "op", "quality", "hr", "admin", "ceo"].includes(role)) return true;
    if (hasCloserTeamAssignment(userRole) || hasLeadTeamAssignment(userRole)) return true;
    return false;
  });
}

function canViewCoachingSecret(userRole) {
  return perm("viewCoachingSecret", userRole, () =>
    ["hr", "quality", "admin", "ceo"].includes(normalizeRole(userRole?.role))
  );
}

function canDeleteCoaching(userRole) {
  return ["admin", "ceo"].includes(normalizeRole(userRole?.role));
}

function canEditCoachingDateTime(userRole) {
  return ["admin", "ceo"].includes(normalizeRole(userRole?.role));
}

const IT_REQUEST_ROLES = ["it", "admin", "ceo"];
const IT_REQUEST_ASSIGN_ROLES = ["it", "admin", "ceo", "rtm"];

function hasItAccess(userRole) {
  return userRole?.isIt === true || normalizeRole(userRole?.role) === "it";
}

function canViewItRequests(userRole) {
  return perm("viewItRequests", userRole, () =>
    IT_REQUEST_ROLES.includes(normalizeRole(userRole?.role)) || hasItAccess(userRole) || Boolean(userRole?.employeeId)
  );
}

function canSubmitItRequest(userRole) {
  return perm("submitItRequest", userRole, () => Boolean(userRole?.employeeId));
}

function canAssignItRequest(userRole) {
  return perm("assignItRequest", userRole, () => IT_REQUEST_ASSIGN_ROLES.includes(normalizeRole(userRole?.role)) || hasItAccess(userRole));
}

function canResolveItRequest(userRole) {
  return perm("resolveItRequest", userRole, () => IT_REQUEST_ROLES.includes(normalizeRole(userRole?.role)) || hasItAccess(userRole));
}

function canDeleteItRequest(userRole) {
  // Admin and CEO by role; OR any user marked as IT (isIt flag) in their profile.
  // Does NOT include plain "it" role alone — must be admin/ceo OR explicitly flagged is_it.
  return perm("deleteItRequest", userRole, () =>
    ["admin", "ceo"].includes(normalizeRole(userRole?.role)) || hasItAccess(userRole)
  );
}

function localYearMonth(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

let orgTeamsCache = null;
let orgTeamsCacheAt = 0;
let unitOpsCache = null;
let unitOpsCacheAt = 0;
let unitCheckersCache = null;
let unitCheckersCacheAt = 0;
const ORG_TEAMS_CACHE_MS = 15_000;

async function loadOrgTeamsForScope() {
  const now = Date.now();
  if (orgTeamsCache && now - orgTeamsCacheAt < ORG_TEAMS_CACHE_MS) return orgTeamsCache;
  try {
    const hrmsRepo = require("./hrms-repo");
    orgTeamsCache = await hrmsRepo.readOrgTeams();
  } catch {
    orgTeamsCache = [];
  }
  orgTeamsCacheAt = now;
  return orgTeamsCache;
}

async function loadUnitOpsForScope() {
  const now = Date.now();
  if (unitOpsCache && now - unitOpsCacheAt < ORG_TEAMS_CACHE_MS) return unitOpsCache;
  try {
    unitOpsCache = await require("./team-tls-repo").readAllUnitOps();
  } catch {
    unitOpsCache = {};
  }
  unitOpsCacheAt = now;
  return unitOpsCache;
}

async function loadUnitCheckersForScope() {
  const now = Date.now();
  if (unitCheckersCache && now - unitCheckersCacheAt < ORG_TEAMS_CACHE_MS) return unitCheckersCache;
  try {
    unitCheckersCache = await require("./team-tls-repo").readAllUnitCheckers();
  } catch {
    unitCheckersCache = {};
  }
  unitCheckersCacheAt = now;
  return unitCheckersCache;
}

function invalidateOrgTeamsCache() {
  orgTeamsCache = null;
  orgTeamsCacheAt = 0;
  unitOpsCache = null;
  unitOpsCacheAt = 0;
  unitCheckersCache = null;
  unitCheckersCacheAt = 0;
}

async function enrichUserRoleWithOrgTeams(userRole, employees, appUser = null) {
  const [orgTeams, unitOps, unitCheckers] = await Promise.all([
    loadOrgTeamsForScope(),
    loadUnitOpsForScope(),
    loadUnitCheckersForScope(),
  ]);
  const enriched = enrichUserRole(userRole, employees, appUser, orgTeams);
  attachOpUnits(enriched, unitOps);
  return attachCheckerUnits(enriched, unitCheckers);
}

module.exports = {
  ROLE_RANK,
  SELF_SCOPED_ROLES,
  COMPANY_EMPLOYEE_ROLES,
  resolveUserRole,
  effectiveLoginRole,
  enrichUserRole,
  enrichUserRoleWithOrgTeams,
  loadOrgTeamsForScope,
  invalidateOrgTeamsCache,
  buildLeadTeams,
  attachLeadTeams,
  attachOpUnits,
  attachCheckerUnits,
  employeeInOpUnitScope,
  employeeInCheckerUnitScope,
  hasCheckerUnitAssignment,
  buildCloserTeams,
  isLedTeamMember,
  isCloserTeamMember,
  employeeInLedTeamScope,
  employeeInCloserTeamScope,
  isActiveAgentEmployee,
  isOnBehalfAgentTarget,
  hasLeadTeamAssignment,
  hasCloserTeamAssignment,
  uniqueCloserTeamCount,
  usesCloseTeamsDashboardKpi,
  canSubmitLeaveOnBehalf,
  canSubmitItOnBehalf,
  employeesForLeaveOnBehalf,
  employeesForItOnBehalf,
  employeesForCoachingOnBehalf,
  employeesMatchingTeamEntries,
  filterEmployeesForTeamDashboard,
  normalizeRole,
  hasAppAccess,
  canViewLogs,
  canManageAppUsers,
  canImpersonateUsers,
  canApproveLeave,
  canManageSessions,
  LEAVE_APPROVERS,
  EXECUTIVE_APPROVERS,
  canApproveLoanRequest,
  canViewLoanRequests,
  SYSTEM_ADMIN_USERNAMES,
  SYSTEM_ADMIN_USERNAME: "raymond",
  canAccessUnit,
  canAccessEmployee,
  canEditAttendance,
  canUseNullAttendanceStatus,
  canViewTransportControls,
  canViewPayroll,
  canViewBonusesDeductions,
  canTransferBonus,
  canGrantTransferBonus,
  canManageAll,
  canManageHolidayActivation,
  canManageOrgStructure,
  canViewOrgFull,
  canViewOrgAgentScope,
  canManageEmployees,
  canEditEmployeeRecord,
  canViewEmployeeNotes,
  canWriteEmployeeNotes,
  canViewQualityNotes,
  canWriteQualityNotes,
  canManageQualityNote,
  canViewEmployeeDirectory,
  canOpenEmployeeCard,
  canExportSales,
  canApproveSales,
  canViewDashboardUnits,
  canViewTeamDashboard,
  canViewRpmWeeklyDashboard,
  canEditRpmWeeklyTargets,
  canSubmitRpmChecks,
  canSubmitRpmQFeedback,
  canEditRpmChecks,
  canEditRpmQFeedback,
  canViewRpmChecks,
  canViewRpmQFeedback,
  canViewRpmQFeedbackAnalysis,
  canViewRpmChecksDashboard,
  canViewRpmCheckDuplicates,
  canImportRpmSaleFromCheck,
  canIssueEquipment,
  canViewEquipment,
  canViewSettingsSection,
  canViewAgentPayslip,
  canGrantSalesVisibility,
  canManageSalesFieldPermissions,
  canViewDashboardPayroll,
  canViewDashboardFull,
  canUseEmployeeFilters,
  canAddEmployee,
  canManageAccessControl,
  canManageTrainingProgram,
  canViewTrainingPayPreview,
  canApproveTrainingPayslip,
  canManageResignationPayRules,
  canManageHs2Company,
  canAccessHs2CompanyContext,
  canManageCompanies,
  canSeeHs2InSales,
  canViewItRequests,
  canSubmitItRequest,
  canAssignItRequest,
  canResolveItRequest,
  canDeleteItRequest,
  canViewMeetingRequests,
  canSubmitMeetingRequest,
  canReviewMeetingRequest,
  canViewRequestFilters,
  canViewItRequestFilters,
  canViewInterviews,
  canEditInterview,
  canDeleteInterview,
  canViewTraining,
  canEditTraining,
  localYearMonth,
  ORG_STRUCTURE_ROLES,
  NOTES_VIEW_ROLES,
  NOTES_WRITE_ROLES,
  canSubmitBonusRequest,
  canApproveBonusRequest,
  canReceiveBonusViaRequest,
  isPayslipOnlyBonusRecipient,
  isLeadershipEmployeeId,
  canAccessCostsFull,
  canSubmitExpense,
  canViewSales,
  canViewSalesThisMonth,
  canViewSalesLogFilters,
  canViewSalesRankings,
  canSubmitSales,
  canWorkQualityTicket,
  canOpenQualityTicketOnSale,
  canEditSale,
  canDeleteSales,
  canReassignSaleLead,
  canViewSale,
  PAYSLIP_ONLY_BONUS_ROLES,
  FINANCE_ACCESS_USERS,
  canUploadProfilePhoto,
  filterEmployeesForUser,
  filterBonusesForUser,
  filterDeductionsForUser,
  canViewTlOpBonusTransfers,
  canViewBonusTransferSource,
  scopedEmployeeIds,
  canViewEquipmentAll,
  canViewEquipmentUnit,
  canViewEquipmentInventory,
  canViewEmployeeNationality,
  canViewEmployeeNationalityGlobal,
  canViewEmployeeCompliance,
  canViewEmployeeComplianceFilters,
  canViewReports,
  canSettingsThemeUnlocks,
  canViewAnalytics,
  canManageAppUsersPerm,
  canViewSalesAdmin,
  canViewOrgScoped,
  canViewRules,
  canAccessRulesCompany,
  canEditRules,
  canViewAnnouncements,
  canEditAnnouncements,
  canViewCoaching,
  canSubmitCoaching,
  canViewCoachingSecret,
  canDeleteCoaching,
  canEditCoachingDateTime,
};

// none = no app access. ceo ranks at the top with the same reach as admin.
const ROLE_RANK = {
  none: 0,
  agent: 1,
  office_assistant: 1,
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
  return { role: normalizeRole(role), unit: null, team: null, employeeId: null, username, leadTeams: [] };
}

function buildLeadTeams(employeeId, orgTeams = []) {
  if (!employeeId) return [];
  return (orgTeams || [])
    .filter((t) => t.tlEmployeeId === employeeId)
    .map((t) => ({ unit: t.unit || "", team: t.name || "" }));
}

function attachLeadTeams(userRole, orgTeams = []) {
  userRole.leadTeams = buildLeadTeams(userRole.employeeId, orgTeams);
  return userRole;
}

function enrichUserRole(userRole, employees, appUser = null, orgTeams = []) {
  const u = String(userRole.username || "").trim().toLowerCase();
  if (appUser?.employee_id) {
    const byLink = (employees || []).find((e) => e.id === appUser.employee_id);
    if (byLink) {
      userRole.employeeId = byLink.id;
      userRole.unit = byLink.unit || null;
      userRole.team = byLink.team || null;
      return attachLeadTeams(userRole, orgTeams);
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
  return attachLeadTeams(userRole, orgTeams);
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
  if (COMPANY_EMPLOYEE_ROLES.includes(userRole.role)) return true;
  if (userRole.role === "op") {
    return !userRole.unit || emp.unit === userRole.unit;
  }
  if (userRole.role === "tl") {
    const leadTeams = userRole.leadTeams || [];
    if (leadTeams.length) {
      return employeeInLedTeamScope(userRole, emp);
    }
    return !userRole.team || emp.team === userRole.team;
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
  if (userRole.role === "op") return !userRole.unit || userRole.unit === unit;
  return false;
}

function canEditAttendance(userRole) {
  return perm("editAttendance", userRole, () => MANAGE_ROLES.includes(userRole.role));
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
  if (userRole.role === "op" && userRole.unit) {
    return employees.filter((e) => e.unit === userRole.unit);
  }
  if (userRole.role === "tl") {
    const leadTeams = userRole.leadTeams || [];
    if (leadTeams.length) {
      const { teamsMatch } = require("./team-names");
      return employees.filter((e) => {
        if (e.id === userRole.employeeId) return true;
        return leadTeams.some(
          (lt) => (!lt.unit || e.unit === lt.unit) && teamsMatch(e.team, lt.team)
        );
      });
    }
    if (userRole.team) {
      return employees.filter((e) => e.team === userRole.team);
    }
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
  return perm("viewSales", userRole, () => hasAppAccess(userRole));
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
    return ["quality", "rtm", "admin", "ceo", "public_relations"].includes(role);
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
  return perm("viewSale", userRole, () => hasAppAccess(userRole));
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
  const role = userRole?.role;
  if (["hr", "admin", "ceo"].includes(role)) return true;
  if (role === "quality" && String(note.authorUsername || "").toLowerCase() === String(username || "").toLowerCase()) {
    return true;
  }
  return false;
}

function canViewEmployeeDirectory(userRole) {
  return perm("viewEmployeeDirectory", userRole, () => hasAppAccess(userRole));
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
  return perm("viewTeamDashboard", userRole, () => canViewSales(userRole));
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
    hideOut: "settingsHideOut",
    sync: "settingsSync",
    theme: "settingsTheme",
    profilePhoto: "settingsProfilePhoto",
  };
  const key = sectionKeys[section];
  if (!key) return hasAppAccess(userRole);
  return perm(key, userRole, () => {
    const role = userRole?.role;
    if (section === "holidays") return MANAGE_ROLES.includes(role);
    if (section === "session") return MANAGE_ROLES.includes(role) || ADMIN_ROLES.includes(role);
    if (section === "hideOut") return MANAGE_ROLES.includes(role);
    if (section === "sync") return true;
    if (section === "theme") return true;
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
  return ADMIN_ROLES.includes(userRole?.role);
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

function localYearMonth(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

let orgTeamsCache = null;
let orgTeamsCacheAt = 0;
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

function invalidateOrgTeamsCache() {
  orgTeamsCache = null;
  orgTeamsCacheAt = 0;
}

async function enrichUserRoleWithOrgTeams(userRole, employees, appUser = null) {
  const orgTeams = await loadOrgTeamsForScope();
  return enrichUserRole(userRole, employees, appUser, orgTeams);
}

module.exports = {
  ROLE_RANK,
  SELF_SCOPED_ROLES,
  COMPANY_EMPLOYEE_ROLES,
  resolveUserRole,
  enrichUserRole,
  enrichUserRoleWithOrgTeams,
  loadOrgTeamsForScope,
  invalidateOrgTeamsCache,
  buildLeadTeams,
  attachLeadTeams,
  isLedTeamMember,
  employeeInLedTeamScope,
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
  canManageAppUsersPerm,
  canViewSalesAdmin,
  canViewOrgScoped,
};

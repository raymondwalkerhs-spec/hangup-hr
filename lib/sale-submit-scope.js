/**
 * Role-based agent/closer/unit scope for new sale submission.
 */
const { teamsMatch } = require("./team-names");
const roles = require("./roles");
const { isDialingAgent } = require("./dialing-agents");

const saleProgramAccess = require("./sale-program-access");

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
/** Admin / quality / RTM / CEO — pick any active dialing agent as agent or closer (company-scoped). */
const WIDE_PICKER_ROLES = new Set(["admin", "ceo", "hr", "quality", "rtm"]);

function normalizeRole(role) {
  return String(role || "agent").trim().toLowerCase();
}

function isEligibleSubmitPickerEmployee(e) {
  if (!e) return false;
  try {
    const { isOtherAgentId } = require("./other-agent");
    if (isOtherAgentId(e.id)) return false;
  } catch {
    /* ignore */
  }
  try {
    const employeeIdentity = require("./employee-identity");
    if (employeeIdentity.isDeletedEmployee(e)) return false;
  } catch {
    if (String(e.status || "").trim().toLowerCase() === "deleted") return false;
    if (e.deleted_at) return false;
  }
  try {
    const { isOutStatus, normalizeStatusKey } = require("./employee-status");
    if (isOutStatus(e.status)) return false;
    const key = normalizeStatusKey(e.status);
    return key === "active" || key === "paused" || key === "paused_still_paid";
  } catch {
    const s = String(e.status || "").trim().toLowerCase();
    return !s || s === "active" || s.startsWith("paused");
  }
}

/**
 * Who appears in the sale **agent** picker.
 * Uses employees + org_teams (and optional employees.sales_agent_picker),
 * not app_users.role — login role is RBAC, not dialing eligibility.
 * Override later with: UPDATE employees SET sales_agent_picker = true|false WHERE id = '...';
 */
function isDialingEmployee(e, opts = {}) {
  if (!isEligibleSubmitPickerEmployee(e)) return false;
  return isDialingAgent(e, {
    includeOut: false,
    activeOnly: false,
    teamLeadIds: opts.teamLeadIds,
  });
}

/**
 * Closers = TL / OP / CL leadership.
 * Must not rely only on ID prefixes: many TLs keep dialing IDs (e.g. HS1-05 / Ayla)
 * and are marked via app_users.role, lead_role, or org_teams.tl_employee_id.
 * Live agent-role closers with CL ids stay closers; live HR/Quality/etc. do not.
 */
function isLeadershipCloser(e, opts = {}) {
  if (!isEligibleSubmitPickerEmployee(e)) return false;
  const id = String(e?.id || "");
  const liveRole = String(e?.role || "").trim().toLowerCase();
  const leadRole = String(e?.lead_role || e?.leadRole || "").trim().toUpperCase();
  if (["hr", "quality", "rtm", "it", "finance", "office_assistant"].includes(liveRole)) return false;
  if (/^(TL|CL|OP)/i.test(id)) return true;
  if (["tl", "op", "admin", "ceo"].includes(liveRole)) return true;
  if (["TL", "CL", "OP"].includes(leadRole)) return true;
  const tlIds = opts.teamLeadIds;
  if (tlIds instanceof Set && id && tlIds.has(id)) return true;
  return false;
}

function isCloserCandidate(e, opts = {}) {
  if (isLeadershipCloser(e, opts)) return true;
  return roles.isOnBehalfAgentTarget(e);
}

function teamLeadIdsFromOrgTeams(orgTeams) {
  const ids = new Set();
  for (const t of orgTeams || []) {
    const id = String(t.tlEmployeeId || t.tl_employee_id || "").trim();
    if (id) ids.add(id);
    for (const extra of t.tlEmployeeIds || []) {
      if (extra) ids.add(String(extra).trim());
    }
  }
  return ids;
}

function orgCloserIdsFromTeams(orgTeams) {
  const ids = new Set();
  for (const t of orgTeams || []) {
    for (const id of t.closerEmployeeIds || []) {
      if (id) ids.add(String(id).trim());
    }
  }
  return ids;
}

function closerPickerContext(opts = {}) {
  const orgTeams = opts.orgTeams || [];
  const teamLeadIds =
    opts.teamLeadIds instanceof Set ? opts.teamLeadIds : teamLeadIdsFromOrgTeams(orgTeams);
  const orgCloserIds =
    opts.orgCloserIds instanceof Set ? opts.orgCloserIds : orgCloserIdsFromTeams(orgTeams);
  return { orgTeams, teamLeadIds, orgCloserIds };
}

/** TL / OP / CL leadership, or anyone assigned as closer on an org team. */
function isTlOrCloserPerson(e, opts = {}) {
  if (!isEligibleSubmitPickerEmployee(e)) return false;
  if (isLeadershipCloser(e, opts)) return true;
  const id = String(e?.id || "");
  if (opts.orgCloserIds instanceof Set && id && opts.orgCloserIds.has(id)) return true;
  return false;
}

function teamLeadIdsForHomeTeam(userRole, orgTeams) {
  const ids = new Set();
  const team = userRole?.team;
  if (!team) return ids;
  const unit = userRole?.unit;
  for (const t of orgTeams || []) {
    if (unit && t.unit && t.unit !== unit) continue;
    if (!teamsMatch(t.name || t.team, team)) continue;
    const tl = String(t.tlEmployeeId || t.tl_employee_id || "").trim();
    if (tl) ids.add(tl);
    for (const extra of t.tlEmployeeIds || []) {
      if (extra) ids.add(String(extra).trim());
    }
  }
  return ids;
}

function ensureSelfInPickerList(list, userRole, employees) {
  const empId = userRole?.employeeId;
  if (!empId) return list;
  if ((list || []).some((e) => e.id === empId)) return list;
  const self = (employees || []).find((e) => e.id === empId);
  if (self && isEligibleSubmitPickerEmployee(self)) return [self, ...list];
  return list;
}

function ensureSelfInAgentPickerList(list, userRole, employees, opts = {}) {
  const empId = userRole?.employeeId;
  if (!empId) return list;
  if ((list || []).some((e) => e.id === empId)) return list;
  const self = (employees || []).find((e) => e.id === empId);
  if (!self || !isEligibleSubmitPickerEmployee(self)) return list;
  if (isDialingEmployee(self, opts)) return [self, ...list];
  if (normalizeRole(userRole?.role) === "agent") return [self, ...list];
  return list;
}

function isPlainSelfSubmitAgent(userRole) {
  const role = normalizeRole(userRole?.role);
  return (
    role === "agent" &&
    !isCloserSubmitter(userRole) &&
    !isDualRoleAgent(userRole) &&
    !roles.hasLeadTeamAssignment(userRole)
  );
}

function unitsForSubmit(userRole) {
  const units = new Set();
  if (userRole?.unit) units.add(userRole.unit);
  for (const lt of userRole?.leadTeams || []) {
    if (lt.unit) units.add(lt.unit);
  }
  for (const ct of userRole?.closerTeams || []) {
    if (ct.unit) units.add(ct.unit);
  }
  return [...units];
}

function isBroadSubmitter(userRole) {
  const role = normalizeRole(userRole?.role);
  return BROAD_SUBMIT_ROLES.has(role) || MANAGE_ROLES.includes(role) || ALL_UNIT_ROLES.includes(role);
}

function isWidePickerSubmitter(userRole) {
  const role = normalizeRole(userRole?.role);
  return WIDE_PICKER_ROLES.has(role) || MANAGE_ROLES.includes(role);
}

function isDualRoleAgent(userRole) {
  return normalizeRole(userRole?.role) === "agent" && roles.hasLeadTeamAssignment(userRole);
}

function isCloserSubmitter(userRole) {
  return roles.hasCloserTeamAssignment(userRole);
}

function dedupeTeamEntries(entries) {
  const seen = new Set();
  const out = [];
  for (const e of entries || []) {
    if (!e?.team) continue;
    const key = `${e.unit || ""}|${String(e.team).trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ unit: e.unit || "", team: e.team });
  }
  return out;
}

/**
 * Org team entries used to scope the agent picker.
 * - TL: teams they lead + own assigned team + teams they close for
 * - Closer (agent): teams they close for only
 */
function teamEntriesForAgentPicker(userRole) {
  const role = normalizeRole(userRole?.role);
  const entries = [];

  if (role === "tl" || roles.hasLeadTeamAssignment(userRole)) {
    entries.push(...(userRole.leadTeams || []));
    if (userRole.team) {
      entries.push({ unit: userRole.unit || "", team: userRole.team });
    }
    entries.push(...(userRole.closerTeams || []));
    return dedupeTeamEntries(entries);
  }

  if (roles.hasCloserTeamAssignment(userRole)) {
    return dedupeTeamEntries(userRole.closerTeams || []);
  }

  return [];
}

function dialingTeamEntries(orgTeams = []) {
  return dedupeTeamEntries(
    (orgTeams || [])
      .filter((t) => t && t.dialsSales !== false)
      .map((t) => ({ unit: t.unit || "", team: t.name || t.team || "" }))
  );
}

/** Teams the submitter may pick (lead + closer + dialing home). Drops non-dialing home teams like Management. */
function allowedTeamEntriesForSubmit(userRole, orgTeams = []) {
  const role = normalizeRole(userRole?.role);
  const dialing = dialingTeamEntries(orgTeams);
  if (isBroadSubmitter(userRole) || role === "op") return dialing;
  const scoped = teamEntriesForAgentPicker(userRole);
  if (!scoped.length) {
    if (isPlainSelfSubmitAgent(userRole) && userRole?.team) {
      return dialing.filter(
        (e) =>
          teamsMatch(e.team, userRole.team) && (!userRole.unit || !e.unit || e.unit === userRole.unit)
      );
    }
    return dialing;
  }
  return scoped.filter((entry) =>
    dialing.some((d) => (!entry.unit || !d.unit || d.unit === entry.unit) && teamsMatch(d.team, entry.team))
  );
}

function agentsForOrgTeamScope(userRole, employees, opts = {}) {
  const entries = teamEntriesForAgentPicker(userRole);
  if (!entries.length) return [];
  return (employees || []).filter((e) => {
    if (!isDialingEmployee(e, opts)) return false;
    return entries.some(
      (entry) => (!entry.unit || e.unit === entry.unit) && teamsMatch(e.team, entry.team)
    );
  });
}

function agentsOnOwnTeam(userRole, employees, opts = {}) {
  if (!userRole?.team) return [];
  return (employees || []).filter(
    (e) =>
      isDialingEmployee(e, opts) &&
      teamsMatch(e.team, userRole.team) &&
      (!userRole.unit || e.unit === userRole.unit)
  );
}

function employeeInTlAgentScope(userRole, emp) {
  if (!emp) return false;
  if (roles.employeeInLedTeamScope(userRole, emp)) return true;
  if (roles.isCloserTeamMember(userRole, emp)) return true;
  if (userRole?.team && teamsMatch(emp.team, userRole.team)) {
    return !userRole.unit || emp.unit === userRole.unit;
  }
  return false;
}

function employeesForAgentPicker(userRole, employees, opts = {}) {
  const program = opts.program ? String(opts.program).toLowerCase() : "";
  const dialOpts = { teamLeadIds: opts.teamLeadIds };
  let list;

  if (isBroadSubmitter(userRole)) {
    list = (employees || []).filter((e) => isDialingEmployee(e, dialOpts));
  } else {
    const role = normalizeRole(userRole?.role);

    if (role === "op") {
      list = (employees || []).filter((e) => isDialingEmployee(e, dialOpts));
    } else if (role === "tl" || roles.hasLeadTeamAssignment(userRole)) {
      list = agentsForOrgTeamScope(userRole, employees, dialOpts);
      if (!list.length) list = agentsOnOwnTeam(userRole, employees, dialOpts);
    } else if (role === "agent" && (isCloserSubmitter(userRole) || isDualRoleAgent(userRole))) {
      list = agentsForOrgTeamScope(userRole, employees, dialOpts);
    } else if (role === "agent") {
      list = (employees || []).filter((e) => e.id === userRole?.employeeId);
    } else {
      list = (employees || []).filter((e) => isDialingEmployee(e, dialOpts));
    }
  }

  list = ensureSelfInAgentPickerList(list, userRole, employees, dialOpts);

  if (program) {
    if (isPlainSelfSubmitAgent(userRole)) {
      list = saleProgramAccess.filterEmployeesByProgram(list, program);
    }
  }

  return list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function employeesForCloserPicker(userRole, employees, opts = {}) {
  const role = normalizeRole(userRole?.role);
  const { orgTeams, teamLeadIds, orgCloserIds } = closerPickerContext(opts);
  const closerOpts = { teamLeadIds, orgCloserIds };

  let list;
  if (isWidePickerSubmitter(userRole) || role === "op") {
    list = (employees || []).filter((e) => isCloserCandidate(e, closerOpts));
  } else if (isPlainSelfSubmitAgent(userRole)) {
    const homeTlIds = teamLeadIdsForHomeTeam(userRole, orgTeams);
    list = (employees || []).filter(
      (e) => homeTlIds.has(String(e.id)) && isEligibleSubmitPickerEmployee(e)
    );
  } else if (role === "tl" || roles.hasLeadTeamAssignment(userRole)) {
    const byId = new Map();
    for (const e of agentsOnOwnTeam(userRole, employees)) byId.set(e.id, e);
    for (const e of roles.employeesMatchingTeamEntries(employees, userRole.leadTeams || [], {
      activeOnly: true,
      agentsOnly: true,
    })) {
      byId.set(e.id, e);
    }
    for (const e of employees || []) {
      if (isTlOrCloserPerson(e, closerOpts)) byId.set(e.id, e);
    }
    list = [...byId.values()];
  } else if (isCloserSubmitter(userRole)) {
    list = (employees || []).filter((e) => isTlOrCloserPerson(e, closerOpts));
  } else {
    list = (employees || []).filter((e) => isLeadershipCloser(e, closerOpts));
  }

  list = ensureSelfInPickerList(list, userRole, employees);

  return list
    .filter((e) => isEligibleSubmitPickerEmployee(e))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function filterDialingOrgTeams(orgTeams, company) {
  const companyContext = require("./company-context");
  const ctx = companyContext.parseCompanyContext(company);
  return (orgTeams || []).filter((t) => {
    if (t.dialsSales === false) return false;
    const unitCompany = companyContext.getCompanyForUnit(t.unit);
    if (ctx === "hs2") return unitCompany === "hs2";
    return unitCompany !== "hs2";
  });
}

/**
 * Q Feedback closer picker:
 * - OP / RTM / Admin (/ CEO): TL + Closers first, then dialing agents (exception)
 * - Quality: TL + Closers only (no dialing-agent exception)
 * - TL / Closer submitters: only themselves (unit identity)
 * - Everyone else: only themselves when linked
 */
function employeesForQFeedbackCloserPicker(userRole, employees, opts = {}) {
  const role = normalizeRole(userRole?.role);
  const { teamLeadIds, orgCloserIds } = closerPickerContext(opts);
  const closerOpts = { teamLeadIds, orgCloserIds };
  const empId = String(userRole?.employeeId || "").trim();
  const dialOpts = { teamLeadIds };

  const canAddDialingAgents = ["admin", "ceo", "rtm", "op"].includes(role);
  const canPickTlClosers =
    canAddDialingAgents || role === "quality" || isWidePickerSubmitter(userRole);

  const presentable = (list) =>
    (list || [])
      .filter((e) => isEligibleSubmitPickerEmployee(e))
      .sort((a, b) => {
        const aLead = isTlOrCloserPerson(a, closerOpts) ? 0 : 1;
        const bLead = isTlOrCloserPerson(b, closerOpts) ? 0 : 1;
        if (aLead !== bLead) return aLead - bLead;
        const byName = String(a.american_name || "").localeCompare(String(b.american_name || ""), undefined, {
          sensitivity: "base",
        });
        if (byName) return byName;
        return String(a.id).localeCompare(String(b.id));
      });

  if (canPickTlClosers) {
    const byId = new Map();
    for (const e of employees || []) {
      if (isTlOrCloserPerson(e, closerOpts)) byId.set(e.id, e);
    }
    if (canAddDialingAgents) {
      for (const e of employees || []) {
        if (!byId.has(e.id) && isDialingEmployee(e, dialOpts)) byId.set(e.id, e);
      }
    }
    return presentable([...byId.values()]);
  }

  const isTlOrCloserSubmitter =
    role === "tl" ||
    roles.hasLeadTeamAssignment(userRole) ||
    roles.hasCloserTeamAssignment(userRole) ||
    isCloserSubmitter(userRole);

  if (isTlOrCloserSubmitter || empId) {
    const self = (employees || []).find((e) => e.id === empId);
    if (self && isEligibleSubmitPickerEmployee(self)) return [self];
    return [];
  }

  return [];
}

/**
 * Checks create Q-feedback shortcut: TL + Closers only (no dialing-agent exception).
 * Default closer is the submitter; list is always editable in UI.
 */
function employeesForCheckFeedbackCloserPicker(userRole, employees, opts = {}) {
  const { teamLeadIds, orgCloserIds } = closerPickerContext(opts);
  const closerOpts = { teamLeadIds, orgCloserIds };
  const role = normalizeRole(userRole?.role);
  const empId = String(userRole?.employeeId || "").trim();

  const presentable = (list) =>
    (list || [])
      .filter((e) => isEligibleSubmitPickerEmployee(e))
      .sort((a, b) => {
        const aLead = isTlOrCloserPerson(a, closerOpts) ? 0 : 1;
        const bLead = isTlOrCloserPerson(b, closerOpts) ? 0 : 1;
        if (aLead !== bLead) return aLead - bLead;
        return String(a.american_name || "").localeCompare(String(b.american_name || ""), undefined, {
          sensitivity: "base",
        });
      });

  const tlCloserOnly = (e) => isTlOrCloserPerson(e, closerOpts);

  if (["admin", "ceo", "rtm", "op", "quality"].includes(role) || isWidePickerSubmitter(userRole)) {
    return presentable((employees || []).filter(tlCloserOnly));
  }

  if (role === "tl" || roles.hasLeadTeamAssignment(userRole)) {
    const byId = new Map();
    for (const e of employees || []) {
      if (!tlCloserOnly(e)) continue;
      if (roles.employeeInLedTeamScope(userRole, e)) byId.set(e.id, e);
      else if (userRole?.team && teamsMatch(e.team, userRole.team)) byId.set(e.id, e);
      else if (roles.isCloserTeamMember(userRole, e)) byId.set(e.id, e);
    }
    return presentable([...byId.values()]);
  }

  if (
    isCloserSubmitter(userRole) ||
    isDualRoleAgent(userRole) ||
    roles.hasCloserTeamAssignment(userRole)
  ) {
    const byId = new Map();
    for (const e of employees || []) {
      if (!tlCloserOnly(e)) continue;
      if (roles.isCloserTeamMember(userRole, e)) byId.set(e.id, e);
      else if (userRole?.team && teamsMatch(e.team, userRole.team)) byId.set(e.id, e);
    }
    return presentable([...byId.values()]);
  }

  const self = (employees || []).find((e) => e.id === empId);
  if (self && isEligibleSubmitPickerEmployee(self)) return [self];
  return [];
}

function buildQFeedbackCloserScopePayload(userRole, employees, orgTeams, opts = {}) {
  const companyContext = require("./company-context");
  const company = opts.company || companyContext.getCompanyForUser(userRole);
  const scopedEmployees = companyContext.filterEmployeesByCompany(employees || [], company);
  const dialingTeams = filterDialingOrgTeams(orgTeams, company);
  const teamLeadIds = teamLeadIdsFromOrgTeams(dialingTeams);
  const orgCloserIds = orgCloserIdsFromTeams(dialingTeams);
  const closers = opts.forCheckCreate
    ? employeesForCheckFeedbackCloserPicker(userRole, scopedEmployees, {
        teamLeadIds,
        orgCloserIds,
        orgTeams: dialingTeams,
      })
    : employeesForQFeedbackCloserPicker(userRole, scopedEmployees, {
        teamLeadIds,
        orgCloserIds,
        orgTeams: dialingTeams,
      });
  const empId = String(userRole?.employeeId || "").trim();
  const role = normalizeRole(userRole?.role);
  if (opts.forCheckCreate) {
    const withSelf = ensureSelfInPickerList(closers, userRole, scopedEmployees);
    return {
      closers: withSelf,
      defaultCloserId: empId || withSelf[0]?.id || "",
      lockCloser: false,
      company,
    };
  }
  const lockCloser =
    closers.length <= 1 &&
    !["admin", "ceo", "rtm", "op", "quality"].includes(role) &&
    !isWidePickerSubmitter(userRole);
  return {
    closers,
    defaultCloserId: empId && closers.some((e) => e.id === empId) ? empId : closers[0]?.id || "",
    lockCloser,
    company,
  };
}

function buildSubmitScopePayload(userRole, employees, orgTeams, opts = {}) {
  const companyContext = require("./company-context");
  const company = opts.company || companyContext.getCompanyForUser(userRole);
  const program = opts.program ? String(opts.program).toLowerCase() : "";
  const allEmployees = employees || [];
  const scopedEmployees = companyContext.filterEmployeesByCompany(allEmployees, company);
  const dialingTeams = filterDialingOrgTeams(orgTeams, company);

  const empId = userRole?.employeeId || "";
  const selfEmp =
    scopedEmployees.find((e) => e.id === empId) || allEmployees.find((e) => e.id === empId) || null;
  const role = normalizeRole(userRole?.role);
  const unitLocked = unitPickerLocked(userRole);
  const scopeUnit = unitLocked ? selfEmp?.unit || userRole?.unit || "" : "";

  const teamLeadIds = teamLeadIdsFromOrgTeams(dialingTeams);
  const orgCloserIds = orgCloserIdsFromTeams(dialingTeams);
  const agents = employeesForAgentPicker(userRole, scopedEmployees, {
    program,
    unit: scopeUnit,
    teamLeadIds,
  });
  const closers = employeesForCloserPicker(userRole, scopedEmployees, {
    unit: scopeUnit,
    teamLeadIds,
    orgCloserIds,
    orgTeams: dialingTeams,
  });

  const isDialingSelf = Boolean(empId && agents.some((e) => e.id === empId));
  const plainAgent = role === "agent" && !isCloserSubmitter(userRole) && !isDualRoleAgent(userRole);
  const allowedTeamEntries = allowedTeamEntriesForSubmit(userRole, dialingTeams);
  const teamLocked = teamPickerLocked(userRole);

  let defaultUnit = "";
  let defaultTeam = "";
  if (unitLocked) {
    defaultUnit = selfEmp?.unit || userRole?.unit || "";
  } else if (selfEmp?.unit && dialingTeams.some((t) => t.unit === selfEmp.unit)) {
    defaultUnit = selfEmp.unit;
  } else if (allowedTeamEntries.length) {
    const units = [...new Set(allowedTeamEntries.map((e) => e.unit).filter(Boolean))];
    if (units.length === 1) defaultUnit = units[0];
  }

  const defaultAgent = empId ? agents.find((e) => e.id === empId) : null;
  if (defaultAgent?.team) defaultTeam = defaultAgent.team;
  else {
    const homeTeam = selfEmp?.team || userRole?.team || "";
    const homeTeamAllowed = Boolean(
      homeTeam &&
        allowedTeamEntries.some(
          (e) => teamsMatch(e.team, homeTeam) && (!defaultUnit || !e.unit || e.unit === defaultUnit)
        )
    );
    if (isPlainSelfSubmitAgent(userRole) && homeTeamAllowed) defaultTeam = homeTeam;
  }

  let defaultCloserId = "";
  if (empId && closers.some((e) => e.id === empId)) defaultCloserId = empId;
  else if (plainAgent && empId) defaultCloserId = empId;
  else if (!isWidePickerSubmitter(userRole) && !isBroadSubmitter(userRole) && role !== "op" && empId) {
    defaultCloserId = empId;
  }

  const payload = {
    agents,
    closers,
    orgTeams: dialingTeams,
    defaultAgentId: isDialingSelf ? empId : "",
    defaultCloserId,
    defaultUnit,
    defaultTeam,
    lockAgent: agentPickerLocked(userRole),
    lockTeam: teamLocked,
    lockUnit: unitLocked,
    allowedUnits: allowedUnitsForSubmit(userRole, dialingTeams),
    allowedTeams: allowedTeamEntries.map((e) => e.team),
    company,
  };
  if (program) payload.program = program;
  return payload;
}

function agentPickerLocked(userRole) {
  const role = normalizeRole(userRole?.role);
  if (role === "agent") {
    return !isCloserSubmitter(userRole) && !isDualRoleAgent(userRole);
  }
  return false;
}

function teamPickerLocked(_userRole) {
  // Team always follows the selected agent (TUTORIAL 1.6.13). No team dropdown.
  return true;
}

function unitPickerLocked(userRole) {
  const role = normalizeRole(userRole?.role);
  if (role === "op") return false;
  if (role === "tl" || isCloserSubmitter(userRole) || isDualRoleAgent(userRole) || roles.hasLeadTeamAssignment(userRole)) {
    const units = unitsForSubmit(userRole);
    return units.length <= 1;
  }
  if (role === "agent") return true;
  return false;
}

function allowedUnitsForSubmit(userRole, orgTeams) {
  const role = normalizeRole(userRole?.role);
  if (isBroadSubmitter(userRole) || role === "op") {
    const dialing = (orgTeams || []).filter((t) => t.dialsSales !== false);
    return [...new Set(dialing.map((t) => t.unit).filter(Boolean))].sort();
  }
  if (role === "tl") {
    const units = unitsForSubmit(userRole);
    if (units.length) return units.sort();
    return userRole?.unit ? [userRole.unit] : [];
  }
  if (role === "agent") {
    if (isCloserSubmitter(userRole) || isDualRoleAgent(userRole)) return unitsForSubmit(userRole).sort();
    return userRole?.unit ? [userRole.unit] : [];
  }
  return unitsForSubmit(userRole);
}

function validateSaleSubmitAssignment(userRole, { agentId, closerId, unit, team }, employees, opts = {}) {
  const { isOtherAgentId } = require("./other-agent");
  const closers = employeesForCloserPicker(userRole, employees, {
    unit: unit || userRole?.unit,
    teamLeadIds: opts.teamLeadIds,
    orgCloserIds: opts.orgCloserIds,
    orgTeams: opts.orgTeams,
  });
  const closerIds = new Set(closers.map((e) => e.id));

  if (isOtherAgentId(agentId)) {
    const resolvedCloser = closerId || userRole?.employeeId || "";
    if (!resolvedCloser || !closerIds.has(resolvedCloser)) {
      return { ok: false, error: "Closer not allowed for your role" };
    }
    return {
      ok: true,
      closerId: resolvedCloser,
      unit: unit || "",
      team: team || "",
    };
  }

  const agents = employeesForAgentPicker(userRole, employees, {
    program: opts.program,
    unit,
    teamLeadIds: opts.teamLeadIds,
  });
  const agentIds = new Set(agents.map((e) => e.id));

  if (!agentId || !agentIds.has(agentId)) {
    return { ok: false, error: "Agent not allowed for your role" };
  }
  const resolvedCloser = closerId || userRole?.employeeId || "";
  if (!resolvedCloser || !closerIds.has(resolvedCloser)) {
    return { ok: false, error: "Closer not allowed for your role" };
  }
  if (unit && !unitPickerLocked(userRole)) {
    const allowed = new Set(allowedUnitsForSubmit(userRole, opts.orgTeams));
    if (allowed.size && !allowed.has(unit)) {
      return { ok: false, error: "Unit not allowed for your role" };
    }
  }
  const agentEmp = (employees || []).find((e) => e.id === agentId);
  if (
    team &&
    agentEmp?.team &&
    !teamsMatch(agentEmp.team, team) &&
    isPlainSelfSubmitAgent(userRole)
  ) {
    return { ok: false, error: "Agent must belong to the selected team" };
  }

  const role = normalizeRole(userRole?.role);
  if ((role === "tl" || roles.hasLeadTeamAssignment(userRole)) && agentEmp) {
    if (!employeeInTlAgentScope(userRole, agentEmp)) {
      return { ok: false, error: "Agent must be on your team or a team you close for" };
    }
  } else if (role === "agent" && roles.hasCloserTeamAssignment(userRole) && agentEmp) {
    if (!roles.employeeInCloserTeamScope(userRole, agentEmp)) {
      return { ok: false, error: "Agent must be on a team you close for" };
    }
  }

  return {
    ok: true,
    closerId: resolvedCloser,
    unit: agentEmp?.unit || unit || "",
    team: agentEmp?.team || team || "",
  };
}

module.exports = {
  unitsForSubmit,
  isDualRoleAgent,
  isCloserSubmitter,
  isBroadSubmitter,
  isWidePickerSubmitter,
  isPlainSelfSubmitAgent,
  agentPickerLocked,
  teamPickerLocked,
  unitPickerLocked,
  allowedUnitsForSubmit,
  allowedTeamEntriesForSubmit,
  employeesForAgentPicker,
  employeesForCloserPicker,
  employeesForQFeedbackCloserPicker,
  employeesForCheckFeedbackCloserPicker,
  teamEntriesForAgentPicker,
  employeeInTlAgentScope,
  isDialingEmployee,
  isEligibleSubmitPickerEmployee,
  isLeadershipCloser,
  isCloserCandidate,
  isTlOrCloserPerson,
  teamLeadIdsFromOrgTeams,
  orgCloserIdsFromTeams,
  filterDialingOrgTeams,
  buildSubmitScopePayload,
  buildQFeedbackCloserScopePayload,
  validateSaleSubmitAssignment,
};

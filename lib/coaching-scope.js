/**
 * Coaching picker + coach assignment rules.
 */
const { normalizeStatusKey, isOutStatus } = require("./employee-status");
const { isOnBehalfAgentTarget, normalizeRole, hasLeadTeamAssignment, hasCloserTeamAssignment } = require("./roles");

const COACHING_OUTCOMES = ["pending", "positive", "negative", "normal"];

const BLOCKED_COACHEE_ROLES = new Set(["hr", "quality", "admin", "ceo"]);
const BLOCKED_COACHEE_PREFIXES = ["HR", "QA", "MG"];

function employeeLoginRole(emp) {
  if (!emp) return "";
  if (emp.role) return normalizeRole(emp.role);
  try {
    const store = require("./data-store");
    const live = normalizeRole(store.getAppUserRoleForEmployee(emp.id) || "");
    if (live) return live;
  } catch {
    /* optional */
  }
  if (emp.lead_role) return normalizeRole(emp.lead_role);
  return "";
}

function isActiveForCoaching(emp) {
  if (!emp) return false;
  const key = normalizeStatusKey(emp.status);
  if (isOutStatus(emp.status) || key === "deleted") return false;
  return key === "active" || key === "paused" || key === "paused_still_paid";
}

function isBlockedCoachee(emp) {
  if (!emp) return true;
  const role = employeeLoginRole(emp);
  if (BLOCKED_COACHEE_ROLES.has(role)) return true;
  if (!role) {
    const id = String(emp.id || "").trim().toUpperCase();
    if (BLOCKED_COACHEE_PREFIXES.some((p) => id.startsWith(p))) return true;
  }
  const pos = String(emp.position || "").trim().toLowerCase();
  if (pos.includes("quality") || pos === "hr" || pos.includes("human resource")) return true;
  if (pos.includes("admin") && !pos.includes("assistant")) return true;
  return false;
}

function isOrgTl(emp, orgTeams) {
  if (!emp?.id) return false;
  const id = emp.id;
  const role = employeeLoginRole(emp);
  if (role === "tl") return true;
  if ((orgTeams || []).some((t) => t.tlEmployeeId === id || (t.tlEmployeeIds || []).includes(id))) {
    return true;
  }
  if (!role && String(id).toUpperCase().startsWith("TL")) return true;
  return false;
}

function isOrgCloser(emp, orgTeams) {
  if (!emp?.id) return false;
  const id = emp.id;
  if ((orgTeams || []).some((t) => (t.closerEmployeeIds || []).includes(id))) return true;
  const role = employeeLoginRole(emp);
  if (!role && String(id).toUpperCase().startsWith("CL")) return true;
  return false;
}

function isQualityEmployee(emp) {
  if (!emp) return false;
  const role = employeeLoginRole(emp);
  if (role === "quality") return true;
  if (role) return false;
  const id = String(emp.id || "").toUpperCase();
  if (id.startsWith("QA")) return true;
  return String(emp.position || "").toLowerCase().includes("quality");
}

function isOrgOp(emp) {
  if (!emp?.id) return false;
  const role = employeeLoginRole(emp);
  if (role === "op") return true;
  if (role) return false;
  if (String(emp.id).toUpperCase().startsWith("OP")) return true;
  const pos = String(emp.position || "").trim().toLowerCase();
  return pos === "op" || pos.startsWith("op ") || pos.includes("operations manager");
}

function isCoachStaff(emp, orgTeams) {
  return isOrgTl(emp, orgTeams) || isOrgCloser(emp, orgTeams);
}

function presentEmp(emp, extra = {}) {
  return {
    id: emp.id,
    american_name: emp.american_name,
    arabic_name: emp.arabic_name,
    team: emp.team,
    unit: emp.unit,
    status: emp.status,
    ...extra,
  };
}

function unitEmployees(employees, unit) {
  if (!unit) return employees || [];
  return (employees || []).filter((e) => e.unit === unit);
}

function employeesForCoachingAgent(userRole, employees, { orgTeams = [] } = {}) {
  const role = normalizeRole(userRole?.role);
  const active = (employees || []).filter((e) => isActiveForCoaching(e) && !isBlockedCoachee(e));

  if (["admin", "ceo", "hr", "quality"].includes(role)) {
    return active.filter((e) => isOnBehalfAgentTarget(e) && !isCoachStaff(e, orgTeams));
  }

  if (role === "op") {
    const inUnit = userRole?.unit ? unitEmployees(active, userRole.unit) : active;
    return inUnit.filter((e) => (isOnBehalfAgentTarget(e) && !isCoachStaff(e, orgTeams)) || isCoachStaff(e, orgTeams));
  }

  const lead = userRole?.leadTeams || [];
  const closer = userRole?.closerTeams || [];
  const teamEntries =
    hasCloserTeamAssignment(userRole) && !hasLeadTeamAssignment(userRole)
      ? closer
      : lead.length
        ? lead
        : closer;
  const { employeesMatchingTeamEntries } = require("./roles");
  const teamAgents = employeesMatchingTeamEntries(active, teamEntries, {
    activeOnly: true,
    agentsOnly: true,
  });
  return teamAgents.filter((e) => !isCoachStaff(e, orgTeams) && !isBlockedCoachee(e));
}

function uniqueById(list) {
  const seen = new Set();
  const out = [];
  for (const e of list || []) {
    if (!e?.id || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

function isTlLikeSubmitter(userRole) {
  const role = normalizeRole(userRole?.role);
  if (role === "tl") return true;
  if (["op", "hr", "admin", "ceo", "quality"].includes(role)) return false;
  return hasLeadTeamAssignment(userRole) && !hasCloserTeamAssignment(userRole);
}

function isCloserLikeSubmitter(userRole) {
  const role = normalizeRole(userRole?.role);
  if (["op", "hr", "admin", "ceo", "quality", "tl"].includes(role)) return false;
  return hasCloserTeamAssignment(userRole);
}

function coachesForUser(userRole, employees, { orgTeams = [] } = {}) {
  const role = normalizeRole(userRole?.role);
  const selfId = userRole?.employeeId || "";
  const active = (employees || []).filter((e) => isActiveForCoaching(e));
  const tls = uniqueById(active.filter((e) => isOrgTl(e, orgTeams)));
  const closers = uniqueById(active.filter((e) => isOrgCloser(e, orgTeams) && !isOrgTl(e, orgTeams)));
  const quality = uniqueById(active.filter((e) => isQualityEmployee(e)));
  const agents = uniqueById(
    active.filter(
      (e) => isOnBehalfAgentTarget(e) && !isCoachStaff(e, orgTeams) && !isQualityEmployee(e) && !isBlockedCoachee(e)
    )
  );

  const selfEmp =
    active.find((e) => e.id === selfId) ||
    (selfId ? { id: selfId, american_name: userRole?.username || "Me", arabic_name: "" } : null);
  const withSelf = (list) => uniqueById([...(selfEmp ? [selfEmp] : []), ...(list || [])]);

  const ops = uniqueById(active.filter((e) => isOrgOp(e)));

  const empty = {
    tls: [],
    closers: [],
    ops: [],
    agents: [],
    quality: [],
    defaultCoachId: selfId,
    canAssignCoach: false,
    coachLocked: true,
  };

  if (isTlLikeSubmitter(userRole) || isCloserLikeSubmitter(userRole)) {
    return { ...empty, defaultCoachId: selfId, canAssignCoach: false, coachLocked: true };
  }
  if (role === "quality") {
    return {
      tls: [],
      closers: [],
      ops,
      agents: [],
      quality: withSelf(quality),
      defaultCoachId: selfId,
      canAssignCoach: true,
      coachLocked: false,
    };
  }
  if (role === "op") {
    const inUnit = userRole?.unit ? (e) => e.unit === userRole.unit : () => true;
    return {
      tls: tls.filter(inUnit),
      closers: closers.filter(inUnit),
      ops: withSelf(ops.filter(inUnit)),
      agents: agents.filter(inUnit),
      quality: [],
      defaultCoachId: selfId,
      canAssignCoach: true,
      coachLocked: false,
    };
  }
  if (role === "hr") {
    return {
      tls,
      closers,
      ops,
      quality: withSelf(quality),
      agents: [],
      defaultCoachId: selfId,
      canAssignCoach: true,
      coachLocked: false,
    };
  }
  if (role === "admin" || role === "ceo") {
    return {
      tls: withSelf(tls.filter((e) => e.id !== selfId)),
      closers,
      ops,
      quality,
      agents,
      defaultCoachId: selfId,
      canAssignCoach: true,
      coachLocked: false,
    };
  }
  return { ...empty, defaultCoachId: selfId };
}

function flattenCoachOptions(coaches) {
  const out = [];
  for (const section of ["tls", "closers", "ops", "quality", "agents"]) {
    for (const e of coaches?.[section] || []) out.push(e);
  }
  return uniqueById(out);
}

function isAllowedCoach(userRole, coachId, employees, orgTeams) {
  const coaches = coachesForUser(userRole, employees, { orgTeams });
  if (coaches.coachLocked) {
    return Boolean(userRole?.employeeId) && coachId === userRole.employeeId;
  }
  if (!coachId) return false;
  if (coaches.defaultCoachId && coachId === coaches.defaultCoachId) return true;
  return flattenCoachOptions(coaches).some((e) => e.id === coachId);
}

function isAllowedCoachee(userRole, employeeId, employees, orgTeams) {
  return employeesForCoachingAgent(userRole, employees, { orgTeams }).some((e) => e.id === employeeId);
}

module.exports = {
  COACHING_OUTCOMES,
  isActiveForCoaching,
  isBlockedCoachee,
  isOrgTl,
  isOrgCloser,
  isOrgOp,
  isQualityEmployee,
  isCoachStaff,
  presentEmp,
  employeesForCoachingAgent,
  coachesForUser,
  flattenCoachOptions,
  isAllowedCoach,
  isAllowedCoachee,
};

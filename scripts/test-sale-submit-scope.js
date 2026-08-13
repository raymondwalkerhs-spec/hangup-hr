#!/usr/bin/env node
/** Sale submit scope + create sanitization + request annual + doc types */
const scope = require("../lib/sale-submit-scope");
const catalog = require("../lib/sales-field-catalog");
const requestRules = require("../lib/request-rules");
const documents = require("../lib/documents");

function assert(name, cond) {
  if (!cond) {
    console.error("FAIL", name);
    process.exitCode = 1;
    return;
  }
  console.log("  ok", name);
}

console.log("sale-submit-scope");

const employees = [
  { id: "HS1-05", unit: "HS-1", team: "Phoenix", status: "Active", employment_date: "2024-01-01", american_name: "Dual TL" },
  { id: "HS1-10", unit: "HS-1", team: "Phoenix", status: "Active", employment_date: "2024-01-01", american_name: "Peer Agent" },
  { id: "HS1-20", unit: "HS-1", team: "Phoenix", status: "Active", employment_date: "2024-01-01", american_name: "Agent Two" },
  { id: "TL1-01", unit: "HS-1", team: "Phoenix", status: "Active", american_name: "Team Lead" },
  { id: "OP1-01", unit: "HS-1", team: "Ops", status: "Active", american_name: "OP One" },
  { id: "HS3-30", unit: "HS-3", team: "Ayla", status: "Active", employment_date: "2024-01-01", american_name: "Led Agent" },
  { id: "TL3-01", unit: "HS-3", team: "Ayla", status: "Active", american_name: "TL Three" },
  {
    id: "HS3-35",
    unit: "HS-3",
    team: "Ayla",
    status: "Active",
    position: "Closer",
    role: "agent",
    american_name: "Ria",
  },
  {
    id: "CL05",
    unit: "HS-1",
    team: "Phoenix",
    status: "Active",
    position: "Closer",
    role: "agent",
    american_name: "Closer Agent",
  },
];

const orgTeams = [
  { name: "Phoenix", unit: "HS-1", tlEmployeeId: "TL1-01", tlEmployeeIds: ["TL1-01"], closerEmployeeIds: ["CL05"] },
  { name: "Ayla", unit: "HS-3", tlEmployeeId: "TL3-01", tlEmployeeIds: ["TL3-01"], closerEmployeeIds: ["HS3-35"] },
];

const plainAgent = { role: "agent", employeeId: "HS1-10", unit: "HS-1", team: "Phoenix", leadTeams: [] };
const dualAgent = {
  role: "agent",
  employeeId: "HS1-05",
  unit: "HS-1",
  team: "Phoenix",
  leadTeams: [{ unit: "HS-3", team: "Ayla" }],
  closerTeams: [{ unit: "HS-3", team: "Ayla" }],
};
const tlUser = {
  role: "tl",
  employeeId: "TL1-01",
  unit: "HS-1",
  team: "Phoenix",
  leadTeams: [{ unit: "HS-1", team: "Phoenix" }],
};
const opUser = { role: "op", employeeId: "OP1-01", unit: "HS-1", leadTeams: [] };

const plainAgents = scope.employeesForAgentPicker(plainAgent, employees);
assert("plain agent picker is self only", plainAgents.length === 1 && plainAgents[0].id === "HS1-10");

const dualAgents = scope.employeesForAgentPicker(dualAgent, employees).map((e) => e.id).sort();
assert(
  "dual-role agent picker uses lead team, own team, and closer teams",
  dualAgents.includes("HS1-05") &&
    dualAgents.includes("HS3-30") &&
    dualAgents.includes("HS1-10") &&
    !dualAgents.includes("TL1-01")
);

const tlAgents = scope.employeesForAgentPicker(tlUser, employees).map((e) => e.id).sort();
assert("TL sees team + closer-scope agents only", tlAgents.includes("HS1-10") && !tlAgents.includes("HS3-30"));

const plainClosers = scope.employeesForCloserPicker(plainAgent, employees, { orgTeams }).map((e) => e.id);
assert(
  "plain agent closers are self + home team TL only",
  plainClosers.includes("HS1-10") && plainClosers.includes("TL1-01") && !plainClosers.includes("TL3-01")
);

const adminUser = { role: "admin", employeeId: "HR-01", unit: "HS-MGMT", team: "Quality" };
const adminAgents = scope.employeesForAgentPicker(adminUser, employees).map((e) => e.id);
assert(
  "admin sees all active dialing agents",
  adminAgents.includes("HS1-10") && adminAgents.includes("HS3-30") && !adminAgents.includes("TL1-01")
);
const adminClosers = scope.employeesForCloserPicker(adminUser, employees).map((e) => e.id);
assert(
  "admin can pick any active agent as closer",
  adminClosers.includes("HS1-10") && adminClosers.includes("TL1-01")
);
const adminScope = scope.buildSubmitScopePayload(adminUser, employees, [
  { name: "Phoenix", unit: "HS-1", dialsSales: true },
  { name: "Ayla", unit: "HS-3", dialsSales: true },
]);
assert("admin unit picker unlocked", adminScope.lockUnit === false);
assert("admin default unit not forced to HR unit", adminScope.defaultUnit === "");
assert("admin team picker locked (team follows agent)", adminScope.lockTeam === true);

const amyCloserTl = {
  role: "tl",
  employeeId: "HS3-18",
  unit: "HS-3",
  team: "Management",
  leadTeams: [],
  closerTeams: [
    { unit: "HS-3", team: "Jude" },
    { unit: "HS-3", team: "Justin" },
    { unit: "HS-3", team: "Tris" },
    { unit: "HS-3", team: "Ayla" },
  ],
};
const amyEmployees = [
  ...employees,
  { id: "HS3-18", unit: "HS-3", team: "Management", status: "Active", position: "Team Leader", role: "tl", american_name: "Amy" },
  { id: "HS3-20", unit: "HS-3", team: "Tris", status: "Active", american_name: "Heaven" },
  { id: "HS3-08", unit: "HS-3", team: "Tris", status: "Active", american_name: "Kate" },
];
const amyOrgTeams = [
  { name: "Jude", unit: "HS-3", dialsSales: true, closerEmployeeIds: ["HS3-18"] },
  { name: "Justin", unit: "HS-3", dialsSales: true, closerEmployeeIds: ["HS3-18"] },
  { name: "Tris", unit: "HS-3", dialsSales: true, closerEmployeeIds: ["HS3-18"] },
  { name: "Ayla", unit: "HS-3", dialsSales: true, closerEmployeeIds: ["HS3-18"] },
];
const amyAgents = scope.employeesForAgentPicker(amyCloserTl, amyEmployees).map((e) => e.id);
assert(
  "TL closer for Tris sees Tris agents",
  amyAgents.includes("HS3-20") && amyAgents.includes("HS3-08")
);
const amyScope = scope.buildSubmitScopePayload(amyCloserTl, amyEmployees, amyOrgTeams);
assert("TL closer team picker locked (team follows agent)", amyScope.lockTeam === true);
assert("TL closer does not default to non-dialing Management", amyScope.defaultTeam !== "Management");
assert("TL closer allowed teams include Tris", (amyScope.allowedTeams || []).includes("Tris"));
const dualUnitCloser = {
  role: "tl",
  employeeId: "TL1-01",
  unit: "HS-1",
  team: "Phoenix",
  leadTeams: [{ unit: "HS-1", team: "Phoenix" }],
  closerTeams: [{ unit: "HS-3", team: "Ayla" }],
};
const dualUnitScope = scope.buildSubmitScopePayload(dualUnitCloser, employees, [
  { name: "Phoenix", unit: "HS-1", dialsSales: true, tlEmployeeIds: ["TL1-01"] },
  { name: "Ayla", unit: "HS-3", dialsSales: true, closerEmployeeIds: ["TL1-01"] },
]);
assert(
  "multi-unit closer keeps both teams in allowedTeams",
  (dualUnitScope.allowedTeams || []).includes("Phoenix") && (dualUnitScope.allowedTeams || []).includes("Ayla")
);
const amyTrisSale = scope.validateSaleSubmitAssignment(
  amyCloserTl,
  { agentId: "HS3-20", closerId: "HS3-18", unit: "HS-3", team: "Tris" },
  amyEmployees,
  { orgTeams: amyOrgTeams }
);
assert("TL closer can submit Tris agent", amyTrisSale.ok && amyTrisSale.team === "Tris");
const amyStaleTeam = scope.validateSaleSubmitAssignment(
  amyCloserTl,
  { agentId: "HS3-20", closerId: "HS3-18", unit: "HS-3", team: "Management" },
  amyEmployees,
  { orgTeams: amyOrgTeams }
);
assert("TL closer submit ignores stale Management team", amyStaleTeam.ok && amyStaleTeam.team === "Tris");

const dualClosers = scope.employeesForCloserPicker(dualAgent, employees, { orgTeams }).map((e) => e.id);
assert(
  "dual-role TL can pick team agents and any TL/closer",
  dualClosers.includes("HS1-10") && dualClosers.includes("TL1-01") && dualClosers.includes("TL3-01")
);

const otherUnitCloser = scope.validateSaleSubmitAssignment(
  plainAgent,
  { agentId: "HS1-10", closerId: "TL3-01", unit: "HS-1", team: "Phoenix" },
  employees,
  { orgTeams }
);
assert("plain agent cannot pick TL from another team", otherUnitCloser.ok === false);

const selfCloser = scope.validateSaleSubmitAssignment(
  plainAgent,
  { agentId: "HS1-10", closerId: "HS1-10", unit: "HS-1", team: "Phoenix" },
  employees,
  { orgTeams }
);
assert("plain agent can pick self as closer", selfCloser.ok);

const goodPlain = scope.validateSaleSubmitAssignment(
  plainAgent,
  { agentId: "HS1-10", closerId: "TL1-01", unit: "HS-1", team: "Phoenix" },
  employees,
  { orgTeams }
);
assert("plain agent valid home-team TL closer", goodPlain.ok);

assert(
  "closer position is not a dialing agent (self still injected for agent-role closers)",
  !scope.isDialingEmployee({ id: "CL05", status: "Active", position: "Closer", role: "agent" })
);
assert(
  "live TL role alone does not hide HS dialer",
  scope.isDialingEmployee({ id: "HS1-05", status: "Active", role: "tl" })
);
assert(
  "org team lead is not a dialing agent",
  !scope.isDialingEmployee({ id: "HS1-05", status: "Active", role: "tl" }, { teamLeadIds: new Set(["HS1-05"]) })
);
assert(
  "team leader position is not a dialing agent",
  !scope.isDialingEmployee({ id: "HS1-05", status: "Active", position: "Team Leader" })
);
assert("plain HS agent without role is dialing", scope.isDialingEmployee({ id: "HS1-10", status: "Active" }));
assert(
  "DB override force-includes TL id in agent picker",
  scope.isDialingEmployee({ id: "TL1-01", status: "Active", sales_agent_picker: true })
);
assert(
  "DB override force-excludes HS dialer",
  !scope.isDialingEmployee({ id: "HS1-10", status: "Active", sales_agent_picker: false })
);

const closerAgent = {
  role: "agent",
  employeeId: "HS3-35",
  unit: "HS-3",
  team: "Ayla",
  leadTeams: [],
  closerTeams: [{ unit: "HS-3", team: "Ayla" }],
};
const closerAgentIds = scope.employeesForAgentPicker(closerAgent, employees).map((e) => e.id);
assert(
  "agent-role closer picker includes self and team agents",
  closerAgentIds.includes("HS3-35") && closerAgentIds.includes("HS3-30") && !closerAgentIds.includes("TL3-01")
);
const closerCloserIds = scope.employeesForCloserPicker(closerAgent, employees, { orgTeams }).map((e) => e.id);
assert(
  "agent-role closer can pick self as closer",
  closerCloserIds.includes("HS3-35") && closerCloserIds.includes("TL3-01")
);
const closerSelfSale = scope.validateSaleSubmitAssignment(
  closerAgent,
  { agentId: "HS3-35", closerId: "HS3-35", unit: "HS-3", team: "Ayla" },
  employees,
  { orgTeams }
);
assert("agent-role closer can submit self as agent and closer", closerSelfSale.ok);
const closerTeamSale = scope.validateSaleSubmitAssignment(
  closerAgent,
  { agentId: "HS3-30", closerId: "HS3-35", unit: "HS-3", team: "Ayla" },
  employees,
  { orgTeams }
);
assert("agent-role closer can submit team agent with self as closer", closerTeamSale.ok);

const clIdCloser = {
  role: "agent",
  employeeId: "CL05",
  unit: "HS-1",
  team: "Phoenix",
  leadTeams: [],
  closerTeams: [{ unit: "HS-1", team: "Phoenix" }],
};
const clSelfSale = scope.validateSaleSubmitAssignment(
  clIdCloser,
  { agentId: "CL05", closerId: "CL05", unit: "HS-1", team: "Phoenix" },
  employees,
  { orgTeams }
);
assert("CL-id closer with agent role can self-submit", clSelfSale.ok);

const plainMlaAgents = scope
  .employeesForAgentPicker(plainAgent, employees, { program: "mla" })
  .map((e) => e.id);
assert("plain agent stays in MLA picker when flags are unset", plainMlaAgents.includes("HS1-10"));

const saleProgramAccess = require("../lib/sale-program-access");
assert(
  "agent-role closer bypasses program gate",
  saleProgramAccess.canBypassProgramGate(closerAgent) === true
);
assert(
  "plain agent with unset flags can submit both programs",
  JSON.stringify(saleProgramAccess.enabledProgramsForSubmitter(plainAgent, employees)) ===
    JSON.stringify(["mla", "rpm"])
);
assert(
  "unset program flags do not block submit",
  saleProgramAccess.assertAgentProgramEnabled(employees.find((e) => e.id === "HS1-10"), "mla", plainAgent).ok
);

const submitFields = catalog.listFieldsForSubmit("agent");
assert(
  "submit surface includes paymentMethod",
  submitFields.some((f) => f.key === "paymentMethod" && f.canEdit === true)
);
assert(
  "submit surface excludes quality section",
  !submitFields.some((f) => f.section === "quality")
);
assert(
  "submit surface excludes verifierFeedback",
  !submitFields.some((f) => f.key === "verifierFeedback")
);

const permMap = Object.fromEntries(
  catalog.FIELDS.map((f) => [
    f.key,
    {
      fieldKey: f.key,
      edit_roles: [],
      main_view_roles: [],
      quality_view_roles: [],
    },
  ])
);
const sanitized = catalog.sanitizeFormPayload(
  { paymentMethod: "Card", cardNumber: "4111", notes: "x" },
  "agent",
  permMap,
  { create: true }
);
assert("create sanitize keeps fields without edit_roles", sanitized.paymentMethod === "Card" && sanitized.cardNumber === "4111");

try {
  requestRules.validateRequestSubmit({
    requestKind: "annual",
    employeeId: "HS1-10",
    startDate: "2026-07-10",
    endDate: "2026-07-10",
    actorRole: plainAgent,
    forEmployeeId: "HS1-10",
  });
  assert("agent annual no-emp-date rejected", false);
} catch (e) {
  assert("agent annual no-emp-date rejected", /employment date/i.test(e.message));
}

const recentHire = { id: "HS1-10", employment_date: "2026-06-01" };
try {
  requestRules.validateRequestSubmit({
    requestKind: "annual",
    employeeId: "HS1-10",
    startDate: "2026-07-10",
    endDate: "2026-07-10",
    actorRole: plainAgent,
    targetEmp: recentHire,
    forEmployeeId: "HS1-10",
  });
  assert("agent annual under-180 rejected", false);
} catch (e) {
  assert("agent annual under-180 rejected", /Annual leave requires 180\+ days/i.test(e.message));
}

const oldHire = { id: "HS1-10", employment_date: "2024-01-15" };
const result = requestRules.validateRequestSubmit({
  requestKind: "annual",
  employeeId: "HS1-10",
  startDate: "2026-07-10",
  endDate: "2026-07-10",
  actorRole: plainAgent,
  targetEmp: oldHire,
  forEmployeeId: "HS1-10",
});
assert("agent annual over-180 approved", result.paidLeave === true && result.requestKind === "annual");

assert(
  "self upload doc types",
  documents.SELF_UPLOAD_DOC_TYPES.includes("National ID") &&
    documents.SELF_UPLOAD_DOC_TYPES.includes("Medical Note") &&
    !documents.SELF_UPLOAD_DOC_TYPES.includes("Contract")
);

if (!process.exitCode) console.log("\nAll tests passed.");

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
  { id: "HS1-05", unit: "HS-1", team: "Phoenix", american_name: "Dual TL" },
  { id: "HS1-10", unit: "HS-1", team: "Phoenix", american_name: "Peer Agent" },
  { id: "HS1-20", unit: "HS-1", team: "Phoenix", american_name: "Agent Two" },
  { id: "TL1-01", unit: "HS-1", team: "Phoenix", american_name: "Team Lead" },
  { id: "OP1-01", unit: "HS-1", team: "Ops", american_name: "OP One" },
  { id: "HS3-30", unit: "HS-3", team: "Ayla", american_name: "Led Agent" },
  { id: "TL3-01", unit: "HS-3", team: "Ayla", american_name: "TL Three" },
];

const plainAgent = { role: "agent", employeeId: "HS1-10", unit: "HS-1", team: "Phoenix", leadTeams: [] };
const dualAgent = {
  role: "agent",
  employeeId: "HS1-05",
  unit: "HS-1",
  team: "Phoenix",
  leadTeams: [{ unit: "HS-3", team: "Ayla" }],
};
const tlUser = { role: "tl", employeeId: "TL1-01", unit: "HS-1", team: "Phoenix", leadTeams: [] };
const opUser = { role: "op", employeeId: "OP1-01", unit: "HS-1", leadTeams: [] };

const plainAgents = scope.employeesForAgentPicker(plainAgent, employees);
assert("plain agent picker is self only", plainAgents.length === 1 && plainAgents[0].id === "HS1-10");

const dualAgents = scope.employeesForAgentPicker(dualAgent, employees).map((e) => e.id).sort();
assert(
  "dual-role agent sees both units dialing agents",
  JSON.stringify(dualAgents) === JSON.stringify(["HS1-05", "HS1-10", "HS1-20", "HS3-30"])
);

const tlAgents = scope.employeesForAgentPicker(tlUser, employees).map((e) => e.id).sort();
assert("TL sees unit dialing agents", tlAgents.includes("HS1-10") && !tlAgents.includes("HS3-30"));

const plainClosers = scope.employeesForCloserPicker(plainAgent, employees).map((e) => e.id);
assert("plain agent closers include cross-unit TL", plainClosers.includes("TL1-01") && plainClosers.includes("TL3-01"));

const dualClosers = scope.employeesForCloserPicker(dualAgent, employees).map((e) => e.id);
assert("dual agent closers are global", dualClosers.includes("TL1-01") && dualClosers.includes("TL3-01"));

const badCloser = scope.validateSaleSubmitAssignment(
  plainAgent,
  { agentId: "HS1-10", closerId: "TL3-01", unit: "HS-1", team: "Phoenix" },
  employees
);
assert("plain agent can pick closer from another unit", badCloser.ok === true);

const goodPlain = scope.validateSaleSubmitAssignment(
  plainAgent,
  { agentId: "HS1-10", closerId: "TL1-01", unit: "HS-1", team: "Phoenix" },
  employees
);
assert("plain agent valid unit closer", goodPlain.ok);

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
  assert("agent annual rejected", false);
} catch (e) {
  assert("agent annual rejected", /cannot submit annual/i.test(e.message));
}

assert(
  "self upload doc types",
  documents.SELF_UPLOAD_DOC_TYPES.includes("National ID") &&
    documents.SELF_UPLOAD_DOC_TYPES.includes("Medical Note") &&
    !documents.SELF_UPLOAD_DOC_TYPES.includes("Contract")
);

if (!process.exitCode) console.log("\nAll tests passed.");

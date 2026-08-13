/**
 * TL vs closer org assignments and on-behalf scopes.
 */
const assert = require("assert");
const roles = require("../lib/roles");
const requestRules = require("../lib/request-rules");
const saleScope = require("../lib/sale-submit-scope");

const orgTeams = [
  { id: "t1", name: "Phoenix", unit: "HS-1", tlEmployeeId: "TL1-01", tlEmployeeIds: ["TL1-01"], closerEmployeeIds: ["HS1-05"] },
  { id: "t2", name: "Ayla", unit: "HS-3", tlEmployeeId: "TL3-01", tlEmployeeIds: ["TL3-01"], closerEmployeeIds: [] },
];

const employees = [
  { id: "HS1-10", unit: "HS-1", team: "Phoenix", status: "Active", employment_date: "2024-01-01" },
  { id: "HS1-20", unit: "HS-1", team: "Phoenix", status: "Active", employment_date: "2024-01-01" },
  { id: "HS1-05", unit: "HS-1", team: "Phoenix", status: "Active", employment_date: "2024-01-01" },
  { id: "HS3-30", unit: "HS-3", team: "Ayla", status: "Active", employment_date: "2024-01-01" },
  { id: "TL1-01", unit: "HS-1", team: "Phoenix", status: "Active" },
  { id: "TL3-01", unit: "HS-3", team: "Ayla", status: "Active" },
  { id: "HS1-99", unit: "HS-1", team: "Phoenix", status: "Out", employment_date: "2024-01-01" },
];

function userRole(overrides) {
  const base = { role: "agent", employeeId: "HS1-05", unit: "HS-1", team: "Phoenix", username: "closer" };
  const ur = { ...base, ...overrides };
  return roles.attachLeadTeams(ur, orgTeams);
}

console.log("tl-closer-scope");

const closerOnly = userRole({ employeeId: "HS1-05", closerTeams: undefined });
assert.ok(roles.hasCloserTeamAssignment(closerOnly), "closer assignment from org");
assert.ok(!roles.hasLeadTeamAssignment(closerOnly), "not a TL");

assert.ok(roles.canSubmitItOnBehalf(closerOnly, employees[0]), "closer IT on behalf team agent");
assert.ok(!roles.canSubmitLeaveOnBehalf(closerOnly, employees[0]), "closer cannot leave on behalf");

const tlUser = userRole({ role: "tl", employeeId: "TL1-01", leadTeams: [{ unit: "HS-1", team: "Phoenix" }] });
assert.ok(roles.canSubmitLeaveOnBehalf(tlUser, employees[0]), "TL leave on behalf");
assert.ok(roles.canSubmitItOnBehalf(tlUser, employees[0]), "TL IT on behalf");
assert.ok(!roles.canSubmitItOnBehalf(tlUser, employees[3]), "TL cannot IT for other unit team");

assert.ok(!roles.canSubmitItOnBehalf(closerOnly, employees[6]), "out agent blocked for IT");

const closerAgents = saleScope.employeesForAgentPicker(closerOnly, employees).map((e) => e.id).sort();
assert.deepStrictEqual(closerAgents, ["HS1-05", "HS1-10", "HS1-20"], "closer sales picker is team agents only");

const plainAgent = userRole({ employeeId: "HS1-10", leadTeams: [], closerTeams: [] });
const plainPick = saleScope.employeesForAgentPicker(plainAgent, employees);
assert.strictEqual(plainPick.length, 1, "plain agent self only sales");

try {
  requestRules.validateRequestSubmit({
    requestKind: "unpaid",
    employeeId: "HS1-10",
    startDate: "2026-08-05",
    endDate: "2026-08-05",
    actorRole: closerOnly,
    targetEmp: employees[0],
    forEmployeeId: "HS1-10",
  });
  assert.fail("closer leave should throw");
} catch (e) {
  assert.match(e.message, /only request leave for themselves/i);
}

const leaveList = roles.employeesForLeaveOnBehalf(tlUser, employees).map((e) => e.id).sort();
assert.ok(leaveList.includes("HS1-10") && !leaveList.includes("HS3-30"), "TL leave scope is team");

const itList = roles.employeesForItOnBehalf(closerOnly, employees).map((e) => e.id).sort();
assert.deepStrictEqual(itList, ["HS1-05", "HS1-10", "HS1-20"], "closer IT scope active team agents");

const dashEmps = roles.filterEmployeesForTeamDashboard(employees, closerOnly).map((e) => e.id).sort();
assert.ok(dashEmps.includes("HS1-10"), "closer sees team on dashboard");

console.log("  ok all tl-closer-scope tests");

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

// Import-from-open-Q must use sale agent picker scope, not attendance filterEmployeesForUser
const attendanceScope = roles.filterEmployeesForUser(employees, closerOnly).map((e) => e.id);
assert.deepStrictEqual(attendanceScope, ["HS1-05"], "closer attendance roster is self-only");
const saleAgents = saleScope
  .employeesForAgentPicker(closerOnly, employees, { orgTeams })
  .map((e) => e.id)
  .sort();
assert.ok(saleAgents.includes("HS1-10") && saleAgents.includes("HS1-20"), "closer sale agent picker includes team");
assert.ok(roles.canImportRpmSaleFromCheck(closerOnly), "closer may import open Q");

const closerWithTlAccess = userRole({
  role: "tl",
  employeeId: "HS1-05",
  leadTeams: [],
});
assert.ok(!roles.hasLeadTeamAssignment(closerWithTlAccess), "Amy/Ria-style closer is not an assigned TL");
assert.ok(roles.hasCloserTeamAssignment(closerWithTlAccess), "still a closer");
assert.deepStrictEqual(
  roles.filterEmployeesForUser(employees, closerWithTlAccess).map((e) => e.id),
  ["HS1-05"],
  "unassigned TL closer sees only own attendance roster"
);
assert.ok(!roles.canAccessEmployee(closerWithTlAccess, employees[0]), "cannot open teammate attendance");
assert.ok(roles.canAccessEmployee(closerWithTlAccess, employees[2]), "can open own row");
assert.strictEqual(roles.uniqueCloserTeamCount(closerWithTlAccess), 1, "close-teams KPI is unique closer teams");
assert.ok(roles.usesCloseTeamsDashboardKpi(closerWithTlAccess), "TL/closer dashboard hides Units");

const assignedTl = userRole({ role: "tl", employeeId: "TL1-01" });
assert.ok(roles.hasLeadTeamAssignment(assignedTl), "org TL is assigned");
const tlRoster = roles.filterEmployeesForUser(employees, assignedTl).map((e) => e.id).sort();
assert.ok(tlRoster.includes("HS1-10") && tlRoster.includes("HS1-05"), "assigned TL still sees led team attendance");
assert.ok(roles.usesCloseTeamsDashboardKpi(assignedTl), "assigned TL also uses close-teams KPI");

console.log("  ok all tl-closer-scope tests");

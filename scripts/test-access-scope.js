#!/usr/bin/env node
/** Access scope: dual-role TL, export defaults, team dashboard weekends. */
const roles = require("../lib/roles");
const salesScope = require("../lib/sales-scope");
const teamDashboard = require("../lib/team-dashboard");

function test(name, fn) {
  try {
    fn();
    console.log("  ok", name);
  } catch (e) {
    console.error("  FAIL", name, e.message);
    process.exitCode = 1;
  }
}

console.log("access-scope");

const employees = [
  { id: "HS1-05", unit: "HS-1", team: "Phoenix", american_name: "Dual TL" },
  { id: "HS1-10", unit: "HS-1", team: "Phoenix", american_name: "Peer Agent" },
  { id: "HS3-20", unit: "HS-3", team: "Ayla", american_name: "Led Agent" },
];

const orgTeams = [
  { name: "Ayla", unit: "HS-3", tlEmployeeId: "HS1-05", dialsSales: true },
  { name: "Phoenix", unit: "HS-1", tlEmployeeId: "", dialsSales: true },
];

test("dual-role agent sees self + led team only", () => {
  const ur = roles.enrichUserRole(
    roles.resolveUserRole("hs1-05", "agent"),
    employees,
    { employee_id: "HS1-05" },
    orgTeams
  );
  const scoped = roles.filterEmployeesForUser(employees, ur).map((e) => e.id).sort();
  if (JSON.stringify(scoped) !== JSON.stringify(["HS1-05", "HS3-20"])) {
    throw new Error(`expected HS1-05 + HS3-20, got ${scoped.join(", ")}`);
  }
});

test("dual-role agent cannot see home-team peer", () => {
  const ur = roles.enrichUserRole(
    roles.resolveUserRole("hs1-05", "agent"),
    employees,
    { employee_id: "HS1-05" },
    orgTeams
  );
  if (roles.canAccessEmployee(ur, employees[1])) throw new Error("should not access peer on home team");
});

test("dual-role agent can view led team sale", () => {
  const ur = roles.enrichUserRole(
    roles.resolveUserRole("hs1-05", "agent"),
    employees,
    { employee_id: "HS1-05" },
    orgTeams
  );
  const sale = { agentId: "HS3-20", unit: "HS-3", team: "Ayla", status: "passed" };
  if (!salesScope.defaultCanViewSale(sale, ur, employees)) throw new Error("should view led team sale");
});

test("exportSales default off for TL/OP/agent", () => {
  for (const role of ["agent", "tl", "op", "finance", "hr"]) {
    const ur = { role, username: role };
    if (roles.canExportSales(ur)) throw new Error(`${role} should not export by default`);
  }
});

test("exportSales default on for quality/admin", () => {
  for (const role of ["quality", "admin", "rtm", "ceo"]) {
    const ur = { role, username: role };
    if (!roles.canExportSales(ur)) throw new Error(`${role} should export by default`);
  }
});

test("weekend with no work shows DAY-OFF row", () => {
  const saturday = "2026-07-04";
  const day = teamDashboard.buildDayDashboard({
    date: saturday,
    sales: [],
    employees,
    attendanceRecords: [],
    teamsMeta: orgTeams,
  });
  const phoenixRow = day.agentRows.find((r) => r.teamKey === "Phoenix");
  if (!phoenixRow || phoenixRow.agentName !== "DAY-OFF") {
    throw new Error(`expected DAY-OFF for Phoenix on Saturday, got ${JSON.stringify(day.agentRows)}`);
  }
});

test("weekend with Attended shows agent row", () => {
  const saturday = "2026-07-04";
  const day = teamDashboard.buildDayDashboard({
    date: saturday,
    sales: [],
    employees,
    attendanceRecords: [{ employeeId: "HS1-10", date: saturday, status: "Attended" }],
    teamsMeta: orgTeams,
  });
  const worked = day.agentRows.find((r) => r.agentId === "HS1-10");
  if (!worked) throw new Error("expected HS1-10 row when Attended on Saturday");
});

if (process.exitCode) {
  console.error("\nSome tests failed.");
  process.exit(1);
}
console.log("\nAll tests passed.");

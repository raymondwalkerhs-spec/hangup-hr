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
  const sale = { agentId: "HS3-20", closerId: "TL3-01", unit: "HS-3", team: "Ayla", status: "passed" };
  if (!salesScope.defaultCanViewSale(sale, ur, employees)) throw new Error("should view led team sale");
});

test("assigned agent sees own sale", () => {
  const ur = { role: "agent", employeeId: "HS1-10", unit: "HS-1", team: "Phoenix" };
  const sale = { agentId: "HS1-10", closerId: "TL1-01", unit: "HS-1", team: "Phoenix", status: "passed" };
  if (!salesScope.defaultCanViewSale(sale, ur, employees)) throw new Error("agent should see own sale");
});

test("assigned closer sees sale under their closer field", () => {
  const ur = {
    role: "agent",
    employeeId: "HS3-18",
    unit: "HS-3",
    team: "Management",
    closerTeams: [{ unit: "HS-3", team: "Tris" }],
    leadTeams: [],
  };
  const sale = { agentId: "HS3-20", closerId: "HS3-18", unit: "HS-3", team: "Tris", status: "passed" };
  if (!salesScope.defaultCanViewSale(sale, ur, employees)) throw new Error("closer should see assigned sale");
});

test("unassigned TL closer sees only self in employee/attendance roster", () => {
  const closerOrg = [
    { name: "Phoenix", unit: "HS-1", tlEmployeeId: "TL1-01", closerEmployeeIds: ["HS1-05"] },
  ];
  const ur = roles.attachLeadTeams(
    { role: "tl", employeeId: "HS1-05", unit: "HS-1", team: "Phoenix", username: "amy" },
    closerOrg
  );
  if (roles.hasLeadTeamAssignment(ur)) throw new Error("should not be assigned TL");
  const scoped = roles.filterEmployeesForUser(employees, ur).map((e) => e.id);
  if (JSON.stringify(scoped) !== JSON.stringify(["HS1-05"])) {
    throw new Error(`expected self only, got ${scoped.join(", ")}`);
  }
  if (roles.canAccessEmployee(ur, employees[1])) throw new Error("should not access home-team peer");
  if (!roles.usesCloseTeamsDashboardKpi(ur)) throw new Error("should use close-teams dashboard KPI");
});

test("assigned TL still sees led team in employee/attendance roster", () => {
  const ur = roles.attachLeadTeams(
    { role: "tl", employeeId: "HS1-05", unit: "HS-1", team: "Phoenix", username: "tl" },
    orgTeams
  );
  if (!roles.hasLeadTeamAssignment(ur)) throw new Error("HS1-05 leads Ayla in this fixture");
  const scoped = roles.filterEmployeesForUser(employees, ur).map((e) => e.id).sort();
  if (!scoped.includes("HS3-20") || !scoped.includes("HS1-05")) {
    throw new Error(`expected self + Ayla, got ${scoped.join(", ")}`);
  }
});

test("OP assigned via unit_ops can access extra unit", () => {
  const ur = roles.attachOpUnits(
    { role: "op", employeeId: "OP1", unit: "HS-1", username: "steven" },
    { "HS-1": ["OP1"], "HS-3": ["OP1"] }
  );
  if (!ur.opUnits.includes("HS-3")) throw new Error("HS-3 missing from opUnits");
  if (!roles.employeeInOpUnitScope(ur, { id: "HS3-20", unit: "HS-3" })) {
    throw new Error("OP should access HS-3 after unit_ops assignment");
  }
  const sale = { agentId: "HS3-20", closerId: "TL3-01", unit: "HS-3", team: "Ayla", status: "passed" };
  if (!salesScope.defaultCanViewSale(sale, ur, employees)) throw new Error("OP should view HS-3 sale");
});

test("unit ops merge shows HS-3 OP from join table and manager field", () => {
  const teamTlsRepo = require("../lib/team-tls-repo");
  const merged = teamTlsRepo.mergeUnitOpsMaps(
    { "HS-3": ["OP1"] },
    [
      { unit: "HS-1", opEmployeeId: "TL01" },
      { unit: "HS-3", opEmployeeId: "OP1" },
      { unit: "HS-2", opEmployeeId: "MG2" },
    ]
  );
  if (!merged["HS-3"]?.includes("OP1")) throw new Error("HS-3 OP1 missing");
  if (!merged["HS-1"]?.includes("TL01")) throw new Error("HS-1 manager OP missing");
  const hangup = teamTlsRepo.filterUnitOpsByCompany(merged, "hangup");
  if (!hangup["HS-3"]?.includes("OP1")) throw new Error("hangup filter dropped HS-3 OP");
  if (hangup["HS-2"]) throw new Error("HS-2 OP should not appear on Hangup");
});

test("org closer does not see team sale unless named closer", () => {
  const ur = {
    role: "tl",
    employeeId: "HS3-18",
    unit: "HS-3",
    team: "Management",
    closerTeams: [{ unit: "HS-3", team: "Tris" }],
    leadTeams: [],
  };
  const sale = { agentId: "HS3-20", closerId: "TL3-01", unit: "HS-3", team: "Tris", status: "passed" };
  if (salesScope.defaultCanViewSale(sale, ur, employees)) {
    throw new Error("org closer should not see sale they are not named on");
  }
});

test("team TL sees team sale even if not agent/closer", () => {
  const ur = {
    role: "tl",
    employeeId: "TL3-01",
    unit: "HS-3",
    team: "Tris",
    leadTeams: [{ unit: "HS-3", team: "Tris" }],
  };
  const sale = { agentId: "HS3-20", closerId: "HS3-18", unit: "HS-3", team: "Tris", status: "passed" };
  if (!salesScope.defaultCanViewSale(sale, ur, employees)) throw new Error("TL should see team sale");
});

test("plain agent does not see teammate sale", () => {
  const ur = { role: "agent", employeeId: "HS1-10", unit: "HS-1", team: "Phoenix", leadTeams: [], closerTeams: [] };
  const sale = { agentId: "HS1-05", closerId: "TL1-01", unit: "HS-1", team: "Phoenix", status: "passed" };
  if (salesScope.defaultCanViewSale(sale, ur, employees)) throw new Error("peer agent should not see teammate sale");
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

test("quality role sees full employee roster", () => {
  const ur = { role: "quality", username: "qa" };
  const scoped = roles.filterEmployeesForUser(employees, ur).map((e) => e.id).sort();
  const all = employees.map((e) => e.id).sort();
  if (JSON.stringify(scoped) !== JSON.stringify(all)) {
    throw new Error(`quality expected full roster, got ${scoped.join(", ")}`);
  }
});

test("rtm role sees full employee roster", () => {
  const ur = { role: "rtm", username: "rtm" };
  const scoped = roles.filterEmployeesForUser(employees, ur).map((e) => e.id).sort();
  const all = employees.map((e) => e.id).sort();
  if (JSON.stringify(scoped) !== JSON.stringify(all)) {
    throw new Error(`rtm expected full roster, got ${scoped.join(", ")}`);
  }
});

test("dual-role org filter hides home-team peer agents", () => {
  const hrms = require("../lib/hrms-repo");
  const store = require("../lib/data-store");
  const origGet = store.getEmployeeById.bind(store);
  store.getEmployeeById = (id) => employees.find((e) => e.id === id) || origGet(id);

  const ur = roles.enrichUserRole(
    roles.resolveUserRole("hs1-05", "agent"),
    employees,
    { employee_id: "HS1-05" },
    orgTeams
  );
  const structure = {
    units: [
      {
        unit: "HS-1",
        teams: [
          { name: "Phoenix", agents: [{ id: "HS1-05" }, { id: "HS1-10" }] },
        ],
      },
      {
        unit: "HS-3",
        teams: [{ name: "Ayla", agents: [{ id: "HS3-20" }] }],
      },
    ],
    unassigned: [],
  };
  const filtered = hrms.filterOrgStructureForRole(structure, ur);
  const phoenix = filtered.units.flatMap((u) => u.teams).find((t) => t.name === "Phoenix");
  const ayla = filtered.units.flatMap((u) => u.teams).find((t) => t.name === "Ayla");
  const phoenixIds = (phoenix?.agents || []).map((a) => a.id).sort();
  const aylaIds = (ayla?.agents || []).map((a) => a.id);
  store.getEmployeeById = origGet;
  if (JSON.stringify(phoenixIds) !== JSON.stringify(["HS1-05"])) {
    throw new Error(`Phoenix should only show self, got ${phoenixIds.join(", ")}`);
  }
  if (JSON.stringify(aylaIds) !== JSON.stringify(["HS3-20"])) {
    throw new Error(`Ayla should show led agent HS3-20, got ${aylaIds.join(", ")}`);
  }
});

if (process.exitCode) {
  console.error("\nSome tests failed.");
  process.exit(1);
}
console.log("\nAll tests passed.");

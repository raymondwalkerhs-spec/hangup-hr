const test = require("node:test");
const assert = require("node:assert/strict");
const teamDashboard = require("../lib/team-dashboard");
const teamDashboardRoster = require("../lib/team-dashboard-roster");

const employees = [
  { id: "HS1-10", unit: "HS-1", team: "Phoenix", american_name: "Agent One", status: "active" },
  { id: "HS1-05", unit: "HS-1", team: "Ayla", american_name: "Ayla TL", status: "active", position: "Agent" },
  { id: "HS1-11", unit: "HS-1", team: "Phoenix", american_name: "Paused Agent", status: "Paused" },
];
const teamsMeta = [
  { id: "t1", name: "Phoenix", unit: "HS-1", tlEmployeeId: "TL1", dialsSales: true },
  { id: "t2", name: "Ayla", unit: "HS-1", tlEmployeeId: "HS1-05", dialsSales: true },
];
const appUsers = [{ username: "ayla", role: "tl", employeeId: "HS1-05" }];
test("agentCountsForDay includes pending sales in totalSent", () => {
  const date = "2026-08-04";
  const sales = [
    {
      agentId: "HS1-10",
      status: "pending",
      submissionDate: date,
      workingDay: date,
    },
  ];
  const counts = teamDashboard.agentCountsForDay(sales, "HS1-10", date);
  assert.equal(counts.approved, 0);
  assert.equal(counts.pending, 1);
  assert.equal(counts.totalSent, 1);
});

test("buildDayDashboard counts passed sale on working day", () => {
  const workingDay = "2026-08-03";
  const sales = [
    {
      agentId: "HS1-10",
      status: "passed",
      submissionDate: "2026-08-04",
      workingDay,
      effectiveDate: workingDay,
      team: "Phoenix",
      unit: "HS-1",
    },
  ];

  const day = teamDashboard.buildDayDashboard({
    date: workingDay,
    sales,
    employees,
    attendanceRecords: [],
    teamsMeta,
  });
  assert.equal(day.totals.approved, 1);
  assert.equal(day.totals.totalSent, 1);
});

test("buildDayDashboard excludes org TL and paused agents from roster", () => {
  const day = teamDashboard.buildDayDashboard({
    date: "2026-08-04",
    sales: [
      {
        agentId: "HS1-05",
        status: "passed",
        submissionDate: "2026-08-04",
        workingDay: "2026-08-04",
        effectiveDate: "2026-08-04",
        team: "Ayla",
        unit: "HS-1",
      },
      {
        agentId: "HS1-11",
        status: "passed",
        submissionDate: "2026-08-04",
        workingDay: "2026-08-04",
        effectiveDate: "2026-08-04",
        team: "Phoenix",
        unit: "HS-1",
      },
    ],
    employees,
    attendanceRecords: [],
    teamsMeta,
    appUsers,
  });

  const names = (day.agentRows || []).map((r) => r.agentName);
  assert.ok(!names.some((n) => String(n).includes("Ayla")));
  assert.ok(!names.some((n) => String(n).includes("Paused")));
});

test("team target percentage is approved over active agents", () => {
  const pct = teamDashboardRoster.teamTargetPercentage(2, 4);
  assert.equal(pct, "50.00%");

  const day = teamDashboard.buildDayDashboard({
    date: "2026-08-04",
    sales: [
      {
        agentId: "HS1-10",
        status: "passed",
        submissionDate: "2026-08-04",
        workingDay: "2026-08-04",
        effectiveDate: "2026-08-04",
        team: "Phoenix",
        unit: "HS-1",
      },
      {
        agentId: "HS1-10",
        status: "passed",
        submissionDate: "2026-08-04",
        workingDay: "2026-08-04",
        effectiveDate: "2026-08-04",
        team: "Phoenix",
        unit: "HS-1",
      },
    ],
    employees,
    attendanceRecords: [],
    teamsMeta,
    appUsers,
  });
  const phoenix = (day.teamSummaries || []).find((t) => t.team === "Phoenix");
  assert.equal(phoenix?.activeAgentsCount, 1);
  assert.equal(phoenix?.targetPercentage, "200.00%");
});

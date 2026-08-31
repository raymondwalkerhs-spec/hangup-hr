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
test("agentCountsForDay uses RPM client feedback buckets", () => {
  const date = "2026-08-18";
  const sales = [
    { agentId: "HS1-10", status: "passed", workingDay: date, formData: { clientFeedback: "Approved" } },
    { agentId: "HS1-10", status: "pending", workingDay: date, formData: { clientFeedback: "Pending" } },
    { agentId: "HS1-10", status: "denied", workingDay: date, formData: { clientFeedback: "Denied" } },
    { agentId: "HS1-10", status: "callback", workingDay: date, formData: { clientFeedback: "Retransfer", retransfer: true } },
  ];
  const counts = teamDashboard.agentCountsForDay(sales, "HS1-10", date);
  assert.equal(counts.approved, 1);
  assert.equal(counts.pending, 1);
  assert.equal(counts.dropped, 1);
  assert.equal(counts.retransfer, 1);
  assert.equal(counts.totalSent, 4);
});

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

test("team conversion is sent sales over Q checks", () => {
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
        formData: { clientFeedback: "Approved" },
      },
      {
        agentId: "HS1-10",
        status: "pending",
        submissionDate: "2026-08-04",
        workingDay: "2026-08-04",
        effectiveDate: "2026-08-04",
        team: "Phoenix",
        unit: "HS-1",
        formData: { clientFeedback: "Pending" },
      },
      {
        agentId: "HS1-10",
        status: "denied",
        submissionDate: "2026-08-04",
        workingDay: "2026-08-04",
        effectiveDate: "2026-08-04",
        team: "Phoenix",
        unit: "HS-1",
        formData: { clientFeedback: "Denied" },
      },
    ],
    employees,
    attendanceRecords: [],
    teamsMeta,
    appUsers,
    checksByAgent: {
      "HS1-10": { q: 8, nq: 0, age_limit: 0, under_age: 0, duplicate: 0 },
    },
  });
  const phoenix = (day.teamSummaries || []).find((t) => t.team === "Phoenix");
  assert.equal(phoenix?.approved, 1);
  assert.equal(phoenix?.pending, 1);
  assert.equal(phoenix?.passedPending, 2);
  assert.equal(phoenix?.total, 3);
  assert.equal(phoenix?.checksQ, 8);
  // Sent Sales 3 / Q 8 = 37.50%
  assert.equal(phoenix?.conversion, "37.50%");
  assert.equal(phoenix?.targetPercentage, "300.00%");
});

test("team target percentage is sent sales over active agents", () => {
  const pct = teamDashboardRoster.teamTargetPercentage(2, 4);
  assert.equal(pct, "50.00%");

  const weekPct = teamDashboardRoster.teamTargetPercentage(10, 2, 5);
  assert.equal(weekPct, "100.00%");

  const monthPct = teamDashboardRoster.teamTargetPercentage(40, 2, 20);
  assert.equal(monthPct, "100.00%");

  assert.equal(teamDashboardRoster.targetDivisorForPeriod("day"), 1);
  assert.equal(teamDashboardRoster.targetDivisorForPeriod("week"), 5);
  const augWeeks = teamDashboardRoster.targetDivisorForPeriod("month", "2026-08-01", "2026-08-31");
  assert.equal(augWeeks % 5, 0);
  assert.ok(augWeeks >= 5);

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

test("period totals aggregate week like HS3", () => {
  const dash = teamDashboard.buildPeriodTotalsDashboard({
    from: "2026-08-03",
    to: "2026-08-09",
    sales: [
      {
        agentId: "HS1-10",
        workingDay: "2026-08-04",
        submissionDate: "2026-08-04",
        team: "Phoenix",
        unit: "HS-1",
        formData: { clientFeedback: "Approved" },
      },
      {
        agentId: "HS1-10",
        workingDay: "2026-08-05",
        submissionDate: "2026-08-05",
        team: "Phoenix",
        unit: "HS-1",
        formData: { clientFeedback: "Pending" },
      },
    ],
    employees,
    attendanceRecords: [],
    teamsMeta,
    appUsers,
    checksByAgent: {
      "HS1-10": { q: 4, nq: 2, age_limit: 0, under_age: 0, duplicate: 1 },
    },
  });
  const row = (dash.agentRows || []).find((r) => r.agentId === "HS1-10");
  assert.equal(row?.totalSent, 2);
  assert.equal(row?.checksQ, 4);
  assert.equal(row?.checksTotal, 7);
  const phoenix = (dash.teamSummaries || []).find((t) => t.team === "Phoenix");
  assert.equal(phoenix?.conversion, "50.00%");
});

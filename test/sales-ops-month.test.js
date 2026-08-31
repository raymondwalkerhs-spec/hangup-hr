const test = require("node:test");
const assert = require("node:assert/strict");
const ops = require("../lib/sales-ops-month");

const sales = [
  {
    id: "s1",
    agentId: "A1",
    closerId: "CL1",
    team: "Justin",
    unit: "HS-3",
    workingDay: "2026-08-10",
    status: "passed",
  },
  {
    id: "s2",
    agentId: "A2",
    closerId: "CL2",
    team: "Jude",
    unit: "HS-3",
    workingDay: "2026-08-11",
    status: "pending",
  },
  {
    id: "s3",
    agentId: "A3",
    closerId: "CL1",
    team: "Justin",
    unit: "HS-1",
    workingDay: "2026-08-10",
    status: "passed",
  },
];

const employees = [
  { id: "A1", team: "Justin", unit: "HS-3" },
  { id: "A2", team: "Jude", unit: "HS-3" },
  { id: "A3", team: "Justin", unit: "HS-1" },
  { id: "TL1", team: "Justin", unit: "HS-3" },
  { id: "CL1", team: "Management", unit: "HS-3" },
  { id: "OP1", team: "OP", unit: "HS-3" },
];

const attendance = [
  { employeeId: "A1", date: "2026-08-10", status: "Day-OFF" },
  { employeeId: "A2", date: "2026-08-10", status: "NSNC" },
  { employeeId: "A1", date: "2026-08-11", status: "Half Day" },
  { employeeId: "A2", date: "2026-08-11", status: "WFH" },
  { employeeId: "A3", date: "2026-08-10", status: "Attended" },
];

const agent = { role: "agent", employeeId: "A1", username: "agent1" };
const tl = {
  role: "tl",
  employeeId: "TL1",
  username: "tl1",
  team: "Justin",
  unit: "HS-3",
  leadTeams: [{ team: "Justin", unit: "HS-3" }],
};
const closer = {
  role: "agent",
  employeeId: "CL1",
  username: "amy",
  closerTeams: [{ team: "Justin", unit: "HS-3" }],
};
const closerTl = {
  role: "tl",
  employeeId: "CL1",
  username: "amy-tl",
  unit: "HS-3",
  leadTeams: [{ team: "Justin", unit: "HS-3" }],
  closerTeams: [{ team: "Jude", unit: "HS-3" }],
};
const op = { role: "op", employeeId: "OP1", username: "op1", unit: "HS-3" };
const rtm = { role: "rtm", employeeId: "RTM1", username: "rtm1" };

function ids(list) {
  return list.map((s) => s.id).sort().join(",");
}

test("dashboard ops sales scope matrix", () => {
  assert.equal(ids(ops.filterSalesForDashboardOps(sales, agent)), "s1");
  assert.equal(ids(ops.filterSalesForDashboardOps(sales, closer)), "s1,s3");
  assert.equal(ids(ops.filterSalesForDashboardOps(sales, tl)), "s1");
  assert.equal(ids(ops.filterSalesForDashboardOps(sales, op)), "s1,s2");
  assert.equal(ids(ops.filterSalesForDashboardOps(sales, rtm)), "s1,s2,s3");
  assert.equal(ids(ops.filterSalesForDashboardOps(sales, closerTl)), "s1,s3");
});

test("TL closer split: closed vs team slices", () => {
  assert.equal(ops.shouldSplitTlClosedTeam(closerTl), true);
  assert.equal(ops.shouldSplitTlClosedTeam(tl), false);
  assert.equal(ops.shouldSplitTlClosedTeam(closer), false);
  assert.equal(ids(ops.filterSalesForDashboardOps(sales, closerTl, "closed")), "s1,s3");
  assert.equal(ids(ops.filterSalesForDashboardOps(sales, closerTl, "team")), "s1");
});

// Amy/Ria-style: app role TL + org closer, but not org tlEmployeeId (empty leadTeams)
test("TL closer without leadTeams still splits Closed + Team", () => {
  const amyStyle = {
    role: "tl",
    employeeId: "CL1",
    username: "amy",
    team: "Justin",
    unit: "HS-3",
    leadTeams: [],
    closerTeams: [{ team: "Justin", unit: "HS-3" }],
  };
  assert.equal(ops.describeScope(amyStyle), "team+closed");
  assert.equal(ops.shouldSplitTlClosedTeam(amyStyle), true);
  assert.equal(ids(ops.filterSalesForDashboardOps(sales, amyStyle, "closed")), "s1,s3");
  assert.equal(ids(ops.filterSalesForDashboardOps(sales, amyStyle, "team")), "s1");
  const month = ops.buildOpsMonth({
    month: "2026-08",
    sales,
    employees,
    attendanceRecords: attendance,
    userRole: amyStyle,
  });
  assert.equal(month.split, true);
  assert.ok(month.closed);
  assert.ok(month.team);
});

test("company roles never split — keep combined status + month curve", () => {
  for (const role of ["admin", "rtm", "ceo", "hr", "quality", "finance"]) {
    const ur = {
      role,
      employeeId: "CL1",
      username: role,
      leadTeams: [{ team: "Justin", unit: "HS-3" }],
      closerTeams: [{ team: "Jude", unit: "HS-3" }],
    };
    assert.equal(ops.describeScope(ur), "company");
    assert.equal(ops.shouldSplitTlClosedTeam(ur), false);
    const month = ops.buildOpsMonth({
      month: "2026-08",
      sales,
      employees,
      attendanceRecords: attendance,
      userRole: ur,
    });
    assert.equal(month.split, undefined);
    assert.equal(month.closed, undefined);
  }
});

test("dashboard ops month daily series and attendance", () => {
  const agentMonth = ops.buildOpsMonth({
    month: "2026-08",
    sales,
    employees,
    attendanceRecords: attendance,
    userRole: agent,
  });
  assert.equal(agentMonth.scope, "self");
  assert.equal(agentMonth.dailySales.find((d) => d.date === "2026-08-10").sales, 1);
  assert.equal(agentMonth.dailySales.find((d) => d.date === "2026-08-11").sales, 0);
  assert.equal(agentMonth.attendance.dayOff, 1);
  assert.equal(agentMonth.attendance.halfDay, 1);
  assert.equal(agentMonth.attendance.nsnc, 0);
  assert.equal(agentMonth.dailySales.length, 31);

  const companyMonth = ops.buildOpsMonth({
    month: "2026-08",
    sales,
    employees,
    attendanceRecords: attendance,
    userRole: rtm,
  });
  assert.equal(companyMonth.scope, "company");
  assert.equal(companyMonth.dailySales.find((d) => d.date === "2026-08-10").sales, 2);
  assert.equal(companyMonth.attendance.nsnc, 1);
  assert.equal(companyMonth.attendance.wfh, 1);
  assert.equal(companyMonth.attendance.attended, 1);
});

test("dashboard month range from month= query", () => {
  const range = ops.resolveDashboardRange({ month: "2026-08" });
  assert.equal(range.from, "2026-08-01");
  assert.equal(range.to, "2026-08-31");
  assert.equal(range.period, "month");
  const period = ops.resolveDashboardRange({ period: "month", date: "2026-08-01" });
  assert.equal(period.from, "2026-08-01");
  assert.equal(period.to, "2026-08-31");
});

/**
 * Unit tests for RPM weekly dashboard aggregation + RBAC defaults.
 */
const assert = require("assert");
const rpmWeekly = require("../lib/rpm-weekly-dashboard");
const { saleMatchesCountMode, normalizeCountMode, rpmClientBucket } = require("../lib/rpm-sale-bucket");
const roles = require("../lib/roles");
const catalog = require("../lib/permission-catalog");
const rolePermissions = require("../lib/role-permissions");

function sale(partial) {
  return {
    agentId: "A1",
    closerId: "C1",
    client: "RPM1",
    team: "Jude",
    unit: "HS-3",
    workingDay: "2026-08-03",
    status: "passed",
    formData: { clientFeedback: "Approved", reviewerFeedback: "Done" },
    ...partial,
  };
}

// --- weeks ---
{
  const w28 = rpmWeekly.listWeeksForMonth("2026-02");
  assert.ok(w28.length >= 4 && w28.length <= 5, `Feb weeks ${w28.length}`);
  assert.strictEqual(w28[0].monday.slice(0, 4), "2026");
  const w31 = rpmWeekly.listWeeksForMonth("2026-08");
  assert.ok(w31.length >= 4 && w31.length <= 5, `Aug weeks ${w31.length}`);
  for (const w of w31) {
    assert.strictEqual(new Date(`${w.monday}T12:00:00`).getDay(), 1);
    assert.ok(w.daysInMonth.length >= 1);
  }
}

// --- mode / buckets ---
{
  assert.strictEqual(normalizeCountMode("PASSED_PENDING"), "passed_pending");
  const approved = sale({});
  const pending = sale({ status: "pending", formData: { clientFeedback: "Pending" } });
  const denied = sale({ status: "denied", formData: { clientFeedback: "Denied" } });
  assert.strictEqual(rpmClientBucket(approved), "approved");
  assert.strictEqual(rpmClientBucket(pending), "pending");
  assert.strictEqual(rpmClientBucket(denied), "dropped");
  assert.ok(saleMatchesCountMode(approved, "passed"));
  assert.ok(!saleMatchesCountMode(pending, "passed"));
  assert.ok(saleMatchesCountMode(pending, "passed_pending"));
  assert.ok(saleMatchesCountMode(denied, "all"));
  assert.ok(!saleMatchesCountMode(denied, "passed_pending"));
}

// --- pct / colors ---
{
  assert.strictEqual(rpmWeekly.targetPct(0, 15), 0);
  assert.strictEqual(rpmWeekly.targetPct(15, 15), 100);
  assert.strictEqual(rpmWeekly.targetPct(18, 15), 120);
  assert.strictEqual(rpmWeekly.targetPct(12, null), null);
  assert.strictEqual(rpmWeekly.targetColorBand(40), "red");
  assert.strictEqual(rpmWeekly.targetColorBand(80), "amber");
  assert.strictEqual(rpmWeekly.targetColorBand(100), "green");
  assert.strictEqual(rpmWeekly.targetColorBand(150), "teal");
  assert.strictEqual(rpmWeekly.targetColorBand(null), null);
}

// --- build dashboard rankings + names ---
{
  const employees = [
    { id: "C1", american_name: "Chris Closer", arabic_name: "", status: "Active", team: "Jude", unit: "HS-3" },
    { id: "A1", american_name: "Alex Agent", arabic_name: "", status: "Active", team: "Jude", unit: "HS-3" },
    { id: "A2", american_name: "", arabic_name: "اسم", status: "Out", team: "Jude", unit: "HS-3" },
  ];
  const sales = [
    sale({ workingDay: "2026-08-03", closerId: "C1", agentId: "A1", client: "RPM1" }),
    sale({ workingDay: "2026-08-04", closerId: "C1", agentId: "A1", client: "RPM1" }),
    sale({
      workingDay: "2026-08-05",
      closerId: "C2",
      agentId: "A2",
      client: "RPM2",
      formData: { clientFeedback: "Approved", closerName: "Ghost Closer", agentName: "Ghost Agent" },
    }),
    sale({ workingDay: "2026-08-05", closerId: "", agentId: "A1", client: "" }),
    sale({
      workingDay: "2026-08-06",
      status: "pending",
      formData: { clientFeedback: "Pending" },
      closerId: "C1",
      agentId: "A1",
    }),
  ];
  const teamsMeta = [{ name: "Jude", unit: "HS-3", dialsSales: true, displayOrder: 1 }];
  const dash = rpmWeekly.buildRpmWeeklyDashboard({
    month: "2026-08",
    mode: "passed",
    sales,
    employees,
    teamsMeta,
    targets: [{ company: "hangup", unit: "HS-3", team: "Jude", weekStart: "2026-08-03", targetCount: 2 }],
    company: "hangup",
    userRole: { role: "admin" },
  });
  const week = dash.weeks.find((w) => w.monday === "2026-08-03");
  assert.ok(week, "week containing Aug 3");
  assert.ok(week.closers[0].name === "Chris Closer");
  assert.ok(week.closers.some((c) => c.id === "C2" && c.name === "Ghost Closer"));
  assert.ok(!week.closers.some((c) => !c.id));
  assert.ok(week.unassignedCloserCount >= 1);
  assert.ok(week.clients.some((c) => c.id === "Unassigned client"));
  const jude = week.teams.find((t) => t.team === "Jude");
  assert.ok(jude);
  assert.strictEqual(jude.targetCount, 2);
  assert.ok(jude.pct != null);

  const pendingMode = rpmWeekly.buildRpmWeeklyDashboard({
    month: "2026-08",
    mode: "passed_pending",
    sales,
    employees,
    teamsMeta,
    targets: [],
    company: "hangup",
    userRole: { role: "admin" },
  });
  const w2 = pendingMode.weeks.find((w) => w.monday === "2026-08-03");
  assert.ok(w2.total > week.total, "passed_pending counts more than passed");
}

// --- OP unit filter on roster ---
{
  const employees = [
    { id: "C1", american_name: "Chris", status: "Active", team: "Jude", unit: "HS-3" },
  ];
  const sales = [
    sale({ unit: "HS-3", team: "Jude" }),
    sale({ unit: "HS-1", team: "Other", closerId: "CX", agentId: "AX", client: "X" }),
  ];
  const teamsMeta = [
    { name: "Jude", unit: "HS-3", dialsSales: true },
    { name: "Other", unit: "HS-1", dialsSales: true },
  ];
  const dash = rpmWeekly.buildRpmWeeklyDashboard({
    month: "2026-08",
    mode: "all",
    sales: sales.filter((s) => s.unit === "HS-3"),
    employees,
    teamsMeta: teamsMeta.filter((t) => t.unit === "HS-3"),
    targets: [],
    company: "hangup",
    userRole: { role: "op", opUnits: ["HS-3"], unit: "HS-3" },
  });
  const week = dash.weeks.find((w) => w.monday === "2026-08-03");
  assert.ok(week.teams.every((t) => t.unit === "HS-3"));
  assert.ok(!week.teams.some((t) => t.team === "Other"));
}

// --- team filter ---
{
  const sales = [
    sale({ team: "Jude", closerId: "C1" }),
    sale({ team: "Tris", closerId: "C9", agentId: "A9", client: "Z" }),
  ];
  const dash = rpmWeekly.buildRpmWeeklyDashboard({
    month: "2026-08",
    mode: "all",
    sales,
    employees: [
      { id: "C1", american_name: "Chris", team: "Jude", unit: "HS-3" },
      { id: "C9", american_name: "Other", team: "Tris", unit: "HS-3" },
    ],
    teamsMeta: [
      { name: "Jude", unit: "HS-3", dialsSales: true },
      { name: "Tris", unit: "HS-3", dialsSales: true },
    ],
    targets: [],
    company: "hangup",
    userRole: { role: "admin" },
    teamFilter: "Jude",
  });
  const week = dash.weeks.find((w) => w.monday === "2026-08-03");
  assert.ok(week.closers.every((c) => c.id === "C1"));
}

// --- RBAC defaults + catalog presence ---
{
  rolePermissions.resetOverridesForTest();
  const keys = new Set(catalog.PERMISSIONS.map((p) => p.key));
  assert.ok(keys.has("viewRpmWeeklyDashboard"));
  assert.ok(keys.has("editRpmWeeklyTargets"));

  assert.strictEqual(roles.canViewRpmWeeklyDashboard({ role: "admin" }), true);
  assert.strictEqual(roles.canViewRpmWeeklyDashboard({ role: "rtm" }), true);
  assert.strictEqual(roles.canViewRpmWeeklyDashboard({ role: "quality" }), true);
  assert.strictEqual(roles.canViewRpmWeeklyDashboard({ role: "op" }), true);
  assert.strictEqual(roles.canViewRpmWeeklyDashboard({ role: "tl" }), true);
  assert.strictEqual(
    roles.canViewRpmWeeklyDashboard({
      role: "agent",
      leadTeams: [{ unit: "HS-3", team: "Jude" }],
    }),
    true
  );
  assert.strictEqual(roles.canViewRpmWeeklyDashboard({ role: "hr" }), false);
  assert.strictEqual(roles.canViewRpmWeeklyDashboard({ role: "agent" }), false);
  assert.strictEqual(roles.canEditRpmWeeklyTargets({ role: "tl" }), false);
  assert.strictEqual(
    roles.canEditRpmWeeklyTargets({
      role: "agent",
      leadTeams: [{ unit: "HS-3", team: "Jude" }],
    }),
    false
  );
  assert.strictEqual(roles.canEditRpmWeeklyTargets({ role: "ceo" }), false);
  assert.strictEqual(roles.canEditRpmWeeklyTargets({ role: "admin" }), true);
  assert.strictEqual(roles.canEditRpmWeeklyTargets({ role: "op" }), true);

  const defs = catalog.defaultForRole("hr");
  assert.strictEqual(defs.viewRpmWeeklyDashboard, false);
  assert.strictEqual(catalog.defaultForRole("admin").viewRpmWeeklyDashboard, true);
  assert.strictEqual(catalog.defaultForRole("tl").viewRpmWeeklyDashboard, true);
  assert.strictEqual(catalog.defaultForRole("tl").editRpmWeeklyTargets, false);
}

// --- TL team scope ---
{
  const employees = [
    { id: "A1", american_name: "Alex", status: "Active", team: "Jude", unit: "HS-3" },
    { id: "A2", american_name: "Other", status: "Active", team: "Tris", unit: "HS-3" },
    { id: "C1", american_name: "Chris", status: "Active", team: "Jude", unit: "HS-3" },
  ];
  const sales = [
    sale({ team: "Jude", agentId: "A1", closerId: "C1", client: "RPM1" }),
    sale({ team: "Tris", agentId: "A2", closerId: "C1", client: "RPM2", workingDay: "2026-08-04" }),
  ];
  const teamsMeta = [
    { name: "Jude", unit: "HS-3", dialsSales: true },
    { name: "Tris", unit: "HS-3", dialsSales: true },
  ];
  const tlSales = sales.filter((s) =>
    rpmWeekly.saleMatchesLeadTeams(s, [{ team: "Jude", unit: "HS-3" }])
  );
  const dash = rpmWeekly.buildRpmWeeklyDashboard({
    month: "2026-08",
    mode: "all",
    sales: tlSales,
    employees,
    teamsMeta: teamsMeta.filter((t) => t.name === "Jude"),
    targets: [
      { company: "hangup", unit: "HS-3", team: "Jude", weekStart: "2026-08-03", targetCount: 10 },
      { company: "hangup", unit: "HS-3", team: "Tris", weekStart: "2026-08-03", targetCount: 10 },
    ].filter((t) => t.team === "Jude"),
    company: "hangup",
    userRole: { role: "tl", leadTeams: [{ unit: "HS-3", team: "Jude" }], team: "Jude", unit: "HS-3" },
  });
  assert.strictEqual(dash.scope, "team");
  const week = dash.weeks.find((w) => w.monday === "2026-08-03");
  assert.ok(week.teams.every((t) => t.team === "Jude"));
  assert.ok(week.agents.every((a) => a.id === "A1"));
  assert.ok(!week.clients.some((c) => c.id === "RPM2"));
}

console.log("rpm-weekly-dashboard tests passed");

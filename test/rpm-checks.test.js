/**
 * Unit tests for RPM checks status helpers + working-day 3AM + team dash Day-OFF N.
 */
const assert = require("assert");
const {
  normalizeCheckStatus,
  normalizeFeedbackStatus,
  canManuallySetFeedback,
  countsTowardTotalChecks,
} = require("../lib/rpm-check-status");
const { computeWorkingDay } = require("../lib/sales-working-day");
const teamDashboard = require("../lib/team-dashboard");

assert.strictEqual(normalizeCheckStatus("Q"), "q");
assert.strictEqual(normalizeCheckStatus("Age limit"), "age_limit");
assert.strictEqual(normalizeCheckStatus("Under Age"), "under_age");
assert.strictEqual(normalizeCheckStatus("duplicate"), "duplicate");
assert.strictEqual(normalizeFeedbackStatus("CallBack"), "callback");
assert.strictEqual(normalizeFeedbackStatus("Dropped with Client"), "dropped_with_client");
assert.strictEqual(canManuallySetFeedback("sale"), false);
assert.strictEqual(canManuallySetFeedback("callback"), true);
assert.strictEqual(countsTowardTotalChecks("q"), true);
assert.strictEqual(countsTowardTotalChecks("age_limit"), true);
assert.strictEqual(countsTowardTotalChecks("under_age"), true);
assert.strictEqual(countsTowardTotalChecks("duplicate"), true);

// 3 AM grace: 02:30 → previous day; 03:00 → same day
assert.strictEqual(computeWorkingDay("2026-08-25 02:30:00"), "2026-08-24");
assert.strictEqual(computeWorkingDay("2026-08-25 03:00:00"), "2026-08-25");
assert.strictEqual(computeWorkingDay("2026-08-25 01:59:00"), "2026-08-24");

const employees = [
  { id: "a1", team: "Alpha", unit: "HS-1", status: "Active", american_name: "A1" },
  { id: "a2", team: "Alpha", unit: "HS-1", status: "Active", american_name: "A2" },
  { id: "a3", team: "Alpha", unit: "HS-1", status: "Active", american_name: "A3" },
  { id: "a4", team: "Alpha", unit: "HS-1", status: "Active", american_name: "A4" },
];
const teamsMeta = [{ name: "Alpha", unit: "HS-1", tlEmployeeId: "tl1", dialsSales: true }];
const attendance = [{ employeeId: "a4", date: "2026-08-20", status: "Day-OFF" }];
const sales = [
  {
    id: "s1",
    agentId: "a1",
    workingDay: "2026-08-20",
    status: "passed",
    formData: { clientFeedback: "Approved" },
  },
  {
    id: "s2",
    agentId: "a2",
    workingDay: "2026-08-20",
    status: "pending",
    formData: { clientFeedback: "Pending" },
  },
];

const day = teamDashboard.buildDayDashboard({
  date: "2026-08-20",
  sales,
  employees,
  attendanceRecords: attendance,
  teamsMeta,
  appUsers: [],
});

const summary = (day.teamSummaries || []).find((t) => t.team === "Alpha" || /alpha/i.test(t.team));
assert.ok(summary, "expected Alpha team summary");
assert.strictEqual(
  summary.activeAgentsCount,
  3,
  `Day-OFF excluded from N, got ${summary.activeAgentsCount}`
);
assert.ok(summary.dayOffs >= 1, "dayOffs should count Day-OFF agents");

// workingDay-only: sale with mismatched effectiveDate must not double-count
const weekSales = [
  {
    id: "w1",
    agentId: "a1",
    workingDay: "2026-08-17",
    effectiveDate: "2026-08-18",
    submissionDate: "2026-08-18",
    status: "passed",
    formData: { clientFeedback: "Approved" },
  },
];
const week = teamDashboard.buildWeekDashboard({
  from: "2026-08-17",
  to: "2026-08-23",
  sales: weekSales,
  employees,
  attendanceRecords: [],
  teamsMeta,
  appUsers: [],
});
const mon = (week.days || []).find((d) => d.date === "2026-08-17");
const tue = (week.days || []).find((d) => d.date === "2026-08-18");
const monTotal = mon?.totals?.totalSent || 0;
const tueTotal = tue?.totals?.totalSent || 0;
assert.strictEqual(monTotal, 1, "sale counted on workingDay Monday");
assert.strictEqual(tueTotal, 0, "sale must not also count on effectiveDate Tuesday");

console.log("rpm-checks / working-day / team-dashboard tests OK");

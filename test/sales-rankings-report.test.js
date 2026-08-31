const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSalesRankingsReport,
  assignRanks,
  salesBreakdown,
  checksBreakdown,
} = require("../lib/sales-rankings-report");

const employees = [
  { id: "A1", american_name: "Alice", team: "T1" },
  { id: "A2", american_name: "Bob", team: "T2" },
  { id: "C1", american_name: "Carol", team: "T1" },
];

test("assignRanks handles ties", () => {
  const ranked = assignRanks([
    { count: 5, name: "a" },
    { count: 5, name: "b" },
    { count: 3, name: "c" },
  ]);
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].rank, 1);
  assert.equal(ranked[2].rank, 3);
});

test("buildSalesRankingsReport ranks agents and closers", () => {
  const report = buildSalesRankingsReport({
    from: "2026-08-01",
    to: "2026-08-31",
    employees,
    rpmSales: [
      { agentId: "A1", submissionDate: "2026-08-05", formData: { clientFeedback: "Approved" } },
      { agentId: "A1", submissionDate: "2026-08-06", formData: { clientFeedback: "Pending" } },
      { agentId: "A2", submissionDate: "2026-08-07", closerId: "C1", formData: { clientFeedback: "Denied" }, status: "denied" },
    ],
    checks: [
      { agentId: "A1", workingDay: "2026-08-05", checkStatus: "q" },
      { agentId: "A1", workingDay: "2026-08-06", checkStatus: "nq" },
    ],
    attendance: [
      { employeeId: "A1", date: "2026-08-05", status: "Half Day" },
      { employeeId: "A1", date: "2026-08-06", status: "NSNC" },
    ],
  });

  assert.equal(report.agents[0].employeeId, "A1");
  assert.equal(report.agents[0].name, "Alice");
  assert.equal(report.agents[0].count, 2);
  assert.equal(report.agents[0].breakdown.passed, 1);
  assert.equal(report.agents[0].breakdown.pending, 1);
  assert.equal(report.agents[0].attendanceAnomalies.length, 2);

  assert.equal(report.closers[0].employeeId, "C1");
  assert.equal(report.closers[0].name, "Carol");
  assert.equal(report.closers[0].count, 1);

  assert.equal(report.checkAgents[0].employeeId, "A1");
  assert.equal(report.checkAgents[0].breakdown.q, 1);
  assert.equal(report.checkAgents[0].breakdown.nq, 1);
});

test("checks filter Q only", () => {
  const report = buildSalesRankingsReport({
    from: "2026-08-01",
    to: "2026-08-31",
    checksFilter: "q",
    employees,
    rpmSales: [],
    checks: [
      { agentId: "A1", workingDay: "2026-08-05", checkStatus: "q" },
      { agentId: "A1", workingDay: "2026-08-06", checkStatus: "nq" },
    ],
    attendance: [],
  });
  assert.equal(report.checkAgents[0].count, 1);
});

test("checksBreakdown splits age and under age from NQ", () => {
  const b = checksBreakdown([
    { checkStatus: "q" },
    { checkStatus: "nq" },
    { checkStatus: "age_limit" },
    { checkStatus: "under_age" },
    { checkStatus: "duplicate" },
  ]);
  assert.equal(b.q, 1);
  assert.equal(b.nq, 1);
  assert.equal(b.age_limit, 1);
  assert.equal(b.under_age, 1);
  assert.equal(b.duplicate, 1);
  assert.equal(b.total, 5);
});

test("salesBreakdown denied", () => {
  const b = salesBreakdown([
    { formData: { clientFeedback: "Denied" }, status: "denied" },
  ]);
  assert.equal(b.denied, 1);
});

test("name from sale formData when employee missing from roster", () => {
  const report = buildSalesRankingsReport({
    from: "2026-08-01",
    to: "2026-08-31",
    employees: [],
    rpmSales: [
      {
        agentId: "HS3-999",
        closerId: "HS3-888",
        submissionDate: "2026-08-05",
        formData: { agentName: "Jane Agent", closerName: "Joe Closer" },
      },
    ],
    checks: [],
    attendance: [],
  });
  assert.equal(report.agents[0].name, "Jane Agent");
  assert.equal(report.closers[0].name, "Joe Closer");
});

test("company roster excludes IDs not in employees list", () => {
  const report = buildSalesRankingsReport({
    from: "2026-08-01",
    to: "2026-08-31",
    employees: [{ id: "A1", american_name: "Alice", team: "T1", unit: "HS-3" }],
    rpmSales: [
      { agentId: "A1", submissionDate: "2026-08-05", formData: { clientFeedback: "Approved" } },
      {
        agentId: "HS2-1",
        closerId: "HS2-TL",
        submissionDate: "2026-08-05",
        formData: { agentName: "Other Co Agent", closerName: "Other Co Closer" },
      },
    ],
    checks: [
      { agentId: "A1", workingDay: "2026-08-05", checkStatus: "q" },
      { agentId: "HS2-1", workingDay: "2026-08-05", checkStatus: "q" },
    ],
    attendance: [
      { employeeId: "A1", date: "2026-08-05", status: "Half Day" },
      { employeeId: "HS2-1", date: "2026-08-05", status: "NSNC" },
    ],
  });
  assert.equal(report.agents.length, 1);
  assert.equal(report.agents[0].employeeId, "A1");
  assert.equal(report.closers.length, 0);
  assert.equal(report.checkAgents.length, 1);
  assert.equal(report.checkAgents[0].employeeId, "A1");
  assert.equal(report.agents[0].attendanceAnomalies.length, 1);
});

test("salesMode passed filters and rates", () => {
  const report = buildSalesRankingsReport({
    from: "2026-08-01",
    to: "2026-08-31",
    salesMode: "passed",
    employees,
    rpmSales: [
      { agentId: "A1", closerId: "C1", submissionDate: "2026-08-05", formData: { clientFeedback: "Approved" } },
      { agentId: "A1", closerId: "C1", submissionDate: "2026-08-06", formData: { clientFeedback: "Pending" } },
      { agentId: "A1", closerId: "C1", submissionDate: "2026-08-07", formData: { clientFeedback: "Denied" }, status: "denied" },
    ],
    checks: [],
    attendance: [],
  });
  assert.equal(report.agents[0].count, 1);
  assert.equal(report.agents[0].totalSales, 3);
  assert.equal(report.agents[0].ratePct, 33.3);
  assert.equal(report.agents[0].rateLabel, "Passed %");
  assert.equal(report.closers[0].count, 1);
  assert.equal(report.closers[0].ratePct, 33.3);
});

test("salesMode denied filters and rates", () => {
  const report = buildSalesRankingsReport({
    from: "2026-08-01",
    to: "2026-08-31",
    salesMode: "denied",
    employees,
    rpmSales: [
      { agentId: "A1", closerId: "C1", submissionDate: "2026-08-05", formData: { clientFeedback: "Approved" } },
      { agentId: "A1", closerId: "C1", submissionDate: "2026-08-07", formData: { clientFeedback: "Denied" }, status: "denied" },
      { agentId: "A1", closerId: "C1", submissionDate: "2026-08-08", formData: { clientFeedback: "Denied" }, status: "denied" },
    ],
    checks: [],
    attendance: [],
  });
  assert.equal(report.agents[0].count, 2);
  assert.equal(report.agents[0].totalSales, 3);
  assert.equal(report.agents[0].ratePct, 66.7);
  assert.equal(report.agents[0].rateLabel, "Denied %");
});

test("salesMode passed_pending excludes denied", () => {
  const report = buildSalesRankingsReport({
    from: "2026-08-01",
    to: "2026-08-31",
    salesMode: "passed_pending",
    employees,
    rpmSales: [
      { agentId: "A1", submissionDate: "2026-08-05", formData: { clientFeedback: "Approved" } },
      { agentId: "A1", submissionDate: "2026-08-06", formData: { clientFeedback: "Pending" } },
      { agentId: "A1", submissionDate: "2026-08-07", formData: { clientFeedback: "Denied" }, status: "denied" },
    ],
    checks: [],
    attendance: [],
  });
  assert.equal(report.agents[0].count, 2);
  assert.equal(report.agents[0].ratePct, null);
});

test("invalid range throws", () => {
  assert.throws(() => buildSalesRankingsReport({ from: "2026-09-01", to: "2026-08-01" }), /Invalid date range/);
});

const assert = require("assert");
const { isDialingAgent } = require("../lib/dialing-agents");
const { sortRpmSales, filterSales, mapRpmSale } = require("../lib/rpm-sales-repo");
const history = require("../lib/sale-edit-history");

assert.strictEqual(
  isDialingAgent({ id: "HS3-55", unit: "HS-3", team: "Justin", status: "Deleted", position: "Agent" }),
  false
);
assert.strictEqual(
  isDialingAgent({ id: "HS3-54", unit: "HS-3", team: "Justin", status: "Active", position: "Agent" }),
  true
);
assert.strictEqual(
  isDialingAgent({
    id: "HS3-99",
    unit: "HS-3",
    team: "Daemon",
    status: "Active",
    position: "Agent",
  }),
  false
);
assert.strictEqual(
  isDialingAgent({
    id: "HS3-98",
    unit: "HS-3",
    team: "Justin",
    status: "Deleted",
    position: "Agent",
    sales_agent_picker: true,
  }),
  true
);

const rows = [
  {
    submissionDate: "2026-08-12 10:00:00",
    submissionTime: "10:00:00",
    createdAt: "2026-08-12T08:00:00Z",
    workingDay: "2026-08-12",
    agentId: "A1",
    closerId: "C1",
    client: "Acme",
    team: "Justin",
    formData: { reviewerFeedback: "Done", clientFeedback: "Approved" },
  },
  {
    submissionDate: "2026-08-13 01:30:00",
    submissionTime: "01:30:00",
    createdAt: "2026-08-13T00:00:00Z",
    workingDay: "2026-08-12",
    agentId: "A2",
    closerId: "C2",
    client: "Beta",
    team: "Jude",
    formData: { reviewerFeedback: "Pending", clientFeedback: "Retransfer", retransfer: true },
  },
];

const latest = sortRpmSales(rows, "latest");
assert.strictEqual(latest[0].agentId, "A2");
const oldest = sortRpmSales(rows, "oldest");
assert.strictEqual(oldest[0].agentId, "A1");

const byDay = filterSales(rows, { day: "2026-08-12" });
assert.strictEqual(byDay.length, 2);
const byDayIgnoresSubmissionRange = filterSales(rows, {
  day: "2026-08-12",
  from: "2026-08-13",
  to: "2026-08-31",
});
assert.strictEqual(byDayIgnoresSubmissionRange.length, 2);
const byReviewer = filterSales(rows, { reviewerFeedback: "Done" });
assert.strictEqual(byReviewer.length, 1);
assert.strictEqual(byReviewer[0].agentId, "A1");

const mapped = mapRpmSale({
  id: "x",
  submission_date: "2026-08-13",
  submission_time: "01:30:00",
  working_day: "2026-08-12",
  form_data: {},
  agent_id: "HS3-54",
  status: "pending",
});
assert.strictEqual(mapped.submissionDate, "2026-08-13 01:30:00");
assert.strictEqual(mapped.submissionTime, "01:30:00");

assert.strictEqual(history.canViewSaleHistory({ role: "quality" }), true);
assert.strictEqual(history.canViewSaleHistory({ role: "admin" }), true);
assert.strictEqual(history.canViewSaleHistory({ role: "superadmin" }), true);
assert.strictEqual(history.canViewSaleHistory({ role: "tl" }), false);

const entries = history.buildEntries({
  program: "rpm",
  saleId: "sale-1",
  before: {
    agentId: "HS3-67",
    submissionDate: "2026-08-13 23:10:00",
    submissionTime: "23:10:00",
    workingDay: "2026-08-13",
    formData: {},
  },
  after: {
    agentId: "HS3-54",
    submissionDate: "2026-08-12 01:30:00",
    submissionTime: "01:30:00",
    workingDay: "2026-08-12",
    formData: {},
  },
  changedBy: "raymond",
  source: "submission_correction",
  employees: [
    { id: "HS3-67", american_name: "Hazel Parker" },
    { id: "HS3-54", american_name: "julia jason" },
  ],
});

assert.ok(entries.some((e) => e.field_key === "submissionDateTime"));
assert.ok(entries.some((e) => e.field_key === "workingDay"));
assert.ok(entries.some((e) => e.field_key === "agentId" && /julia jason/.test(e.new_display)));

console.log("test-rpm-sales-controls: OK");

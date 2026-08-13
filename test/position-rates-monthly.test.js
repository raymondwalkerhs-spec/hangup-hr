const test = require("node:test");
const assert = require("node:assert/strict");
const { shiftMonth } = require("../lib/payroll-splits");

test("shiftMonth steps calendar months for rate copy", () => {
  assert.equal(shiftMonth("2026-07", -1), "2026-06");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
});

test("position rate PUT accepts yearMonth or month body field", () => {
  const resolveMonth = (body, query = {}) =>
    body.yearMonth || body.month || query.month || "2026-08";
  assert.equal(resolveMonth({ yearMonth: "2026-07" }), "2026-07");
  assert.equal(resolveMonth({ month: "2026-05" }), "2026-05");
  assert.equal(resolveMonth({}, { month: "2026-03" }), "2026-03");
  assert.equal(resolveMonth({ yearMonth: "2026-07", month: "2026-05" }), "2026-07");
});

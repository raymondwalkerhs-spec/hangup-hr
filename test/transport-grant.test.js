const test = require("node:test");
const assert = require("node:assert/strict");
const { calcTransportAllowance } = require("../lib/transport");

test("full transport grant pays the monthly budget", () => {
  const config = { transportAllowanceMonthly: 3000 };
  const records = [
    { date: "2026-07-01", status: "WFH" },
    { date: "2026-07-02", status: "Day-OFF" },
    { date: "2026-07-03", status: "Lateness A" },
  ];
  const t = calcTransportAllowance(records, 22, config, true, { fullGrant: true });
  assert.equal(t.amount, 3000);
  assert.equal(t.fullGrant, true);
});

test("without grant WFH and Day-OFF pay 0", () => {
  const t = calcTransportAllowance(
    [{ date: "2026-07-01", status: "WFH" }, { date: "2026-07-02", status: "Day-OFF" }],
    22,
    { transportAllowanceMonthly: 3000 },
    true
  );
  assert.equal(t.amount, 0);
});

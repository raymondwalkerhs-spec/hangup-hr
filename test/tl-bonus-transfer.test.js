const test = require("node:test");
const assert = require("node:assert/strict");
const { formatTlDeductionReason, parseTlBonusSourceFromReason } = require("../lib/tl-bonus-link");

test("TL bonus reason encodes payer in bonus row", () => {
  const reason = "Great sale (deducted from TL05)";
  assert.equal(parseTlBonusSourceFromReason(reason), "TL05");
});

test("TL deduction reason encodes recipient", () => {
  const reason = formatTlDeductionReason("Great sale", "HS3-22");
  assert.match(reason, /HS3-22/);
});

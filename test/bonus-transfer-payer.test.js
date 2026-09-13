const test = require("node:test");
const assert = require("node:assert/strict");
const { isBonusTransferPayerId } = require("../lib/employee-ids");

test("bonus transfer payers include TL/OP/HR and RTM/Quality/O#", () => {
  assert.equal(isBonusTransferPayerId("TL01"), true);
  assert.equal(isBonusTransferPayerId("OP1"), true);
  assert.equal(isBonusTransferPayerId("HR-2"), true);
  assert.equal(isBonusTransferPayerId("O1"), true);
  assert.equal(isBonusTransferPayerId("RTM1"), true);
  assert.equal(isBonusTransferPayerId("Q03"), true);
  assert.equal(isBonusTransferPayerId("IT-1"), true);
  assert.equal(isBonusTransferPayerId("HS3-100"), false);
  assert.equal(isBonusTransferPayerId("A12"), false);
});

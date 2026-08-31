const test = require("node:test");
const assert = require("node:assert/strict");
const {
  stripMemberId,
  formatMemberId,
  validateMemberId,
  applyMemberIdInput,
} = require("../lib/rpm-member-id");

test("formats 11 chars as 4-3-4", () => {
  assert.equal(formatMemberId("1A23CD4EF56"), "1A23-CD4-EF56");
});

test("strips dashes spaces and junk", () => {
  assert.equal(stripMemberId("1a23-cd4-ef56 extra!"), "1A23CD4EF56");
});

test("rejects banned letters with Wrong MCN", () => {
  const r = validateMemberId("1L23A45CD67");
  assert.equal(r.ok, false);
  assert.equal(r.message, "Wrong MCN");
});

test("rejects wrong length with Wrong MCN", () => {
  const r = validateMemberId("1A2");
  assert.equal(r.ok, false);
  assert.equal(r.message, "Wrong MCN");
});

test("rejects digit in letter slot with Wrong MCN", () => {
  const r = validateMemberId("1123CD4EF56");
  assert.equal(r.ok, false);
  assert.equal(r.message, "Wrong MCN");
});

test("accepts valid NLAN-LAN-LLNN", () => {
  const r = validateMemberId("1A23-CD4-EF56");
  assert.equal(r.ok, true);
  assert.equal(r.value, "1A23CD4EF56");
});

test("caret maps through grouping on paste", () => {
  const { display, caret } = applyMemberIdInput("1a23cd4ef56", 11);
  assert.equal(display, "1A23-CD4-EF56");
  assert.equal(caret, 13);
});

test("empty required member id", () => {
  const r = validateMemberId("");
  assert.equal(r.ok, false);
  assert.equal(r.message, "Member ID is required");
});

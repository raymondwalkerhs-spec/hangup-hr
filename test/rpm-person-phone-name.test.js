const test = require("node:test");
const assert = require("node:assert/strict");
const {
  digitsOnlyPhone,
  validateDigitsPhone,
  validatePersonName,
} = require("../lib/rpm-person-fields");

test("digitsOnlyPhone strips non-digits", () => {
  assert.equal(digitsOnlyPhone("(555) 123-4567"), "5551234567");
});

test("phone rejects letters", () => {
  const r = validateDigitsPhone("555ABC1234");
  assert.equal(r.ok, false);
  assert.match(r.message, /numbers only/i);
});

test("phone accepts digits", () => {
  const r = validateDigitsPhone("555-123-4567");
  assert.equal(r.ok, true);
  assert.equal(r.value, "5551234567");
});

test("name rejects digits", () => {
  const r = validatePersonName("John 555");
  assert.equal(r.ok, false);
  assert.match(r.message, /letters only/i);
});

test("name accepts hyphen and apostrophe", () => {
  const r = validatePersonName("Mary-Jane O'Neil");
  assert.equal(r.ok, true);
});

test("emergency name same rule", () => {
  const r = validatePersonName("Bob2", { label: "Emergency full name" });
  assert.equal(r.ok, false);
  assert.match(r.message, /Emergency full name/);
});

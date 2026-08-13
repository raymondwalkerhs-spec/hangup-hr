const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveDepartDate,
  isOutAttendanceStatus,
  normalizeNoticeType,
} = require("../lib/employee-depart");
const { buildAutoOutRecordsAfterDepart } = require("../lib/depart-attendance");

test("resolveDepartDate defaults to today when skipped", () => {
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(resolveDepartDate(null), today);
  assert.equal(resolveDepartDate(""), today);
  assert.equal(resolveDepartDate("2026-07-15"), "2026-07-15");
});

test("isOutAttendanceStatus recognizes OUT variants", () => {
  assert.equal(isOutAttendanceStatus("OUT"), true);
  assert.equal(isOutAttendanceStatus("OUT BUT STILL GET PAID"), true);
  assert.equal(isOutAttendanceStatus("Attended"), false);
});

test("normalizeNoticeType accepts legacy no_notice and company_decision", () => {
  assert.equal(normalizeNoticeType("no_notice"), "without_notice");
  assert.equal(normalizeNoticeType("with_notice"), "with_notice");
  assert.equal(normalizeNoticeType("company_decision"), "company_decision");
});

test("buildAutoOutRecordsAfterDepart covers days after depart date only", () => {
  const records = buildAutoOutRecordsAfterDepart("HS1-01", "2026-07-17", 1);
  assert.ok(records.some((r) => r.date === "2026-07-18" && r.status === "OUT"));
  assert.ok(!records.some((r) => r.date === "2026-07-17"));
  assert.ok(!records.some((r) => r.date === "2026-07-16"));
});

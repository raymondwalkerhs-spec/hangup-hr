const assert = require("assert");
const workingDay = require("../lib/sales-working-day");
const correction = require("../lib/sale-submission-correction");

assert.strictEqual(correction.canCorrectSubmissionDate({ role: "admin" }), true);
assert.strictEqual(correction.canCorrectSubmissionDate({ role: "rtm" }), true);
assert.strictEqual(correction.canCorrectSubmissionDate({ role: "ceo" }), true);
assert.strictEqual(correction.canCorrectSubmissionDate({ role: "superadmin" }), true);
assert.strictEqual(correction.canCorrectSubmissionDate({ role: "quality" }), false);
assert.strictEqual(correction.canCorrectSubmissionDate({ role: "tl" }), false);

const timestamp = correction.normalizeSubmissionDateTime("2026-08-13T01:30");
assert.strictEqual(timestamp, "2026-08-13 01:30:00");
assert.strictEqual(workingDay.computeSubmissionTime(timestamp), "01:30:00");
assert.strictEqual(workingDay.computeWorkingDay(timestamp), "2026-08-12");

const stored = workingDay.storageDateParts(timestamp);
assert.strictEqual(stored.submissionDate, "2026-08-13");
assert.strictEqual(stored.submissionTime, "01:30:00");
assert.strictEqual(stored.workingDay, "2026-08-12");

const combined = workingDay.combineSubmissionDateTime("2026-08-13", "01:30:00");
assert.strictEqual(combined, "2026-08-13 01:30:00");
assert.strictEqual(workingDay.formatTimeAmPm("01:30:00"), "1:30 AM");

assert.throws(
  () => correction.normalizeSubmissionDateTime("2026-02-30T12:00"),
  /invalid/i
);
assert.throws(
  () => correction.normalizeSubmissionDateTime("2026-08-13"),
  /must use/i
);

const dates = workingDay.enrichSaleDates({}, timestamp);
assert.strictEqual(dates.submissionTime, "01:30:00");
assert.strictEqual(dates.workingDay, "2026-08-12");

console.log("test-rpm-submission-correction: OK");

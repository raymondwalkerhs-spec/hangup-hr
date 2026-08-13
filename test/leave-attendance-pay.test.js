const test = require("node:test");
const assert = require("node:assert/strict");
const {
  leaveAttendanceRecords,
  transportOverrideForLeave,
  isPaidLeaveKind,
} = require("../lib/leave-attendance");
const { countUnpaidFractionDeductions } = require("../lib/attendance");

test("annual full day is paid Day-OFF without transport", () => {
  const recs = leaveAttendanceRecords({
    employeeId: "HS1-01",
    requestKind: "annual",
    startDate: "2026-08-10",
    endDate: "2026-08-10",
    dayFraction: 1,
    paidLeave: true,
  });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].status, "Day-OFF");
  assert.equal(recs[0].paidLeave, true);
  assert.equal(recs[0].transportOverride, "");
});

test("annual half day is paid with half transport and no salary fraction deduction", () => {
  const recs = leaveAttendanceRecords({
    employeeId: "HS1-01",
    requestKind: "annual",
    startDate: "2026-08-10",
    endDate: "2026-08-10",
    dayFraction: 0.5,
    paidLeave: true,
  });
  assert.equal(recs[0].status, "Half Day");
  assert.equal(recs[0].paidLeave, true);
  assert.equal(recs[0].transportOverride, "half");
  const { unpaidHalfDays } = countUnpaidFractionDeductions(recs);
  assert.equal(unpaidHalfDays, 0);
});

test("unpaid half day deducts half day salary and grants half transport", () => {
  const recs = leaveAttendanceRecords({
    employeeId: "HS1-01",
    requestKind: "unpaid",
    startDate: "2026-08-10",
    endDate: "2026-08-10",
    dayFraction: 0.5,
    paidLeave: false,
  });
  assert.equal(recs[0].paidLeave, false);
  assert.equal(recs[0].transportOverride, "half");
  const { unpaidHalfDays } = countUnpaidFractionDeductions(recs);
  assert.equal(unpaidHalfDays, 1);
});

test("annual quarter day is paid with half transport", () => {
  const recs = leaveAttendanceRecords({
    employeeId: "HS1-01",
    requestKind: "annual",
    startDate: "2026-08-10",
    endDate: "2026-08-10",
    dayFraction: 0.25,
    paidLeave: true,
  });
  assert.equal(recs[0].status, "Quarter Day-Off");
  assert.equal(recs[0].transportOverride, "half");
  const { unpaidQuarterOff } = countUnpaidFractionDeductions(recs);
  assert.equal(unpaidQuarterOff, 0);
});

test("medical leave is unpaid", () => {
  assert.equal(isPaidLeaveKind("medical"), false);
  const recs = leaveAttendanceRecords({
    employeeId: "HS1-01",
    requestKind: "medical",
    startDate: "2026-08-10",
    endDate: "2026-08-10",
    dayFraction: 1,
  });
  assert.equal(recs[0].paidLeave, false);
});

test("transportOverrideForLeave matrix", () => {
  assert.equal(transportOverrideForLeave(true, 0.5), "half");
  assert.equal(transportOverrideForLeave(true, 0.25), "half");
  assert.equal(transportOverrideForLeave(false, 0.5), "half");
  assert.equal(transportOverrideForLeave(false, 0.25), "");
  assert.equal(transportOverrideForLeave(true, 1), "");
});

test("pause request writes paused Mon–Fri only", () => {
  const recs = leaveAttendanceRecords({
    employeeId: "HS1-01",
    requestKind: "pause",
    startDate: "2026-08-10",
    endDate: "2026-08-14",
    dayFraction: 1,
    paidLeave: false,
  });
  assert.equal(recs.length, 5);
  assert.ok(recs.every((r) => r.status === "paused"));
  assert.ok(recs.every((r) => r.paidLeave === false));
  assert.deepEqual(recs.map((r) => r.date), [
    "2026-08-10",
    "2026-08-11",
    "2026-08-12",
    "2026-08-13",
    "2026-08-14",
  ]);
});

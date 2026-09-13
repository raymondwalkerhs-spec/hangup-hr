const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseIsoDate,
  addCalendarDays,
  mondayOfWeek,
  fridayOfWeek,
  todayLocalIsoDate,
} = require("../lib/date-iso");
const {
  resolveTrainingSalesProgram,
  bucketSalesIntoPhases,
  assertNoPhaseOverlap,
  mondayOfWeek: trainingMonday,
} = require("../lib/training-phases");
const {
  trainingPayUnitForRecord,
  countTrainingPayUnits,
  isTrainingPayDate,
  computeEligibleTrainingPayDates,
} = require("../lib/training-pay-rules");
const {
  selectProgramsNeedingOutcomeReminder,
  isCairoMonday,
} = require("../lib/training-phase-outcome-notify");

test("parseIsoDate keeps YYYY-MM-DD", () => {
  assert.equal(parseIsoDate("2026-07-06T99:00:00Z"), "2026-07-06");
  assert.equal(parseIsoDate("bad"), "");
});

test("addCalendarDays does not UTC-shift across months", () => {
  assert.equal(addCalendarDays("2026-07-31", 1), "2026-08-01");
  assert.equal(addCalendarDays("2026-01-01", 90), "2026-04-01");
  assert.equal(addCalendarDays("2026-03-01", -1), "2026-02-28");
});

test("mondayOfWeek / fridayOfWeek are local calendar dates", () => {
  assert.equal(mondayOfWeek("2026-07-08"), "2026-07-06"); // Wed → Mon
  assert.equal(fridayOfWeek("2026-07-08"), "2026-07-10");
  assert.equal(trainingMonday("2026-07-12"), "2026-07-06"); // Sun → prior Mon
});

test("todayLocalIsoDate returns Cairo YYYY-MM-DD", () => {
  const today = todayLocalIsoDate();
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
});

test("resolveTrainingSalesProgram maps HS-2 to rpm and Hang-Up to mla", () => {
  assert.equal(resolveTrainingSalesProgram({ id: "HS2-10", unit: "HS-2" }), "rpm");
  assert.equal(resolveTrainingSalesProgram({ id: "HS3-10", unit: "HS-3" }), "mla");
  assert.equal(resolveTrainingSalesProgram({ id: "HS1-10", unit: "HS-1" }), "mla");
});

test("bucketSalesIntoPhases counts passed sales per week window", () => {
  const phases = [
    { phase_number: 2, week_start: "2026-07-13", week_end: "2026-07-17" },
    { phase_number: 3, week_start: "2026-07-20", week_end: "2026-07-24" },
  ];
  const sales = [
    { submissionDate: "2026-07-14", status: "passed" },
    { submissionDate: "2026-07-15", status: "rejected" },
    { submissionDate: "2026-07-21", status: "passed" },
    { submissionDate: "2026-07-22", status: "passed" },
    { submissionDate: "2026-07-10", status: "passed" }, // out of range
  ];
  const counts = bucketSalesIntoPhases(sales, phases);
  assert.deepEqual(counts[2], { passed: 1, total: 2 });
  assert.deepEqual(counts[3], { passed: 2, total: 2 });
});

test("assertNoPhaseOverlap rejects colliding weeks", () => {
  assert.throws(
    () =>
      assertNoPhaseOverlap([
        { phase_number: 1, week_start: "2026-07-06", week_end: "2026-07-10" },
        { phase_number: 2, week_start: "2026-07-08", week_end: "2026-07-17" },
      ]),
    /overlaps/
  );
  assert.doesNotThrow(() =>
    assertNoPhaseOverlap([
      { phase_number: 1, week_start: "2026-07-06", week_end: "2026-07-10" },
      { phase_number: 2, week_start: "2026-07-13", week_end: "2026-07-17" },
    ])
  );
});

test("Quarter Day-Off unpaid training pays 0.75 units", () => {
  assert.equal(trainingPayUnitForRecord({ status: "Quarter Day-Off" }), 0.75);
  assert.equal(trainingPayUnitForRecord({ status: "Half Day" }), 0.5);
  assert.equal(trainingPayUnitForRecord({ status: "Attended" }), 1);
  assert.equal(countTrainingPayUnits([{ status: "Quarter Day-Off" }, { status: "Attended" }]), 1.75);
});

test("eligible training pay includes quarter day as 0.75 unit day", () => {
  const program = {
    outcome: "active",
    allPhases: [
      { phaseNumber: 1, weekStart: "2026-07-06", weekEnd: "2026-07-10", status: "passed" },
      { phaseNumber: 2, weekStart: "2026-07-13", weekEnd: "2026-07-17", status: "pending" },
    ],
  };
  const att = [{ date: "2026-07-14", status: "Quarter Day-Off" }];
  assert.equal(isTrainingPayDate(program, "2026-07-14", att, "2026-07"), true);
  const days = computeEligibleTrainingPayDates(program, att, "2026-07");
  assert.equal(days.has("2026-07-14"), true);
  assert.equal(countTrainingPayUnits(att), 0.75);
});

test("Monday notify selects overdue pending phases after Friday week_end", () => {
  const programs = [
    {
      employeeId: "HS3-1",
      name: "A",
      active: true,
      outcome: "active",
      phases: [
        { phaseNumber: 2, weekEnd: "2026-07-10", status: "pending" }, // Fri before Mon 13
        { phaseNumber: 3, weekEnd: "2026-07-17", status: "pending" },
      ],
    },
    {
      employeeId: "HS3-2",
      active: true,
      outcome: "active",
      phases: [{ phaseNumber: 2, weekEnd: "2026-07-17", status: "pending" }], // not yet due
    },
    {
      employeeId: "HS3-3",
      active: false,
      outcome: "active",
      phases: [{ phaseNumber: 2, weekEnd: "2026-07-10", status: "pending" }],
    },
    {
      employeeId: "HS3-4",
      active: true,
      outcome: "passed",
      phases: [{ phaseNumber: 2, weekEnd: "2026-07-10", status: "pending" }],
    },
  ];
  const due = selectProgramsNeedingOutcomeReminder(programs, "2026-07-13"); // Monday
  assert.equal(due.length, 1);
  assert.equal(due[0].employeeId, "HS3-1");
  assert.equal(due[0].overduePhases.length, 1);
  assert.equal(due[0].overduePhases[0].phaseNumber, 2);
});

test("isCairoMonday is a boolean for a fixed UTC instant", () => {
  // 2026-07-13 08:00 UTC = Monday morning in Cairo (UTC+3)
  const mon = new Date("2026-07-13T08:00:00Z");
  assert.equal(isCairoMonday(mon), true);
  const tue = new Date("2026-07-14T08:00:00Z");
  assert.equal(isCairoMonday(tue), false);
});

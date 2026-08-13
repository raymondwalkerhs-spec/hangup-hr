const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isLegacyDepart,
  isPreviousMonthDepart,
  isCurrentMonthDepart,
  shouldShowEmployeeInMonth,
} = require("../lib/employee-visibility");

test("legacy depart is two or more months before view month", () => {
  const emp = { status: "Out", depart_date: "2026-05-15" };
  assert.equal(isLegacyDepart(emp, "2026-07"), true);
  assert.equal(isLegacyDepart(emp, "2026-06"), false);
  assert.equal(isPreviousMonthDepart(emp, "2026-06"), true);
});

test("shouldShowEmployeeInMonth hides legacy unless setting enabled", () => {
  const emp = { id: "X", status: "Out", depart_date: "2026-05-20" };
  assert.equal(shouldShowEmployeeInMonth(emp, "2026-07", [], { hideOut: true }), false);
  assert.equal(shouldShowEmployeeInMonth(emp, "2026-07", [], { showLegacyEmployees: true }), true);
});

test("previous month OUT shown when hideOut is false", () => {
  const emp = { id: "Y", status: "Out", depart_date: "2026-06-10" };
  assert.equal(shouldShowEmployeeInMonth(emp, "2026-07", [], { hideOut: true }), false);
  assert.equal(shouldShowEmployeeInMonth(emp, "2026-07", [], { hideOut: false }), true);
});

test("current month depart always shown", () => {
  const emp = { id: "Z", status: "Out", depart_date: "2026-07-05" };
  assert.equal(isCurrentMonthDepart(emp, "2026-07"), true);
  assert.equal(shouldShowEmployeeInMonth(emp, "2026-07", [], { hideOut: true }), true);
});

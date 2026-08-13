const test = require("node:test");
const assert = require("node:assert/strict");
const {
  effectiveDepartDate,
  normalizeEmployeeDepart,
  applyDepartAutoOutForMonth,
  shouldShowInMonth,
  attendanceLockEnd,
  isLockedDepartDay,
} = require("../lib/depart-attendance");
const { employeeDepartedBeforeMonth } = require("../lib/payroll-view-filters");

const hs340 = {
  id: "HS3-40",
  status: "Active",
  employment_date: "2026-06-22",
  depart_date: "2026-06-19",
  american_name: "Thomas Walker",
};

const julyRecords = [
  { employeeId: "HS3-40", date: "2026-07-30", status: "Attended" },
  { employeeId: "HS3-40", date: "2026-07-31", status: "Day-OFF" },
];

test("Active employee ignores stale depart_date before employment_date", () => {
  assert.equal(effectiveDepartDate(hs340), "");
  assert.equal(normalizeEmployeeDepart(hs340).depart_date, null);
});

test("Active employee with stale depart is not treated as departed before July", () => {
  assert.equal(employeeDepartedBeforeMonth(hs340, "2026-07"), false);
});

test("stale depart does not auto-OUT July attendance for Active employee", () => {
  const result = applyDepartAutoOutForMonth([hs340], julyRecords, "2026-07");
  const july30 = result.find((r) => r.date === "2026-07-30");
  assert.equal(july30?.status, "Attended");
});

test("shouldShowInMonth keeps Active employee visible in July", () => {
  assert.equal(shouldShowInMonth(hs340, "2026-07", julyRecords, { hideOut: true }), true);
});

test("Out employee still uses depart_date for month cutoff", () => {
  const outEmp = { ...hs340, status: "Out", depart_date: "2026-06-19" };
  assert.equal(effectiveDepartDate(outEmp), "2026-06-19");
  assert.equal(employeeDepartedBeforeMonth(outEmp, "2026-07"), true);
});

test("Active employee has no attendance lock_after from stale depart or closed period", () => {
  const periods = [{ startDate: "2026-06-01", endDate: "2026-06-18", isCurrent: false }];
  assert.equal(attendanceLockEnd(hs340, periods), "");
  assert.equal(isLockedDepartDay(hs340, "2026-07-30", periods), false);
});

test("Out employee lock_after follows depart and closed period", () => {
  const outEmp = { ...hs340, status: "Out", depart_date: "2026-06-19" };
  const periods = [{ startDate: "2026-06-01", endDate: "2026-06-19", isCurrent: false }];
  assert.equal(attendanceLockEnd(outEmp, periods), "2026-06-19");
  assert.equal(isLockedDepartDay(outEmp, "2026-06-20", periods), true);
});

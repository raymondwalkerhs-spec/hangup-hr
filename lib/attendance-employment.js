const { dateInActivePeriod, computeEditableEmploymentSpan, dateWithinEmploymentSpan } = require("./employment-periods");
const { parseIsoDate } = require("./date-iso");
const { isOutStatus } = require("./employee-status");
const { isDepartDay, effectiveDepartDate } = require("./depart-attendance");

/**
 * Whether attendance may be edited for an employee on a calendar date.
 * Uses employment_periods as the source of truth when present; falls back
 * to employment_date / depart_date when no period rows exist or when the
 * date falls outside all known periods but within the employee's overall
 * employment span.
 */
function canEditAttendanceDate(employee, date, periods = []) {
  const d = parseIsoDate(date);
  if (!d) return { ok: false, reason: "Invalid date." };

  const hire = parseIsoDate(employee?.employment_date);
  const depart = effectiveDepartDate(employee);

  // Depart day is always editable (last day / out day).
  if (isDepartDay(employee, d)) return { ok: true };

  // No employment date on file: only depart_date limits the range (any date on/before depart).
  if (!hire) {
    if (depart && d > depart) {
      return { ok: false, reason: "Days after depart date are locked as OUT." };
    }
    return { ok: true };
  }

  // Out status without depart_date: allow edits until HR sets a proper depart date.
  if (isOutStatus(employee?.status) && !depart) {
    if (hire && d < hire) {
      return { ok: false, reason: "Cannot edit attendance before employment date." };
    }
    return { ok: true };
  }

  if (periods?.length) {
    if (dateInActivePeriod(d, periods)) return { ok: true };
    const span = computeEditableEmploymentSpan(employee, periods);
    if (dateWithinEmploymentSpan(d, span)) return { ok: true };
    return {
      ok: false,
      reason: "Cannot edit attendance outside active employment period (after depart or before re-hire).",
    };
  }

  if (hire && d < hire) {
    return { ok: false, reason: "Cannot edit attendance before employment date." };
  }
  if (depart && d > depart) {
    return { ok: false, reason: "Days after depart date are locked as OUT." };
  }
  return { ok: true };
}

module.exports = {
  parseIsoDate,
  canEditAttendanceDate,
};

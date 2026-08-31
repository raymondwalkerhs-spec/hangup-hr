/**
 * Employee list visibility — legacy departures vs previous-month OUT.
 */
const { isOutStatus } = require("./employee-status");
const { effectiveDepartDate, employeeWorkedInMonth } = require("./depart-attendance");
const { shiftMonth } = require("./payroll-splits");

function departYearMonth(emp) {
  const d = effectiveDepartDate(emp) || String(emp?.depart_date || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.slice(0, 7) : "";
}

/** Departed two or more full months before the viewed month. */
function isLegacyDepart(emp, viewMonth) {
  const departYm = departYearMonth(emp);
  const viewYm = String(viewMonth || "").slice(0, 7);
  if (!departYm || !viewYm) return false;
  const cutoff = shiftMonth(viewYm, -2);
  return departYm <= cutoff;
}

function isPreviousMonthDepart(emp, viewMonth) {
  const departYm = departYearMonth(emp);
  const viewYm = String(viewMonth || "").slice(0, 7);
  if (!departYm || !viewYm) return false;
  return departYm === shiftMonth(viewYm, -1);
}

function isCurrentMonthDepart(emp, viewMonth) {
  const departYm = departYearMonth(emp);
  const viewYm = String(viewMonth || "").slice(0, 7);
  return Boolean(departYm && viewYm && departYm === viewYm);
}

/**
 * @param {object} opts
 * @param {boolean} opts.hideOut - hide previous-month OUT without work (tab checkbox)
 * @param {boolean} opts.hideAllOut - hide every OUT status including worked-this-month
 * @param {boolean} opts.showLegacyEmployees - settings: show 2+ month departed with no work
 */
function shouldShowEmployeeInMonth(emp, viewMonth, records, opts = {}) {
  const hideAllOut = opts.hideAllOut === true;
  const hideOut = opts.hideOut !== false;
  const showLegacyEmployees = opts.showLegacyEmployees === true;
  if (!emp?.id) return false;
  if (!isOutStatus(emp.status)) return true;
  if (hideAllOut) return false;

  const worked = employeeWorkedInMonth(emp, records, viewMonth);
  if (worked) return true;
  if (isCurrentMonthDepart(emp, viewMonth)) return true;

  if (isLegacyDepart(emp, viewMonth)) {
    return showLegacyEmployees;
  }

  if (isPreviousMonthDepart(emp, viewMonth)) {
    return !hideOut;
  }

  return false;
}

module.exports = {
  departYearMonth,
  isLegacyDepart,
  isPreviousMonthDepart,
  isCurrentMonthDepart,
  shouldShowEmployeeInMonth,
};

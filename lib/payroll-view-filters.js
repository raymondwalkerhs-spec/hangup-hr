/**
 * Payroll list visibility — hide OUT employees unless they earned pay from work this month.
 */
const { isOutStatus } = require("./employee-status");
const {
  isLegacyDepart,
  isPreviousMonthDepart,
  isCurrentMonthDepart,
} = require("./employee-visibility");

function payrollRowWorkedInMonth(row) {
  if (!row) return false;
  if (row.payrollKind === "training_deferred_month") {
    return (
      (Number(row.earnedNetSalary) || 0) > 0 ||
      (Number(row.earnedBasicSalary) || 0) > 0 ||
      (Number(row.totalWorkingDays) || 0) > 0 ||
      (Number(row.scopedDayCount) || 0) > 0
    );
  }
  return (
    (Number(row.totalWorkingDays) || 0) > 0 ||
    (Number(row.salesCount) || 0) > 0 ||
    (Number(row.commissionAmount) || 0) > 0 ||
    (Number(row.basicSalary) || 0) > 0 ||
    (Number(row.earnedNetSalary) || 0) > 0 ||
    (Number(row.earnedBasicSalary) || 0) > 0
  );
}

function employeeDepartedBeforeMonth(row, month) {
  if (!isOutStatus(row?.status)) return false;
  const depart = String(row?.depart_date || row?.departDate || "").slice(0, 10);
  if (!depart || !month) return false;
  return depart < `${month}-01`;
}

function shouldShowPayrollRow(row, { hideOut = true, month = "", showLegacyEmployees = false } = {}) {
  if (!row) return false;
  if (!isOutStatus(row.status)) return true;

  const worked = payrollRowWorkedInMonth(row);
  if (worked) return true;
  if (month && isCurrentMonthDepart(row, month)) return true;

  if (month && isLegacyDepart(row, month)) {
    return showLegacyEmployees;
  }

  if (month && isPreviousMonthDepart(row, month)) {
    return !hideOut;
  }

  if (!hideOut) return false;
  return false;
}

function filterPayrollViewRows(rows, opts = {}) {
  return (rows || []).filter((row) => shouldShowPayrollRow(row, opts));
}

module.exports = {
  payrollRowWorkedInMonth,
  employeeDepartedBeforeMonth,
  shouldShowPayrollRow,
  filterPayrollViewRows,
};

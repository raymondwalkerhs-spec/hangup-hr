/**
 * Merge Supabase payroll core (attendance-derived basic + transport) into app payslip rows.
 * Keeps month working-days denominator, syncs Transportation bonus, and recalculates net.
 */

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function isDbWorkingDaysReasonable(row, dbRow) {
  const dbWorkingDays = Number(dbRow?.working_days);
  const appWorkingDays = Number(row?.totalWorkingDays);
  if (!Number.isFinite(dbWorkingDays) || !Number.isFinite(appWorkingDays)) return false;
  // Stale DB rows with zero days must not wipe a valid in-app attendance calc.
  if (dbWorkingDays === 0 && appWorkingDays > 0) return false;
  return dbWorkingDays <= appWorkingDays;
}

/**
 * Reject DB daily rates derived from attendance days (e.g. 12000/10 = 1200)
 * when app already has monthly ÷ month working days.
 */
function isDbDailyRateAligned(row, dbRow) {
  const dbDaily = Number(dbRow?.daily_rate);
  if (!Number.isFinite(dbDaily) || dbDaily < 0) return false;

  const appDaily = Number(row?.dailyRate);
  if (Number.isFinite(appDaily) && appDaily > 0) {
    const absTol = 0.05;
    const relTol = 0.002;
    if (Math.abs(dbDaily - appDaily) <= absTol) return true;
    if (Math.abs(dbDaily - appDaily) / appDaily <= relTol) return true;
    return false;
  }

  const monthWd = Number(row?.workingDaysInMonth);
  const monthly = Number(row?.monthlySalary);
  if (Number.isFinite(monthWd) && monthWd > 0 && Number.isFinite(monthly) && monthly > 0) {
    const expected = monthly / monthWd;
    return Math.abs(dbDaily - expected) <= 0.05 || Math.abs(dbDaily - expected) / expected <= 0.002;
  }

  // No app baseline — allow (migration not applied yet still risky; prefer keep app basic)
  return false;
}

/** Even with matching daily rates, DB unit math can diverge — keep app basic then. */
function isDbBasicAligned(row, dbRow) {
  const appBasic = Number(row?.basicSalary);
  const dbBasic = Number(dbRow?.basic_salary);
  if (!Number.isFinite(appBasic) || !Number.isFinite(dbBasic)) return false;
  if (appBasic === 0 && dbBasic === 0) return true;
  const day = Number(row?.dailyRate) || 0;
  const absTol = Math.max(1, day * 0.25, 5);
  if (Math.abs(dbBasic - appBasic) <= absTol) return true;
  if (appBasic > 0 && Math.abs(dbBasic - appBasic) / appBasic <= 0.01) return true;
  return false;
}

function expectedTransportDailyRate(row) {
  const monthWd = Number(row?.workingDaysInMonth);
  if (!Number.isFinite(monthWd) || monthWd <= 0) return null;
  const budget = 3000;
  return round2(budget / monthWd);
}

function isDbTransportDailyAligned(row, dbRow) {
  const dbTd = Number(dbRow?.transport_daily_rate);
  const expected = expectedTransportDailyRate(row);
  if (expected == null || !Number.isFinite(dbTd)) return false;
  return Math.abs(dbTd - expected) <= 0.05 || Math.abs(dbTd - expected) / expected <= 0.002;
}

function recalcPayrollNetBeforeSplits(row) {
  if (row?.noPayroll) return 0;
  let net =
    Number(row.basicSalary || 0) +
    Number(row.totalBonuses || 0) -
    Number(row.totalDeductions || 0) -
    Number(row.bonusTransferPayroll || 0);
  if (row.netSalaryOverrideActive && row.netSalaryOverrideValue != null && row.netSalaryOverrideValue !== "") {
    net = Number(row.netSalaryOverrideValue);
  }
  return round2(net);
}

function portionEarnedNet(portion) {
  if (!portion) return 0;
  return Number(portion.calculatedNet ?? portion.netSalary) || 0;
}

function rebuildDualCombined(row) {
  if (!row || row.payrollKind !== "dual") return row;
  const training = row.training || null;
  const agent = row.agent || null;
  const combinedNet = round2(portionEarnedNet(training) + portionEarnedNet(agent));
  const combinedBasic = round2((Number(training?.basicSalary) || 0) + (Number(agent?.basicSalary) || 0));
  return {
    ...row,
    combinedNet,
    combinedBasic,
    netSalary: combinedNet,
    basicSalary: combinedBasic,
    totalBonuses: round2((Number(training?.totalBonuses) || 0) + (Number(agent?.totalBonuses) || 0)),
    totalDeductions: round2((Number(training?.totalDeductions) || 0) + (Number(agent?.totalDeductions) || 0)),
    latenessDeduction: round2((Number(training?.latenessDeduction) || 0) + (Number(agent?.latenessDeduction) || 0)),
  };
}

function applyPayrollHybridDbToRow(row, dbRow) {
  if (!row || !dbRow) return row;
  // Dual payslips split training days (@ fixed 600) from post-promotion agent days (@ monthly rate).
  // Supabase calculate_payroll_core() uses full-month agent math — never overwrite scoped dual portions.
  if (
    row.payrollKind === "dual" ||
    row.payrollKind === "training" ||
    row.payrollKind === "training_deferred_month"
  ) {
    return row;
  }
  return applyPayrollHybridDbCore(row, dbRow);
}

function applyPayrollHybridDbCore(row, dbRow) {
  if (!row || !dbRow) return row;
  const reasonable = isDbWorkingDaysReasonable(row, dbRow);
  if (!reasonable) {
    return { ...row, _dbSource: false };
  }

  const dailyOk = isDbDailyRateAligned(row, dbRow);
  const basicOk = dailyOk && isDbBasicAligned(row, dbRow);
  const transportDailyOk = isDbTransportDailyAligned(row, dbRow);

  const transportAllowance =
    transportDailyOk && Number(dbRow.transport_allowance) > 0
      ? Number(dbRow.transport_allowance)
      : Number(row.transportAllowance) || 0;
  const basicSalary = basicOk
    ? Number(dbRow.basic_salary ?? row.basicSalary) || 0
    : Number(row.basicSalary) || 0;

  const bonuses = { ...(row.bonuses || {}) };
  bonuses.Transportation = transportAllowance;
  const totalBonuses = Object.values(bonuses).reduce((s, v) => s + (Number(v) || 0), 0);

  let next = {
    ...row,
    totalWorkingDays: basicOk ? dbRow.working_days ?? row.totalWorkingDays : row.totalWorkingDays,
    dailyRate: dailyOk && dbRow.daily_rate != null ? Number(dbRow.daily_rate) : row.dailyRate,
    basicSalary: round2(basicSalary),
    transportDays: transportDailyOk
      ? Number(dbRow.transport_days ?? row.transportDays) || 0
      : Number(row.transportDays) || 0,
    transportDailyRate: transportDailyOk
      ? Number(dbRow.transport_daily_rate ?? row.transportDailyRate) || 0
      : Number(row.transportDailyRate) || 0,
    transportAllowance: round2(transportAllowance),
    bonuses,
    totalBonuses: round2(totalBonuses),
    _dbSource: basicOk || transportDailyOk,
    _dbDailyRejected: !dailyOk,
    _dbBasicRejected: dailyOk && !basicOk,
  };

  const preSplitNet = recalcPayrollNetBeforeSplits(next);
  next.calculatedNet = preSplitNet;
  next.netSalary = preSplitNet;
  next.netBasic = round2(Number(next.basicSalary) - Number(next.latenessDeduction || 0));

  if (next.hasSplits) {
    const { applyPayrollSplits } = require("./payroll-splits");
    return applyPayrollSplits(
      { ...next, netSalary: preSplitNet },
      next.splits || [],
      next.deferredInSplits || []
    );
  }

  next.remainingBalance = preSplitNet;
  next.grossPayable = preSplitNet;
  return next;
}

module.exports = {
  round2,
  isDbWorkingDaysReasonable,
  isDbDailyRateAligned,
  isDbBasicAligned,
  isDbTransportDailyAligned,
  recalcPayrollNetBeforeSplits,
  applyPayrollHybridDbCore,
  applyPayrollHybridDbToRow,
  portionEarnedNet,
  rebuildDualCombined,
};

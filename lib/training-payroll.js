/**
 * Dual training/agent payroll calculation for mid-month promotion.
 */
const { summarizeEmployeeMonth } = require("./attendance");
const { lookupSalary } = require("./month-profile");
const { calcPayrollRow } = require("./payroll");
const { applyPayrollSplits, buildSplitMaps } = require("./payroll-splits");
const {
  computeEligibleTrainingPayDates,
  computeAgentPayDates,
  hasDualPayrollInMonth,
  COMMISSION_SALES_THRESHOLD,
} = require("./training-pay-rules");

function filterRecordsByDates(records, dateSet) {
  if (!dateSet || !dateSet.size) return [];
  return (records || []).filter((r) => dateSet.has(String(r.date).slice(0, 10)));
}

function filterEventsByDates(events, dateSet) {
  if (!dateSet || !dateSet.size) return events || [];
  return (events || []).filter((e) => dateSet.has(String(e.date).slice(0, 10)));
}

function empWithPosition(emp, position) {
  return { ...emp, position };
}

function calcScopedPayrollRow(ctx, emp, dateSet, { position, payrollKind, includeCommission = true }) {
  const records = filterRecordsByDates(ctx.attendanceRecords, dateSet);
  const actionPlans = ctx.actionPlans || [];
  const summary = summarizeEmployeeMonth(
    empWithPosition(emp, position),
    records,
    ctx.config,
    actionPlans.filter((p) => p.employeeId === emp.id && p.status === "active")
  );
  const adjustment = ctx.adjustment ? { ...ctx.adjustment } : null;
  if (adjustment && !includeCommission) {
    adjustment.salesCount = 0;
    adjustment.commissionAmount = 0;
  } else if (includeCommission && adjustment?.salesCount >= COMMISSION_SALES_THRESHOLD) {
    /* full month sales count preserved for agent slip */
  }

  const bonuses = filterEventsByDates(ctx.bonusEvents, dateSet);
  const deductions = filterEventsByDates(ctx.deductionEvents, dateSet);

  const row = calcPayrollRow(
    empWithPosition(emp, position),
    summary,
    ctx.ym,
    ctx.config,
    ctx.rates,
    bonuses,
    deductions,
    adjustment,
    records,
    ctx.commissionTiers,
    ctx.loans,
    ctx.loanPayments,
    ctx.actionPlans || [],
    ctx.payslipGateNotes || [],
    { positionOverride: position, includeCommission }
  );

  return {
    ...row,
    payrollKind: payrollKind || "standard",
    scopedDayCount: dateSet.size,
    scopedDates: [...dateSet].sort(),
    position,
  };
}

function applySplitsToKind(payslip, ctx, kindSuffix) {
  const splits = ctx.allPayrollSplits || [];
  const { byEmployeeMonth, deferredIn } = buildSplitMaps(splits, ctx.ym);
  const empSplits = (byEmployeeMonth.get(empIdFromPayslip(payslip)) || []).filter(
    (s) => splitMatchesKind(s, kindSuffix)
  );
  const empDeferred = (deferredIn.get(empIdFromPayslip(payslip)) || []).filter((s) =>
    splitMatchesKind(s, kindSuffix)
  );
  return applyPayrollSplits(payslip, empSplits, empDeferred);
}

function empIdFromPayslip(p) {
  return p.employeeId;
}

function splitMatchesKind(split, kindSuffix) {
  if (kindSuffix === "training") {
    return split.payrollKind === "training" || split.splitKind === "training_payroll";
  }
  if (kindSuffix === "agent") {
    return !split.payrollKind || split.payrollKind === "agent" || split.splitKind === "payment";
  }
  return true;
}

function buildDualPayrollRow(emp, ctx, program) {
  const trainingDates = computeEligibleTrainingPayDates(program, ctx.attendanceRecords, ctx.ym);
  const agentDates = computeAgentPayDates(program, ctx.ym);

  let training = null;
  let agent = null;

  if (trainingDates.size > 0) {
    training = calcScopedPayrollRow(ctx, emp, trainingDates, {
      position: "Trainee",
      payrollKind: "training",
      includeCommission: false,
    });
    training = applySplitsToKind(training, ctx, "training");
  }

  if (agentDates.size > 0) {
    agent = calcScopedPayrollRow(ctx, emp, agentDates, {
      position: "Agent",
      payrollKind: "agent",
      includeCommission: true,
    });
    agent = applySplitsToKind(agent, ctx, "agent");
  }

  const combinedNet = (training?.netSalary || 0) + (agent?.netSalary || 0);
  const combinedBasic = (training?.basicSalary || 0) + (agent?.basicSalary || 0);

  return {
    payrollKind: "dual",
    employeeId: emp.id,
    name: training?.name || agent?.name || emp.american_name || emp.id,
    unit: emp.unit,
    yearMonth: ctx.ym,
    training,
    agent,
    combinedNet: Math.round(combinedNet * 100) / 100,
    combinedBasic: Math.round(combinedBasic * 100) / 100,
    promotionEffectiveDate: program.promotionEffectiveDate || program.promotion_effective_date,
    programOutcome: program.outcome,
    netSalary: Math.round(combinedNet * 100) / 100,
    basicSalary: Math.round(combinedBasic * 100) / 100,
    totalBonuses: (training?.totalBonuses || 0) + (agent?.totalBonuses || 0),
    totalDeductions: (training?.totalDeductions || 0) + (agent?.totalDeductions || 0),
    latenessDeduction: (training?.latenessDeduction || 0) + (agent?.latenessDeduction || 0),
  };
}

function programOverlapsMonth(program, ym) {
  if (!program) return false;
  const phases = program.allPhases || program.phases || [];
  if (!phases.length) return false;
  const monthStart = `${ym}-01`;
  const monthEnd = `${ym}-31`;
  return phases.some((p) => {
    const ws = p.weekStart || p.week_start;
    const we = p.weekEnd || p.week_end;
    return ws <= monthEnd && we >= monthStart;
  });
}

function shouldUseTrainingPayroll(program, ym) {
  if (!programOverlapsMonth(program, ym)) return false;
  const outcome = program.outcome || "active";
  if (outcome === "active" || outcome === "passed") return true;
  if (["failed", "voluntary_leave", "company_terminated"].includes(outcome)) return true;
  return false;
}

function enrichPayrollRow(emp, standardRow, ctx, program) {
  if (!shouldUseTrainingPayroll(program, ctx.ym)) return standardRow;
  if (!hasDualPayrollInMonth(program, ctx.ym)) {
    const trainingDates = computeEligibleTrainingPayDates(program, ctx.attendanceRecords, ctx.ym);
    if (trainingDates.size === 0) return standardRow;
    const trainingOnly = calcScopedPayrollRow(ctx, emp, trainingDates, {
      position: "Trainee",
      payrollKind: "training",
      includeCommission: false,
    });
    const enriched = applySplitsToKind(trainingOnly, ctx, "training");
    return { ...standardRow, ...enriched };
  }
  const dual = buildDualPayrollRow(emp, ctx, program);
  return { ...standardRow, ...dual };
}

function enrichPayrollRows(rows, employees, ctx, programsByEmployee) {
  if (!programsByEmployee || !programsByEmployee.size) return rows;
  const empMap = new Map(employees.map((e) => [e.id, e]));
  return rows.map((row) => {
    const emp = empMap.get(row.employeeId);
    const program = programsByEmployee.get(row.employeeId);
    if (!emp || !program) return row;
    const rowCtx = {
      ...ctx,
      actionPlans: ctx.actionPlans || [],
      attendanceRecords: ctx.attendanceByEmployee?.get(emp.id) || [],
      bonusEvents: ctx.bonusEvents?.filter((b) => b.employeeId === emp.id) || [],
      deductionEvents: ctx.deductionEvents?.filter((d) => d.employeeId === emp.id) || [],
      adjustment: ctx.adjustments?.find((a) => a.employeeId === emp.id) || null,
      payslipGateNotes: ctx.payslipGateNotesByEmployee?.get(emp.id) || [],
    };
    return enrichPayrollRow(emp, row, rowCtx, program);
  });
}

function resolvePayslipFromBundle(bundle, kind) {
  const p = bundle.payslip;
  if (!p || p.payrollKind !== "dual") return p;
  if (kind === "training") return p.training || p;
  if (kind === "agent") return p.agent || p;
  return p;
}

module.exports = {
  filterRecordsByDates,
  computeEligibleTrainingPayDates,
  computeAgentPayDates,
  hasDualPayrollInMonth,
  buildDualPayrollRow,
  enrichPayrollRow,
  enrichPayrollRows,
  resolvePayslipFromBundle,
  shouldUseTrainingPayroll,
};

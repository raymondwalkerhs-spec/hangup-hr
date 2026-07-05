/**
 * Dual training/agent payroll calculation for mid-month promotion.
 */
const { summarizeEmployeeMonth } = require("./attendance");
const { calcPayrollRow } = require("./payroll");
const { applyPayrollSplits, buildSplitMaps } = require("./payroll-splits");
const {
  computeEligibleTrainingPayDates,
  computeProgramTrainingPayDates,
  computeProgramTrainingPayDatesBeforePromotion,
  computeAgentPayDates,
  hasDualPayrollInMonth,
  countTrainingPayUnits,
  resolveTrainingPayrollAnchorMonth,
  COMMISSION_SALES_THRESHOLD,
  TRAINING_MONTHLY_SALARY,
  TRAINING_DAYS_PER_MONTH,
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

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function sumPayrollTotals(rows) {
  return {
    employees: rows.length,
    totalBasic: round2(rows.reduce((s, p) => s + (p.basicSalary || 0), 0)),
    totalBonuses: round2(rows.reduce((s, p) => s + (p.totalBonuses || 0), 0)),
    totalLateness: round2(rows.reduce((s, p) => s + (p.latenessDeduction || 0), 0)),
    totalDeductions: round2(rows.reduce((s, p) => s + (p.totalDeductions || 0), 0)),
    totalBonusTransfers: round2(rows.reduce((s, p) => s + (p.bonusTransferPayroll || 0), 0)),
    totalNet: round2(rows.reduce((s, p) => s + (p.netSalary || 0), 0)),
  };
}

function mergeRowMeta(flat, parent) {
  if (!flat) return null;
  return {
    ...flat,
    employeeId: parent.employeeId,
    name: flat.name || parent.name,
    unit: flat.unit ?? parent.unit,
    yearMonth: parent.yearMonth || flat.yearMonth,
    profile_photo_file_id: parent.profile_photo_file_id || flat.profile_photo_file_id,
    profile_photo_updated: parent.profile_photo_updated || flat.profile_photo_updated,
    arabicName: parent.arabicName || flat.arabicName,
    promotionEffectiveDate: parent.promotionEffectiveDate || flat.promotionEffectiveDate,
    programOutcome: parent.programOutcome || flat.programOutcome,
  };
}

function flattenForAgentTab(row) {
  if (!row) return null;
  if (row.payrollKind === "training" || row.payrollKind === "training_deferred_month") return null;
  if (row.payrollKind === "dual") {
    if (!row.agent) return null;
    return mergeRowMeta({ ...row.agent, payrollKind: "agent" }, row);
  }
  return row;
}

function flattenForTrainingTab(row) {
  if (!row) return null;
  if (row.payrollKind === "training_deferred_month") return null;
  if (row.payrollKind === "dual") {
    if (!row.training) return null;
    return mergeRowMeta({ ...row.training, payrollKind: "training" }, row);
  }
  if (row.payrollKind === "training") return row;
  return null;
}

function buildPayrollViews(enrichedRows) {
  const agentRows = enrichedRows.map(flattenForAgentTab).filter(Boolean);
  const trainingRows = enrichedRows.map(flattenForTrainingTab).filter(Boolean);
  return {
    agent: { rows: agentRows, totals: sumPayrollTotals(agentRows) },
    training: { rows: trainingRows, totals: sumPayrollTotals(trainingRows) },
  };
}

function calcScopedPayrollRow(
  ctx,
  emp,
  dateSet,
  { position, payrollKind, includeCommission = true, isTrainingScope = false }
) {
  const isTrainee = position === "Trainee";
  const summaryRecords = filterRecordsByDates(ctx.attendanceRecords, dateSet);
  const attendanceForCalc = isTrainingScope ? ctx.attendanceRecords || [] : summaryRecords;
  const bonuses = isTrainingScope ? ctx.bonusEvents || [] : filterEventsByDates(ctx.bonusEvents, dateSet);
  const deductions = isTrainingScope
    ? ctx.deductionEvents || []
    : filterEventsByDates(ctx.deductionEvents, dateSet);
  const actionPlans = ctx.actionPlans || [];
  const summary = summarizeEmployeeMonth(
    empWithPosition(emp, position),
    summaryRecords,
    ctx.config,
    actionPlans.filter((p) => p.employeeId === emp.id && p.status === "active")
  );
  const trainingUnits = isTrainee ? countTrainingPayUnits(summaryRecords) : 0;
  if (isTrainee) {
    summary.workingDays = trainingUnits;
    summary.halfDays = 0;
    summary.quarterOff = 0;
  }
  const adjustment = ctx.adjustment ? { ...ctx.adjustment } : null;
  if (adjustment && !includeCommission) {
    adjustment.salesCount = 0;
    adjustment.commissionAmount = 0;
  } else if (includeCommission && adjustment?.salesCount >= COMMISSION_SALES_THRESHOLD) {
    /* full month sales count preserved for agent slip */
  }

  const calcOptions = {
    positionOverride: position,
    includeCommission,
  };
  if (isTrainee) {
    calcOptions.monthlySalaryOverride = TRAINING_MONTHLY_SALARY;
    calcOptions.workingDaysOverride = TRAINING_DAYS_PER_MONTH;
    calcOptions.includeCommission = false;
  }

  const row = calcPayrollRow(
    empWithPosition(emp, position),
    summary,
    ctx.ym,
    ctx.config,
    ctx.rates,
    bonuses,
    deductions,
    adjustment,
    attendanceForCalc,
    ctx.commissionTiers,
    ctx.loans,
    ctx.loanPayments,
    ctx.actionPlans || [],
    ctx.payslipGateNotes || [],
    calcOptions
  );

  return {
    ...row,
    payrollKind: payrollKind || "standard",
    scopedDayCount: isTrainee ? trainingUnits : dateSet.size,
    scopedDates: [...dateSet].sort(),
    position,
  };
}

function applySplitsToKind(payslip, ctx, kindSuffix) {
  const splits = ctx.allPayrollSplits || [];
  const { byEmployeeMonth, deferredIn } = buildSplitMaps(splits, ctx.ym);
  const empSplits = (byEmployeeMonth.get(empIdFromPayslip(payslip)) || []).filter((s) =>
    splitMatchesKind(s, kindSuffix)
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

function buildDualPayrollRow(emp, ctx, program, programPayroll) {
  const attendanceRecords = programPayroll?.attendanceRecords || ctx.attendanceRecords;
  const trainingDates = computeProgramTrainingPayDatesBeforePromotion(program, attendanceRecords);
  const agentDates = computeAgentPayDates(program, ctx.ym);

  const rowCtx = programPayroll
    ? {
        ...ctx,
        attendanceRecords: programPayroll.attendanceRecords,
        bonusEvents: programPayroll.bonusEvents,
        deductionEvents: programPayroll.deductionEvents,
      }
    : ctx;

  let training = null;
  let agent = null;

  if (trainingDates.size > 0) {
    training = calcScopedPayrollRow(rowCtx, emp, trainingDates, {
      position: "Trainee",
      payrollKind: "training",
      includeCommission: false,
      isTrainingScope: true,
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
    combinedNet: round2(combinedNet),
    combinedBasic: round2(combinedBasic),
    promotionEffectiveDate: program.promotionEffectiveDate || program.promotion_effective_date,
    programOutcome: program.outcome,
    netSalary: round2(combinedNet),
    basicSalary: round2(combinedBasic),
    totalBonuses: (training?.totalBonuses || 0) + (agent?.totalBonuses || 0),
    totalDeductions: (training?.totalDeductions || 0) + (agent?.totalDeductions || 0),
    latenessDeduction: (training?.latenessDeduction || 0) + (agent?.latenessDeduction || 0),
    profile_photo_file_id: emp.profile_photo_file_id || "",
    profile_photo_updated: emp.profile_photo_updated || "",
    arabicName: emp.arabic_name,
    trainingPayrollAnchorMonth: ctx.ym,
    trainingSpanMonths: programPayroll?.months || [ctx.ym],
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

function enrichPayrollRow(emp, standardRow, ctx, program, programPayroll) {
  if (!shouldUseTrainingPayroll(program, ctx.ym)) return standardRow;

  const attendanceRecords = programPayroll?.attendanceRecords || ctx.attendanceRecords;
  const anchorMonth = resolveTrainingPayrollAnchorMonth(program, attendanceRecords);
  if (!anchorMonth) return standardRow;

  if (ctx.ym !== anchorMonth) {
    return {
      ...standardRow,
      payrollKind: "training_deferred_month",
      trainingPayrollAnchorMonth: anchorMonth,
    };
  }

  const consolidatedCtx = {
    ...ctx,
    ym: anchorMonth,
    attendanceRecords: programPayroll?.attendanceRecords || ctx.attendanceRecords,
    bonusEvents: programPayroll?.bonusEvents || ctx.bonusEvents,
    deductionEvents: programPayroll?.deductionEvents || ctx.deductionEvents,
  };

  if (hasDualPayrollInMonth(program, ctx.ym)) {
    const dual = buildDualPayrollRow(emp, consolidatedCtx, program, programPayroll);
    return { ...standardRow, ...dual };
  }

  const trainingDates = computeProgramTrainingPayDates(program, attendanceRecords);
  if (trainingDates.size === 0) return standardRow;
  const trainingOnly = calcScopedPayrollRow(consolidatedCtx, emp, trainingDates, {
    position: "Trainee",
    payrollKind: "training",
    includeCommission: false,
    isTrainingScope: true,
  });
  const enriched = applySplitsToKind(trainingOnly, consolidatedCtx, "training");
  return {
    ...standardRow,
    ...enriched,
    trainingPayrollAnchorMonth: anchorMonth,
    trainingSpanMonths: programPayroll?.months || getProgramMonthSpanFromPayroll(programPayroll, program),
    profile_photo_file_id: emp.profile_photo_file_id || standardRow.profile_photo_file_id,
    profile_photo_updated: emp.profile_photo_updated || standardRow.profile_photo_updated,
    arabicName: emp.arabic_name || standardRow.arabicName,
  };
}

function getProgramMonthSpanFromPayroll(programPayroll, program) {
  if (programPayroll?.months?.length) return programPayroll.months;
  const { getProgramMonthSpan } = require("./training-pay-rules");
  return getProgramMonthSpan(program);
}

function enrichPayrollRows(rows, employees, ctx, programsByEmployee, programPayrollByEmployee) {
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
    return enrichPayrollRow(emp, row, rowCtx, program, programPayrollByEmployee?.get(emp.id));
  });
}

function buildProgramPayrollDataForEmployees(programsByEmployee, loaders) {
  const { getProgramMonthSpan } = require("./training-pay-rules");
  const byEmployee = new Map();
  for (const [empId, program] of programsByEmployee) {
    const months = getProgramMonthSpan(program);
    const attendanceRecords = [];
    const bonusEvents = [];
    const deductionEvents = [];
    for (const ym of months) {
      attendanceRecords.push(...loaders.getAttendance(ym, empId));
      bonusEvents.push(...loaders.getBonuses(ym, empId));
      deductionEvents.push(...loaders.getDeductions(ym, empId));
    }
    byEmployee.set(empId, { months, attendanceRecords, bonusEvents, deductionEvents });
  }
  return byEmployee;
}

function filterTrainingSplits(splits) {
  return (splits || []).filter(
    (s) => s.splitKind === "training_payroll" || s.splitKind === "training_bonus" || s.payrollKind === "training"
  );
}

function filterAgentSplits(splits) {
  return (splits || []).filter(
    (s) =>
      s.splitKind !== "training_payroll" &&
      s.splitKind !== "training_bonus" &&
      s.payrollKind !== "training"
  );
}

function resolvePayslipFromBundle(bundle, kind) {
  const p = bundle.payslip;
  if (!p) return p;
  if (p.payrollKind !== "dual") {
    if (kind === "training" && p.payrollKind !== "training") return null;
    if (kind === "agent" && p.payrollKind === "training") return null;
    return p;
  }
  if (kind === "training") return p.training || null;
  if (kind === "agent") return p.agent || null;
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
  flattenForAgentTab,
  flattenForTrainingTab,
  buildPayrollViews,
  sumPayrollTotals,
  buildProgramPayrollDataForEmployees,
  filterTrainingSplits,
  filterAgentSplits,
  resolveTrainingPayrollAnchorMonth,
};

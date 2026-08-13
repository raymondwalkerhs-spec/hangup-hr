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
  resolveTrainingAnchorMonth,
  isGraduatedFromTraining,
  inferPromotionDateFromProgram,
  COMMISSION_SALES_THRESHOLD,
  TRAINING_MONTHLY_SALARY,
  TRAINING_DAYS_PER_MONTH,
  TRAINING_DAILY_RATE,
  isTrainingTransportDate,
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
  return { ...emp, position: String(position || "").trim() };
}

const { round2, portionEarnedNet, rebuildDualCombined } = require("./payroll-hybrid");
const { resolvePaymentMethod } = require("./hr-constants");
const {
  applyTrainingPortionAdjustments,
  applyAgentPortionAdjustments,
  adjustmentForScopedCalc,
} = require("./payroll-portion-adjustments");

const { payrollRowDisplayNet } = require("./payroll-display-net");
const { sumPayrollRowMetrics } = require("./payroll-row-metrics");
const { buildTrainingPayBreakdown, payOptionsFromAdjustment } = require("./training-pay-breakdown");
const { clearPayrollSplitMeta } = require("./payroll-split-meta");

function sumPayrollTotals(rows) {
  return sumPayrollRowMetrics(rows);
}

function mergeRowMeta(flat, parent) {
  if (!flat) return null;
  const parentTraining = parent.training && typeof parent.training === "object" ? parent.training : null;
  return {
    ...flat,
    employeeId: parent.employeeId,
    name: flat.name || parent.name,
    unit: flat.unit ?? parent.unit,
    team: flat.team ?? parent.team,
    status: flat.status ?? parent.status,
    depart_date: flat.depart_date ?? parent.depart_date,
    yearMonth: parent.yearMonth || flat.yearMonth,
    profile_photo_file_id: parent.profile_photo_file_id || flat.profile_photo_file_id,
    profile_photo_updated: parent.profile_photo_updated || flat.profile_photo_updated,
    arabicName: parent.arabicName || flat.arabicName,
    promotionEffectiveDate: parent.promotionEffectiveDate || flat.promotionEffectiveDate,
    programOutcome: parent.programOutcome || flat.programOutcome,
    trainingPayrollAnchorMonth: flat.trainingPayrollAnchorMonth ?? parent.trainingPayrollAnchorMonth,
    trainingSpanMonths: flat.trainingSpanMonths ?? parent.trainingSpanMonths,
    trainingPayBreakdown:
      flat.trainingPayBreakdown ?? parentTraining?.trainingPayBreakdown ?? parent.trainingPayBreakdown,
    trainingAccruedPreview: flat.trainingAccruedPreview ?? parent.trainingAccruedPreview,
    earnedNetSalary: flat.earnedNetSalary ?? parent.earnedNetSalary,
    earnedBasicSalary: flat.earnedBasicSalary ?? parent.earnedBasicSalary,
  };
}

/**
 * Unified payroll list (CHANGELOG 2.3.8): one grid for agents + trainees + dual.
 * Do not drop training rows — trainees belong on the same screen.
 */
function flattenForAgentTab(row) {
  if (!row) return null;
  return row;
}

function flattenForTrainingTab(row) {
  if (!row) return null;
  if (row.payrollKind === "training_deferred_month") return row;
  if (row.payrollKind === "dual") {
    if (!row.training) return null;
    return mergeRowMeta({ ...row.training, payrollKind: "training" }, row);
  }
  if (row.payrollKind === "training") return row;
  return null;
}

function buildPayrollViews(enrichedRows, opts = {}) {
  let agentRows = enrichedRows.map(flattenForAgentTab).filter(Boolean);
  let trainingRows = enrichedRows.map(flattenForTrainingTab).filter(Boolean);
  if (opts.hideOut !== false || opts.showLegacyEmployees !== true) {
    const { filterPayrollViewRows } = require("./payroll-view-filters");
    agentRows = filterPayrollViewRows(agentRows, opts);
    trainingRows = filterPayrollViewRows(trainingRows, opts);
  }
  return {
    agent: { rows: agentRows, totals: sumPayrollTotals(agentRows) },
    training: { rows: trainingRows, totals: sumPayrollTotals(trainingRows) },
  };
}

function resolveTrainingAdjustment(ctx, empId, anchorMonth) {
  if (!anchorMonth || ctx.ym === anchorMonth) return ctx.adjustment || null;
  try {
    const store = require("./data-store");
    const anchorAdj = store.getPayrollAdjustment(anchorMonth, empId);
    if (anchorAdj) return anchorAdj;
  } catch {
    /* cache miss */
  }
  return ctx.adjustment || null;
}

function adjustmentsForAnchorResolve(ctx, empId, program, programPayroll, attendanceRecords) {
  const list = [];
  const seen = new Set();
  const push = (adj) => {
    if (!adj || seen.has(adj)) return;
    seen.add(adj);
    list.push(adj);
  };
  push(ctx.adjustment);
  const autoAnchor = resolveTrainingPayrollAnchorMonth(program, attendanceRecords);
  push(resolveTrainingAdjustment(ctx, empId, autoAnchor));
  try {
    const store = require("./data-store");
    for (const ym of programPayroll?.months || []) {
      if (ym === ctx.ym) continue;
      push(store.getPayrollAdjustment(ym, empId));
    }
  } catch {
    /* cache miss */
  }
  return list;
}

function resolveAnchorMonthForProgram(ctx, emp, program, programPayroll, attendanceRecords) {
  const adjustments = adjustmentsForAnchorResolve(ctx, emp.id, program, programPayroll, attendanceRecords);
  return resolveTrainingAnchorMonth(program, attendanceRecords, ...adjustments);
}

function buildTrainingConsolidatedPreview(emp, program, programPayroll, ctx) {
  const attendanceRecords = programPayroll?.attendanceRecords || ctx.attendanceRecords;
  const anchorMonth = resolveAnchorMonthForProgram(ctx, emp, program, programPayroll, attendanceRecords);
  if (!anchorMonth) return null;
  const trainingAdjustment = resolveTrainingAdjustment(ctx, emp.id, anchorMonth);
  const payOptions = payOptionsFromAdjustment(trainingAdjustment);
  const trainingDates = computeProgramTrainingPayDates(program, attendanceRecords, payOptions);
  if (trainingDates.size === 0) return null;
  const consolidatedCtx = {
    ...ctx,
    ym: anchorMonth,
    adjustment: trainingAdjustment,
    trainingProgram: program,
    attendanceRecords: programPayroll?.attendanceRecords || ctx.attendanceRecords,
    bonusEvents: programPayroll?.bonusEvents || ctx.bonusEvents,
    deductionEvents: programPayroll?.deductionEvents || ctx.deductionEvents,
  };
  const row = calcScopedPayrollRow(consolidatedCtx, emp, trainingDates, {
    position: "Trainee",
    payrollKind: "training",
    includeCommission: false,
    isDual: false,
  });
  const earnedNet = round2(Number(row.calculatedNet ?? row.netSalary) || 0);
  const trainingPayBreakdown = buildTrainingPayBreakdown(emp, program, programPayroll, consolidatedCtx);
  return {
    ...row,
    earnedNetSalary: earnedNet,
    earnedBasicSalary: round2(Number(row.basicSalary) || 0),
    trainingPayrollAnchorMonth: anchorMonth,
    trainingSpanMonths: programPayroll?.months || getProgramMonthSpanFromPayroll(programPayroll, program),
    trainingPayBreakdown,
  };
}

function buildMonthScopedDeferredPreview(emp, program, programPayroll, ctx, anchorMonth) {
  const attendanceRecords = programPayroll?.attendanceRecords || ctx.attendanceRecords || [];
  const trainingAdjustment = resolveTrainingAdjustment(ctx, emp.id, anchorMonth);
  const payOptions = payOptionsFromAdjustment(trainingAdjustment);
  const monthDates = computeEligibleTrainingPayDates(program, attendanceRecords, ctx.ym, payOptions);
  if (monthDates.size === 0) return null;
  const monthCtx = {
    ...ctx,
    ym: ctx.ym,
    adjustment: trainingAdjustment,
    trainingProgram: program,
    attendanceRecords,
    bonusEvents: programPayroll?.bonusEvents || ctx.bonusEvents,
    deductionEvents: programPayroll?.deductionEvents || ctx.deductionEvents,
  };
  const row = calcScopedPayrollRow(monthCtx, emp, monthDates, {
    position: "Trainee",
    payrollKind: "training",
    includeCommission: false,
    isDual: false,
  });
  const earnedNet = round2(Number(row.calculatedNet ?? row.netSalary) || 0);
  const earnedBasic = round2(Number(row.basicSalary) || 0);
  return {
    ...row,
    earnedNetSalary: earnedNet,
    earnedBasicSalary: earnedBasic,
    trainingPayrollAnchorMonth: anchorMonth,
    trainingSpanMonths: programPayroll?.months || getProgramMonthSpanFromPayroll(programPayroll, program),
    trainingPayBreakdown: buildTrainingPayBreakdown(emp, program, programPayroll, monthCtx),
  };
}

function buildDeferredTrainingRow(standardRow, anchorMonth, preview) {
  const note = `Training pay accrues in ${anchorMonth} (deferred month — no pay this month).`;
  const earnedNet = preview ? round2(preview.earnedNetSalary ?? preview.netSalary) : 0;
  const earnedBasic = preview ? round2(preview.earnedBasicSalary ?? preview.basicSalary) : 0;
  return clearPayrollSplitMeta({
    ...standardRow,
    payrollKind: "training_deferred_month",
    trainingPayrollAnchorMonth: anchorMonth,
    trainingSpanMonths: preview?.trainingSpanMonths,
    position: "Trainee",
    monthlySalary: TRAINING_MONTHLY_SALARY,
    workingDaysInMonth: TRAINING_DAYS_PER_MONTH,
    dailyRate: TRAINING_DAILY_RATE,
    totalWorkingDays: preview?.totalWorkingDays ?? 0,
    scopedDayCount: preview?.scopedDayCount ?? 0,
    earnedNetSalary: earnedNet,
    earnedBasicSalary: earnedBasic,
    trainingAccruedPreview: !!preview,
    trainingPayBreakdown: preview?.trainingPayBreakdown,
    basicSalary: 0,
    netSalary: 0,
    calculatedNet: 0,
    netBasic: 0,
    totalBonuses: 0,
    totalDeductions: 0,
    commissionAmount: 0,
    salesCount: 0,
    transportAllowance: 0,
    transportDays: 0,
    holdAmount: 0,
    latenessDeduction: 0,
    otherDeductions: 0,
    bonusTransferPayroll: 0,
    monthNotes: [standardRow.monthNotes, note].filter(Boolean).join("\n\n"),
  });
}

function calcScopedPayrollRow(
  ctx,
  emp,
  dateSet,
  { position, payrollKind, includeCommission = true, isDual = false }
) {
  const isTrainee = position === "Trainee";
  const summaryRecords = filterRecordsByDates(ctx.attendanceRecords, dateSet);
  const attendanceForCalc = summaryRecords;
  const bonuses = filterEventsByDates(ctx.bonusEvents, dateSet);
  const deductions = filterEventsByDates(ctx.deductionEvents, dateSet);
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
  const adjustment = adjustmentForScopedCalc(ctx.adjustment, { payrollKind, isDual });
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
    calcOptions.skipFractionDeductions = true;
    if (ctx.trainingProgram) {
      calcOptions.transportAttendanceRecords = summaryRecords.filter((r) =>
        isTrainingTransportDate(ctx.trainingProgram, String(r.date).slice(0, 10))
      );
    }
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
  const anchorMonth = resolveAnchorMonthForProgram(ctx, emp, program, programPayroll, attendanceRecords) || ctx.ym;
  const trainingAdjustment = resolveTrainingAdjustment(ctx, emp.id, anchorMonth);
  const payOptions = payOptionsFromAdjustment(trainingAdjustment);
  const trainingDates = computeProgramTrainingPayDatesBeforePromotion(program, attendanceRecords, payOptions);
  const agentDates = computeAgentPayDates(program, ctx.ym);

  const rowCtx = programPayroll
    ? {
        ...ctx,
        adjustment: trainingAdjustment,
        trainingProgram: program,
        attendanceRecords: programPayroll.attendanceRecords,
        bonusEvents: programPayroll.bonusEvents,
        deductionEvents: programPayroll.deductionEvents,
      }
    : { ...ctx, adjustment: trainingAdjustment, trainingProgram: program };

  let training = null;
  let agent = null;

  if (trainingDates.size > 0) {
    training = calcScopedPayrollRow(rowCtx, emp, trainingDates, {
      position: "Trainee",
      payrollKind: "training",
      includeCommission: false,
      isDual: true,
    });
    training = applySplitsToKind(training, ctx, "training");
    training = applyTrainingPortionAdjustments(training, trainingAdjustment);
    training.trainingPayBreakdown = buildTrainingPayBreakdown(emp, program, programPayroll, rowCtx);
  }

  if (agentDates.size > 0) {
    agent = calcScopedPayrollRow(ctx, emp, agentDates, {
      position: "Agent",
      payrollKind: "agent",
      includeCommission: true,
      isDual: true,
    });
    agent = applySplitsToKind(agent, ctx, "agent");
    agent = applyAgentPortionAdjustments(agent, ctx.adjustment, { isDual: true });
  }

  const combinedNet = round2(portionEarnedNet(training) + portionEarnedNet(agent));
  const combinedBasic = round2((training?.basicSalary || 0) + (agent?.basicSalary || 0));
  const paymentMethod = resolvePaymentMethod(emp, ctx.adjustment);

  return rebuildDualCombined({
    payrollKind: "dual",
    employeeId: emp.id,
    name: training?.name || agent?.name || emp.american_name || emp.id,
    unit: emp.unit,
    yearMonth: ctx.ym,
    training,
    agent,
    paymentMethod,
    payment_method: paymentMethod,
    combinedNet: round2(combinedNet),
    combinedBasic: round2(combinedBasic),
    promotionEffectiveDate: program.promotionEffectiveDate || program.promotion_effective_date,
    programOutcome: program.outcome,
    trainingPayrollPaid: ctx.adjustment?.trainingPayrollPaid === true,
    trainingNetSalaryOverrideActive:
      ctx.adjustment?.trainingNetSalaryOverride != null && ctx.adjustment?.trainingNetSalaryOverride !== "",
    agentNetSalaryOverrideActive:
      ctx.adjustment?.agentNetSalaryOverride != null && ctx.adjustment?.agentNetSalaryOverride !== "",
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
  });
}

function programOverlapsMonth(program, ym) {
  if (!program) return false;
  const phases = program.allPhases || program.phases || [];
  if (!phases.length) return false;
  const { parseYearMonth, getDaysInMonth } = require("./calendar");
  const { year, month } = parseYearMonth(ym);
  const days = getDaysInMonth(year, month);
  if (!days.length) return false;
  const monthStart = days[0];
  const monthEnd = days[days.length - 1];
  return phases.some((p) => {
    const ws = p.weekStart || p.week_start;
    const we = p.weekEnd || p.week_end;
    return ws <= monthEnd && we >= monthStart;
  });
}

function shouldUseTrainingPayroll(program, ym, emp) {
  if (!programOverlapsMonth(program, ym)) return false;
  const outcome = program.outcome || "active";
  const graduated = isGraduatedFromTraining(emp, program);

  if (graduated) {
    // training_passed agents still on an active program need defer/anchor logic until phase 4 pay month.
    if (outcome === "active") return true;
    const promo =
      parseDate(program.promotionEffectiveDate || program.promotion_effective_date) ||
      inferPromotionDateFromProgram(program);
    if (!promo) return false;
    const anchorMonth = promo.slice(0, 7);
    if (ym !== anchorMonth) return false;
    return outcome === "passed";
  }

  if (outcome === "active" || outcome === "passed") return true;
  if (["failed", "voluntary_leave", "company_terminated"].includes(outcome)) return true;
  return false;
}

function parseDate(s) {
  const d = String(s || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function enrichPayrollRow(emp, standardRow, ctx, program, programPayroll) {
  if (!shouldUseTrainingPayroll(program, ctx.ym, emp)) return standardRow;

  const attendanceRecords = programPayroll?.attendanceRecords || ctx.attendanceRecords;
  const anchorMonth = resolveAnchorMonthForProgram(ctx, emp, program, programPayroll, attendanceRecords);
  if (!anchorMonth) return standardRow;

  if (ctx.ym !== anchorMonth) {
    if (isGraduatedFromTraining(emp, program) && ctx.ym > anchorMonth) {
      return standardRow;
    }
    let preview = buildTrainingConsolidatedPreview(emp, program, programPayroll, ctx);
    if (!preview) {
      preview = buildMonthScopedDeferredPreview(emp, program, programPayroll, ctx, anchorMonth);
    }
    return buildDeferredTrainingRow(standardRow, anchorMonth, preview);
  }

  const consolidatedCtx = {
    ...ctx,
    ym: anchorMonth,
    adjustment: resolveTrainingAdjustment(ctx, emp.id, anchorMonth),
    trainingProgram: program,
    attendanceRecords: programPayroll?.attendanceRecords || ctx.attendanceRecords,
    bonusEvents: programPayroll?.bonusEvents || ctx.bonusEvents,
    deductionEvents: programPayroll?.deductionEvents || ctx.deductionEvents,
  };

  if (hasDualPayrollInMonth(program, ctx.ym)) {
    const dual = buildDualPayrollRow(emp, consolidatedCtx, program, programPayroll);
    return clearPayrollSplitMeta({ ...standardRow, ...dual });
  }

  const trainingOnly = buildTrainingConsolidatedPreview(emp, program, programPayroll, ctx);
  if (!trainingOnly) return standardRow;
  let enriched = applySplitsToKind(trainingOnly, consolidatedCtx, "training");
  enriched = applyTrainingPortionAdjustments(enriched, consolidatedCtx.adjustment);
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
  buildDeferredTrainingRow,
  buildTrainingConsolidatedPreview,
  resolveTrainingPayrollAnchorMonth,
};

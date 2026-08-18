const { employeeDisplayName, getWorkingDaysForMonth, isPayrollEligibleForMonth, countUnpaidFractionDeductions } = require("./attendance");
const { resolveEmployeeForMonth, lookupSalary } = require("./month-profile");
const { calcTransportAllowance } = require("./transport");
const { calcTierCommission } = require("./commission-tiers");
const { getEmployeeLoanDeductions, totalLoanDeduction } = require("./loans");
const { buildSplitMaps, applyPayrollSplits } = require("./payroll-splits");
const { TL_BONUS_TYPE } = require("./hr-constants");

const BONUS_TYPES = [
  "Closed Sales Bonus",
  "Bonus from TL / OP",
  "Competition Bonus",
  "Other Bonus",
  "Comission",
  "Training - ON Hold - Correction",
  "Transportation",
];

const HS2_BONUS_TYPES = [
  "Other Bonus",
  "Bonus from TL / OP",
  "Training - ON Hold - Correction",
  "Transportation",
];

function bonusTypesForCompany(context) {
  const ctx = String(context || "hangup").trim().toLowerCase();
  if (ctx === "hs2" || ctx === "hs-2") return HS2_BONUS_TYPES;
  return BONUS_TYPES;
}

const DEDUCTION_TYPES = [
  "Lateness Deduction",
  "Cellphone Deduction",
  "Non-Approved Day Off",
  "Other Deductions",
  "ON HOLD",
  "Quality Deduction",
  "Loan Repayment",
  "Bonus from TL / OP",
  "No-Notice Departure Penalty",
  "No-Notice Transport Penalty",
  "Training Cancellation",
  "Notice Period Shortfall",
];

const PAYROLL_STATUSES = require("./month-profile").PAYROLL_STATUSES;

function groupByEmployee(events) {
  const map = new Map();
  for (const e of events) {
    if (!map.has(e.employeeId)) map.set(e.employeeId, []);
    map.get(e.employeeId).push(e);
  }
  return map;
}

function sumByType(events, type) {
  return events
    .filter((e) => e.type === type)
    .reduce((s, e) => s + (e.amount || 0), 0);
}

function bonusBreakdown(events) {
  const breakdown = {};
  const predefined = new Set(BONUS_TYPES);
  for (const e of events || []) {
    breakdown[e.type] = (breakdown[e.type] || 0) + (e.amount || 0);
  }
  for (const t of BONUS_TYPES) {
    if (!(t in breakdown)) breakdown[t] = 0;
  }
  return breakdown;
}

function deductionBreakdown(events) {
  const breakdown = {};
  for (const t of DEDUCTION_TYPES) breakdown[t] = sumByType(events, t);
  const other = events
    .filter((e) => !DEDUCTION_TYPES.includes(e.type) && e.type !== "Lateness Deduction")
    .reduce((s, e) => s + (e.amount || 0), 0);
  if (other) breakdown["Other"] = (breakdown["Other"] || 0) + other;
  return breakdown;
}

function calcPayrollRow(
  emp,
  summary,
  ym,
  config,
  rates,
  bonuses = [],
  deductions = [],
  adjustment = null,
  attendanceRecords = [],
  commissionTiers = [],
  loans = [],
  loanPayments = [],
  actionPlans = [],
  payslipGateNotes = [],
  options = {},
  extraPayrollEntries = []
) {
  const resolved = resolveEmployeeForMonth(emp, adjustment, rates, ym);
  
  // Build override options from adjustment - these take precedence
  const overrideOptions = {
    positionOverride: adjustment?.position || options.positionOverride || undefined,
    monthlySalaryOverride: adjustment?.monthlySalaryOverride !== undefined && adjustment?.monthlySalaryOverride !== null
      ? Number(adjustment.monthlySalaryOverride)
      : options.monthlySalaryOverride || undefined,
    workingDaysOverride: options.workingDaysOverride || undefined,
    ...options,
  };
  
  const positionForSalary = overrideOptions.positionOverride || resolved.position;
  const workingDaysInMonth = overrideOptions.workingDaysOverride ?? getWorkingDaysForMonth(ym, config);
  const baseMonthlySalary = overrideOptions.monthlySalaryOverride ?? lookupSalary(positionForSalary, rates);
  const salaryRaise =
    overrideOptions.monthlySalaryOverride != null ? 0 : Number(adjustment?.salaryRaise) || 0;
  const monthlySalary = Math.round((baseMonthlySalary + salaryRaise) * 100) / 100;
  const dailyRate = workingDaysInMonth > 0 ? monthlySalary / workingDaysInMonth : 0;
  const extraDays = adjustment?.extraDays ?? summary.extraDays ?? 0;
  const twoWeekHold = adjustment?.twoWeekHold === true;
  const nsncHalf = summary.nsncHalf || 0;
  const fractionDeductions = overrideOptions.skipFractionDeductions
    ? { unpaidHalfDays: 0, unpaidQuarterOff: 0 }
    : countUnpaidFractionDeductions(attendanceRecords);
  const { unpaidHalfDays, unpaidQuarterOff } = fractionDeductions;
  const basicSalary =
    (summary.workingDays +
      extraDays -
      unpaidHalfDays * 0.5 -
      unpaidQuarterOff * 0.25 -
      summary.nsnc * 2 -
      nsncHalf * 1.5) *
    dailyRate;

  const transportEligible =
    overrideOptions.skipTransport === true ? false : resolved.transportEligible;
  const transportRecords = overrideOptions.transportAttendanceRecords ?? attendanceRecords;
  const transport = calcTransportAllowance(
    transportRecords,
    workingDaysInMonth,
    config,
    transportEligible,
    { fullGrant: adjustment?.fullTransportGrant === true }
  );

  const allBonuses = [...bonuses];
  let salesCount = Number(adjustment?.salesCount) || 0;
  if (overrideOptions.includeCommission === false) salesCount = 0;
  const tierResult = calcTierCommission(salesCount, commissionTiers);
  let commissionAmount = tierResult.amount;
  let commissionBreakdown = tierResult.breakdown;
  if (salesCount === 0) {
    commissionAmount = Number(adjustment?.commissionAmount) || 0;
    commissionBreakdown =
      commissionAmount > 0
        ? [
            {
              label: adjustment?.commissionComments || adjustment?.commissionType || "Manual commission",
              amount: commissionAmount,
            },
          ]
        : [];
  }
  if (commissionAmount > 0) {
    allBonuses.push({
      employeeId: emp.id,
      date: `${ym}-01`,
      amount: commissionAmount,
      type: "Comission",
      reason:
        commissionBreakdown.map((b) => `${b.label}: ${b.amount}`).join(" + ") ||
        adjustment?.commissionComments ||
        adjustment?.commissionType ||
        "",
    });
  }
  if (transport.amount > 0) {
    allBonuses.push({
      employeeId: emp.id,
      date: `${ym}-01`,
      amount: transport.amount,
      type: "Transportation",
      reason: transport.fullGrant
        ? "Transportation — full month grant"
        : `${transport.days} transport day-units × ${transport.dailyRate} EGP`,
    });
  }

  for (const entry of extraPayrollEntries || []) {
    if (entry.netAmount > 0) {
      allBonuses.push({
        employeeId: emp.id,
        date: `${ym}-01`,
        amount: entry.netAmount,
        type: entry.label || "Extra",
        reason: entry.label || "Extra payroll",
      });
    }
  }

  const bonusMap = bonusBreakdown(allBonuses);
  const totalBonuses = Object.values(bonusMap).reduce((s, v) => s + v, 0);

  const loanDeductions = getEmployeeLoanDeductions(loans, emp.id, ym, loanPayments);
  const activePlans = require("./action-plans").getActivePlansForEmployee(actionPlans, emp.id);
  const { deductions: aipDeductions, notes: aipDedNotes } = require("./action-plans").applyAipToDeductionEvents(
    deductions,
    activePlans
  );
  const aipDayOff = require("./action-plans").calcAipDayOffPenalty(attendanceRecords, dailyRate, activePlans);
  const allDeductions = [...aipDeductions];
  if (aipDayOff.penalty > 0) {
    allDeductions.push({
      employeeId: emp.id,
      date: `${ym}-01`,
      amount: aipDayOff.penalty,
      type: "Other Deductions",
      reason: "Action Improvement Plan — Day-OFF penalty (3 salary days)",
    });
  }
  for (const ld of loanDeductions) {
    allDeductions.push({
      employeeId: emp.id,
      date: `${ym}-01`,
      amount: ld.amount,
      type: "Loan Repayment",
      reason: `Installment ${ld.installmentNumber}/${ld.installmentsTotal}${ld.notes ? ` — ${ld.notes}` : ""}`,
    });
  }

  const dedMap = deductionBreakdown(allDeductions);
  const sheetDeductions = Object.values(dedMap).reduce((s, v) => s + v, 0);
  const latenessFromSheet = dedMap["Lateness Deduction"] || 0;
  let latenessDeduction;
  if (activePlans.length) {
    const aipLate = require("./action-plans").calcLatenessWithAip(
      attendanceRecords,
      config,
      activePlans
    );
    latenessDeduction = aipLate.amount;
  } else {
    latenessDeduction = latenessFromSheet > 0 ? latenessFromSheet : summary.latenessDeductions;
  }
  const bonusTransferPayroll = dedMap[TL_BONUS_TYPE] || 0;
  const otherDeductions = sheetDeductions - latenessFromSheet - bonusTransferPayroll;

  const holdAmount = twoWeekHold ? dailyRate * 10 : 0;
  let basicSalaryAdjusted = basicSalary;
  if (adjustment?.noticePayScaledBasic != null && !Number.isNaN(Number(adjustment.noticePayScaledBasic))) {
    const noticePct = Number(adjustment?.noticePayPercent);
    if (noticePct === 0) {
      basicSalaryAdjusted = 0;
    } else if (noticePct > 0) {
      basicSalaryAdjusted = Number(adjustment.noticePayScaledBasic);
    }
  }

  const taxRules = config.taxRules || { incomeTaxRate: 0, socialInsuranceRate: 0 };
  const incomeTaxRate = Number(taxRules.incomeTaxRate) || 0;
  const socialInsuranceRate = Number(taxRules.socialInsuranceRate) || 0;
  const taxableGross = Math.max(0, basicSalaryAdjusted + totalBonuses - bonusTransferPayroll);
  const taxAmount = Math.round(taxableGross * (incomeTaxRate / 100) * 100) / 100;
  const statutoryDeductions =
    Math.round(basicSalaryAdjusted * (socialInsuranceRate / 100) * 100) / 100;

  const totalDeductions = latenessDeduction + otherDeductions + holdAmount + taxAmount + statutoryDeductions;
  const noPayroll = adjustment?.noPayroll === true;
  const calculatedNet =
    Math.round((basicSalaryAdjusted + totalBonuses - totalDeductions - bonusTransferPayroll) * 100) / 100;

  // Calculate base net salary
  let netSalary = noPayroll ? 0 : calculatedNet;
  
  // Apply net salary override if present and valid
  if (adjustment?.netSalaryOverride != null && adjustment.netSalaryOverride !== "") {
    const overrideValue = Number(adjustment.netSalaryOverride);
    if (!Number.isNaN(overrideValue) && overrideValue >= 0) {
      netSalary = overrideValue;
    }
  }

  const aipSection = require("./action-plans").buildAipPayslipSection(
    activePlans,
    [...(summary.aipNotes || []), ...aipDedNotes, ...aipDayOff.notes]
  );
  const gateNotes = (payslipGateNotes || []).filter(Boolean).join("\n");
  const combinedNotes = [adjustment?.monthNotes || "", aipSection, gateNotes].filter(Boolean).join("\n\n");

  return {
    employeeId: emp.id,
    internal_id: emp.internal_id || "",
    name: employeeDisplayName(emp),
    arabicName: emp.arabic_name,
    unit: emp.unit,
    paymentMethod: resolved.payment_method,
    position: positionForSalary,
    monthlySalary,
    salaryRaise,
    dailyRate: Math.round(dailyRate * 100) / 100,
    workingDaysInMonth,
    totalWorkingDays: summary.workingDays,
    dayOff: summary.daysOff,
    halfDays: summary.halfDays,
    quarterDays: summary.quarterOff,
    wfh: summary.wfh,
    extraDays,
    nsnc: summary.nsnc,
    nsncHalf,
    transportDays: transport.days,
    transportDailyRate: transport.dailyRate,
    transportAllowance: transport.amount,
    basicSalary: Math.round(basicSalaryAdjusted * 100) / 100,
    bonuses: bonusMap,
    totalBonuses: Math.round(totalBonuses * 100) / 100,
    deductions: dedMap,
    latenessDeduction,
    latenessDetail: summary.latenessDetail,
    otherDeductions: Math.round(otherDeductions * 100) / 100,
    bonusTransferPayroll: Math.round(bonusTransferPayroll * 100) / 100,
    totalDeductions: Math.round(totalDeductions * 100) / 100,
    holdAmount: Math.round(holdAmount * 100) / 100,
    twoWeekHold,
    commissionType: adjustment?.commissionType || null,
    commissionAmount: commissionAmount > 0 ? Math.round(commissionAmount * 100) / 100 : 0,
    salesCount,
    commissionBreakdown,
    loanDeductions,
    loanDeductionTotal: totalLoanDeduction(loanDeductions),
    payrollStatus: adjustment?.payrollStatus || resolved.payrollStatus || "pending",
    monthNotes: combinedNotes,
    taxAmount,
    statutoryDeductions,
    aipSection,
    payslipGateNotes: payslipGateNotes || [],
    noPayroll,
    calculatedNet,
    earnedNetSalary: noPayroll ? calculatedNet : undefined,
    earnedBasicSalary: noPayroll ? Math.round(basicSalaryAdjusted * 100) / 100 : undefined,
    payrollSettled: noPayroll ? true : undefined,
    profile_photo_file_id: emp.profile_photo_file_id || "",
    profile_photo_updated: emp.profile_photo_updated || "",
    netSalary: Math.round(netSalary * 100) / 100,
    netBasic: Math.round((basicSalaryAdjusted - latenessDeduction) * 100) / 100,
    status: emp.status,
    yearMonth: ym,
    // Override indicators - show whether an override is active
    monthlySalaryOverrideActive: adjustment?.monthlySalaryOverride != null && adjustment?.monthlySalaryOverride !== "",
    monthlySalaryOverrideValue: adjustment?.monthlySalaryOverride !== undefined && adjustment?.monthlySalaryOverride !== null
      ? Number(adjustment.monthlySalaryOverride)
      : null,
    netSalaryOverrideActive: adjustment?.netSalaryOverride != null && adjustment?.netSalaryOverride !== "",
    netSalaryOverrideValue: adjustment?.netSalaryOverride !== undefined && adjustment?.netSalaryOverride !== null
      ? Number(adjustment.netSalaryOverride)
      : null,
    positionOverrideActive: adjustment?.position != null && adjustment?.position !== "" && adjustment?.position !== emp.position,
  };
}

function buildPayroll(
  employees,
  summaries,
  ym,
  config,
  rates,
  bonusEvents = [],
  deductionEvents = [],
  adjustments = [],
  attendanceByEmployee = new Map(),
  commissionTiers = [],
  loans = [],
  loanPayments = [],
  allPayrollSplits = [],
  actionPlans = [],
  payslipGateNotesByEmployee = new Map(),
  extraPayrollEntries = []
) {
  const summaryMap = new Map(summaries.map((s) => [s.employeeId, s]));
  const bonusMap = groupByEmployee(bonusEvents);
  const dedMap = groupByEmployee(deductionEvents);
  const adjMap = new Map(adjustments.map((a) => [a.employeeId, a]));
  const { byEmployeeMonth, deferredIn } = buildSplitMaps(allPayrollSplits, ym);

  return employees
    .filter((emp) => isPayrollEligibleForMonth(emp, ym, attendanceByEmployee.get(emp.id) || []))
    .map((emp) => {
      const summary = summaryMap.get(emp.id) || {
        employeeId: emp.id,
        name: employeeDisplayName(emp),
        unit: emp.unit,
        email: emp.email,
        workingDays: 0,
        daysOff: 0,
        halfDays: 0,
        quarterOff: 0,
        wfh: 0,
        lateness: 0,
        nsnc: 0,
        nsncHalf: 0,
        paused: 0,
        extraDays: 0,
        latenessDeductions: 0,
        latenessDetail: "0 Lateness before 3:00PM\n0 Lateness After 3:00PM",
      };
      return applyPayrollSplits(
        calcPayrollRow(
          emp,
          summary,
          ym,
          config,
          rates,
          bonusMap.get(emp.id) || [],
          dedMap.get(emp.id) || [],
          adjMap.get(emp.id) || null,
          attendanceByEmployee.get(emp.id) || [],
          commissionTiers,
          loans,
          loanPayments,
          actionPlans,
          payslipGateNotesByEmployee.get(emp.id) || [],
          {},
          (extraPayrollEntries || []).filter((e) => e.employeeId === emp.id)
        ),
        byEmployeeMonth.get(emp.id) || [],
        deferredIn.get(emp.id) || []
      );
    })
    .sort((a, b) => (a.unit || "").localeCompare(b.unit || "") || a.name.localeCompare(b.name));
}

function buildEmployeePayrollHistory(
  employeeId,
  months,
  getDataForMonth
) {
  return months.map((ym) => {
    const data = getDataForMonth(ym);
    const emp = data.employees.find((e) => e.id === employeeId);
    if (!emp) return null;
    const records = data.attendance.filter((r) => r.employeeId === employeeId);
    const summary = data.summarize(emp, records);
    const adjustment = data.adjustments.find((a) => a.employeeId === employeeId) || null;
    return calcPayrollRow(
      emp,
      summary,
      ym,
      data.config,
      data.rates,
      data.bonuses.filter((b) => b.employeeId === employeeId),
      data.deductions.filter((d) => d.employeeId === employeeId),
      adjustment,
      records,
      data.commissionTiers || [],
      data.loans || [],
      data.loanPayments || []
    );
  }).filter(Boolean);
}

module.exports = {
  buildPayroll,
  lookupSalary: require("./month-profile").lookupSalary,
  calcPayrollRow,
  buildEmployeePayrollHistory,
  BONUS_TYPES,
  HS2_BONUS_TYPES,
  bonusTypesForCompany,
  DEDUCTION_TYPES,
  PAYROLL_STATUSES,
};

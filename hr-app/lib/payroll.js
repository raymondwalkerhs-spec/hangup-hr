const { employeeDisplayName, getWorkingDaysForMonth, isPayrollEligible } = require("./attendance");
const { resolveEmployeeForMonth, lookupSalary } = require("./month-profile");
const { calcTransportAllowance } = require("./transport");
const { calcTierCommission } = require("./commission-tiers");
const { getEmployeeLoanDeductions, totalLoanDeduction } = require("./loans");
const { buildSplitMaps, applyPayrollSplits } = require("./payroll-splits");

const BONUS_TYPES = [
  "Closed Sales Bonus",
  "Bonus from TL / OP",
  "Competition Bonus",
  "Other Bonus",
  "Comission",
  "Training - ON Hold - Correction",
  "Transportation",
];

const DEDUCTION_TYPES = [
  "Lateness Deduction",
  "Cellphone Deduction",
  "Non-Approved Day Off",
  "Other Deductions",
  "ON HOLD",
  "Quality Deduction",
  "Loan Repayment",
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
  for (const t of BONUS_TYPES) breakdown[t] = sumByType(events, t);
  const other = events
    .filter((e) => !BONUS_TYPES.includes(e.type))
    .reduce((s, e) => s + (e.amount || 0), 0);
  if (other) breakdown["Other"] = (breakdown["Other"] || 0) + other;
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
  loanPayments = []
) {
  const resolved = resolveEmployeeForMonth(emp, adjustment, rates, ym);
  const workingDaysInMonth = getWorkingDaysForMonth(ym, config);
  const monthlySalary = resolved.monthlySalaryResolved ?? lookupSalary(resolved.position, rates);
  const dailyRate = workingDaysInMonth > 0 ? monthlySalary / workingDaysInMonth : 0;
  const extraDays = adjustment?.extraDays ?? summary.extraDays ?? 0;
  const twoWeekHold = adjustment?.twoWeekHold === true;
  const nsncHalf = summary.nsncHalf || 0;
  const basicSalary =
    (summary.workingDays +
      extraDays -
      summary.halfDays * 0.5 -
      summary.quarterOff * 0.25 -
      summary.nsnc * 2 -
      nsncHalf * 1.5) *
    dailyRate;

  const transport = calcTransportAllowance(
    attendanceRecords,
    workingDaysInMonth,
    config,
    resolved.transportEligible
  );

  const allBonuses = [...bonuses];
  const salesCount = Number(adjustment?.salesCount) || 0;
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
      reason: `${transport.days} transport day-units × ${transport.dailyRate} EGP`,
    });
  }

  const bonusMap = bonusBreakdown(allBonuses);
  const totalBonuses = Object.values(bonusMap).reduce((s, v) => s + v, 0);

  const loanDeductions = getEmployeeLoanDeductions(loans, emp.id, ym, loanPayments);
  const allDeductions = [...deductions];
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
  const latenessDeduction = latenessFromSheet > 0 ? latenessFromSheet : summary.latenessDeductions;
  const otherDeductions = sheetDeductions - latenessFromSheet;

  const holdAmount = twoWeekHold ? dailyRate * 10 : 0;
  const totalDeductions = latenessDeduction + otherDeductions + holdAmount;
  const netSalary = basicSalary + totalBonuses - totalDeductions;

  return {
    employeeId: emp.id,
    name: employeeDisplayName(emp),
    arabicName: emp.arabic_name,
    unit: emp.unit,
    paymentMethod: resolved.payment_method,
    position: resolved.position,
    monthlySalary,
    salaryRaise: adjustment?.salaryRaise || 0,
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
    basicSalary: Math.round(basicSalary * 100) / 100,
    bonuses: bonusMap,
    totalBonuses: Math.round(totalBonuses * 100) / 100,
    deductions: dedMap,
    latenessDeduction,
    latenessDetail: summary.latenessDetail,
    otherDeductions: Math.round(otherDeductions * 100) / 100,
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
    monthNotes: adjustment?.monthNotes || "",
    profile_photo_file_id: emp.profile_photo_file_id || "",
    profile_photo_updated: emp.profile_photo_updated || "",
    netSalary: Math.round(netSalary * 100) / 100,
    netBasic: Math.round((basicSalary - latenessDeduction) * 100) / 100,
    status: emp.status,
    yearMonth: ym,
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
  allPayrollSplits = []
) {
  const summaryMap = new Map(summaries.map((s) => [s.employeeId, s]));
  const bonusMap = groupByEmployee(bonusEvents);
  const dedMap = groupByEmployee(deductionEvents);
  const adjMap = new Map(adjustments.map((a) => [a.employeeId, a]));
  const { byEmployeeMonth, deferredIn } = buildSplitMaps(allPayrollSplits, ym);

  return employees
    .filter(isPayrollEligible)
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
          loanPayments
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
  DEDUCTION_TYPES,
  PAYROLL_STATUSES,
};

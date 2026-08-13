/**

 * Consistent payroll column values for list view, totals, and payslip alignment.

 */

const { payrollRowDisplayNet } = require("./payroll-display-net");

const { isPayrollSettled, isTrainingDeferredRow, payrollPaidNet } = require("./payroll-settled");



function round2(n) {

  return Math.round((Number(n) || 0) * 100) / 100;

}



function dualSum(row, key) {

  if (row?.payrollKind !== "dual") return Number(row?.[key]) || 0;

  const training = row.training || {};

  const agent = row.agent || {};

  return (Number(training[key]) || 0) + (Number(agent[key]) || 0);

}



function payrollRowMetrics(row) {

  const paidNet = payrollPaidNet(row);

  if (isPayrollSettled(row)) {

    let workingDays = Number(row?.totalWorkingDays) || 0;

    if (row?.payrollKind === "dual") {

      workingDays = dualSum(row, "totalWorkingDays");

    }

    return {

      workingDays,

      salesCount: 0,

      commission: 0,

      basicSalary: 0,

      loan: 0,

      transport: 0,

      otherBonuses: 0,

      deductions: 0,

      netSalary: 0,

      paidNet,

      bonusTransferPayroll: 0,

      totalDeductions: 0,

      totalBonuses: 0,

    };

  }

  if (isTrainingDeferredRow(row)) {

    const workingDays =

      Number(row?.totalWorkingDays) || Number(row?.scopedDayCount) || 0;

    return {

      workingDays,

      salesCount: 0,

      commission: 0,

      basicSalary: 0,

      loan: 0,

      transport: 0,

      otherBonuses: 0,

      deductions: 0,

      netSalary: 0,

      paidNet: 0,

      bonusTransferPayroll: 0,

      totalDeductions: 0,

      totalBonuses: 0,

    };

  }



  const isDual = row?.payrollKind === "dual";

  const transport = isDual ? dualSum(row, "transportAllowance") : Number(row?.transportAllowance) || 0;

  const commission = isDual ? dualSum(row, "commissionAmount") : Number(row?.commissionAmount) || 0;

  const totalBonuses = isDual ? dualSum(row, "totalBonuses") : Number(row?.totalBonuses) || 0;

  const otherBonuses = round2(Math.max(0, totalBonuses - transport - commission));

  const loan = isDual ? dualSum(row, "loanDeductionTotal") : Number(row?.loanDeductionTotal) || 0;

  const totalDeductions = isDual ? dualSum(row, "totalDeductions") : Number(row?.totalDeductions) || 0;

  const deductions = round2(Math.max(0, totalDeductions - loan));

  const basicSalary = isDual ? dualSum(row, "basicSalary") : Number(row?.basicSalary) || 0;

  const salesCount = isDual ? dualSum(row, "salesCount") : Number(row?.salesCount) || 0;

  const workingDays = isDual

    ? dualSum(row, "totalWorkingDays")

    : Number(row?.totalWorkingDays) || 0;

  const bonusTransferPayroll = isDual

    ? dualSum(row, "bonusTransferPayroll")

    : Number(row?.bonusTransferPayroll) || 0;



  return {

    workingDays,

    salesCount,

    commission,

    basicSalary,

    loan,

    transport,

    otherBonuses,

    deductions,

    netSalary: payrollRowDisplayNet(row),

    paidNet,

    bonusTransferPayroll,

    totalDeductions,

    totalBonuses,

  };

}



function sumPayrollRowMetrics(rows) {

  const totals = {

    employees: rows.length,

    totalWorkingDays: 0,

    totalSales: 0,

    totalCommission: 0,

    totalBasic: 0,

    totalLoan: 0,

    totalTransport: 0,

    totalOtherBonuses: 0,

    totalDeductions: 0,

    totalNet: 0,

    totalPaidNet: 0,

    totalAllNet: 0,

    totalBonusTransfers: 0,

    totalBonuses: 0,

    totalLateness: 0,

  };



  for (const row of rows || []) {

    const m = payrollRowMetrics(row);

    totals.totalWorkingDays += m.workingDays;

    totals.totalSales += m.salesCount;

    totals.totalCommission += m.commission;

    totals.totalBasic += m.basicSalary;

    totals.totalLoan += m.loan;

    totals.totalTransport += m.transport;

    totals.totalOtherBonuses += m.otherBonuses;

    totals.totalDeductions += m.deductions;

    totals.totalNet += m.netSalary;

    totals.totalPaidNet += m.paidNet;

    totals.totalBonusTransfers += m.bonusTransferPayroll;

    totals.totalBonuses += m.totalBonuses;

    totals.totalLateness += Number(row?.latenessDeduction) || 0;

  }



  totals.totalAllNet = round2(totals.totalNet + totals.totalPaidNet);



  for (const key of Object.keys(totals)) {

    if (key === "employees") continue;

    totals[key] = round2(totals[key]);

  }



  return totals;

}



module.exports = {

  payrollRowMetrics,

  sumPayrollRowMetrics,

};



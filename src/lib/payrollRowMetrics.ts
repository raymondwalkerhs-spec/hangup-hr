import { payrollDisplayNet } from "@/lib/employeeSearch";

import { isPayrollSettled, isTrainingDeferredRow, payrollPaidNet } from "@/lib/payrollSettled";



export type PayrollRowMetrics = {

  workingDays: number;

  salesCount: number;

  commission: number;

  basicSalary: number;

  loan: number;

  transport: number;

  otherBonuses: number;

  deductions: number;

  /** Remaining unpaid net (what the Net column shows in bold). */

  netSalary: number;

  /** Paid / Done amount (excluded from netSalary). */

  paidNet: number;

  bonusTransferPayroll: number;

};



function round2(n: number) {

  return Math.round(n * 100) / 100;

}



function dualSum(row: Record<string, unknown>, key: string): number {

  if (row.payrollKind !== "dual") return Number(row[key]) || 0;

  const training = row.training as Record<string, unknown> | undefined;

  const agent = row.agent as Record<string, unknown> | undefined;

  return (Number(training?.[key]) || 0) + (Number(agent?.[key]) || 0);

}



export function payrollRowMetrics(row: Record<string, unknown>): PayrollRowMetrics {

  const paidNet = payrollPaidNet(row);

  if (isPayrollSettled(row)) {

    let workingDays = Number(row.totalWorkingDays) || 0;

    if (row.payrollKind === "dual") {

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

    };

  }

  if (isTrainingDeferredRow(row)) {

    const workingDays = Number(row.totalWorkingDays) || Number(row.scopedDayCount) || 0;

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

    };

  }



  const isDual = row.payrollKind === "dual";

  const transport = isDual ? dualSum(row, "transportAllowance") : Number(row.transportAllowance) || 0;

  const commission = isDual ? dualSum(row, "commissionAmount") : Number(row.commissionAmount) || 0;

  const totalBonuses = isDual ? dualSum(row, "totalBonuses") : Number(row.totalBonuses) || 0;

  const otherBonuses = round2(Math.max(0, totalBonuses - transport - commission));

  const loan = isDual ? dualSum(row, "loanDeductionTotal") : Number(row.loanDeductionTotal) || 0;

  const totalDeductions = isDual ? dualSum(row, "totalDeductions") : Number(row.totalDeductions) || 0;

  const deductions = round2(Math.max(0, totalDeductions - loan));

  const basicSalary = isDual ? dualSum(row, "basicSalary") : Number(row.basicSalary) || 0;

  const salesCount = isDual ? dualSum(row, "salesCount") : Number(row.salesCount) || 0;

  const workingDays = isDual ? dualSum(row, "totalWorkingDays") : Number(row.totalWorkingDays) || 0;

  const bonusTransferPayroll = isDual

    ? dualSum(row, "bonusTransferPayroll")

    : Number(row.bonusTransferPayroll) || 0;



  return {

    workingDays,

    salesCount,

    commission,

    basicSalary,

    loan,

    transport,

    otherBonuses,

    deductions,

    netSalary: payrollDisplayNet(row),

    paidNet,

    bonusTransferPayroll,

  };

}



export type PayrollMetricsTotals = {

  employees: number;

  totalWorkingDays: number;

  totalSales: number;

  totalCommission: number;

  totalBasic: number;

  totalLoan: number;

  totalTransport: number;

  totalOtherBonuses: number;

  totalDeductions: number;

  /** Remaining unpaid net (= sum of Net column bold values). */

  totalNet: number;

  /** Sum of paid / Done amounts. */

  totalPaidNet: number;

  /** Remaining + paid (excludes no-payroll). */

  totalAllNet: number;

  totalBonusTransfers: number;

};



export function sumTotalPaidMetrics(rows: Record<string, unknown>[]) {

  const totals = {

    employees: rows.length,

    totalScheduled: 0,

    totalReceived: 0,

    totalNet: 0,

  };

  for (const row of rows) {

    totals.totalScheduled += Number(row.scheduledAmount) || 0;

    totals.totalReceived += Number(row.receivedAmount) || 0;

    totals.totalNet += Number(row.netSalary) || 0;

  }

  totals.totalScheduled = round2(totals.totalScheduled);

  totals.totalReceived = round2(totals.totalReceived);

  totals.totalNet = round2(totals.totalNet);

  return totals;

}



export function sumPayrollRowMetrics(rows: Record<string, unknown>[]): PayrollMetricsTotals {

  const totals: PayrollMetricsTotals = {

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

  };



  for (const row of rows) {

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

  }



  totals.totalAllNet = round2(totals.totalNet + totals.totalPaidNet);



  for (const key of Object.keys(totals) as (keyof PayrollMetricsTotals)[]) {

    if (key === "employees") continue;

    totals[key] = round2(totals[key] as number);

  }



  return totals;

}



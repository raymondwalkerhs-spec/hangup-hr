#!/usr/bin/env node
/**
 * Diagnose July net payroll vs manual total.
 * Run with: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/diagnose-july-net.js
 */
require("dotenv").config();
const store = require("../lib/data-store");
const companyContext = require("../lib/company-context");
const enrichedPayroll = require("../lib/enriched-payroll");
const { payrollRowDisplayNet } = require("../lib/payroll-display-net");
const { isPayrollSettled, isTrainingDeferredRow } = require("../lib/payroll-settled");
const { buildPayrollViews } = require("../lib/training-payroll");
const { sumPayrollRowMetrics } = require("../lib/payroll-row-metrics");

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function main() {
  const month = process.argv[2] || "2026-07";
  const company = process.argv[3] || "hangup";
  const manual = Number(process.argv[4] || 398403.33);
  const appUi = Number(process.argv[5] || 427331.61);

  await store.ensureSynced();
  await store.refreshPayrollAdjustmentsFromSupabase(month);

  let employees = store.getEmployees({ hideOut: false });
  employees = companyContext.filterEmployeesByCompany(employees, company);

  const bundle = await enrichedPayroll.buildForEmployees(month, employees, company);
  const payroll = bundle.payroll || [];
  const views = buildPayrollViews(payroll, { hideOut: true, month, showLegacyEmployees: false });

  const buckets = {
    settledZero: [],
    deferredZero: [],
    dual: [],
    training: [],
    agent: [],
    other: [],
    outWithPay: [],
  };

  let rawSum = 0;
  for (const row of payroll) {
    const net = payrollRowDisplayNet(row);
    rawSum += net;
    const rec = {
      id: row.employeeId,
      name: row.name || row.employeeName || row.american_name,
      kind: row.payrollKind || "agent",
      status: row.status,
      net: round2(net),
      basic: Number(row.basicSalary) || 0,
      bonuses: Number(row.totalBonuses) || 0,
      deductions: Number(row.totalDeductions) || 0,
      combinedNet: row.combinedNet,
      override: Boolean(row.netSalaryOverrideActive),
    };
    if (isPayrollSettled(row)) buckets.settledZero.push(rec);
    else if (isTrainingDeferredRow(row)) buckets.deferredZero.push(rec);
    else if (row.payrollKind === "dual") buckets.dual.push(rec);
    else if (row.payrollKind === "training") buckets.training.push(rec);
    else if (!row.payrollKind || row.payrollKind === "agent") buckets.agent.push(rec);
    else buckets.other.push(rec);

    const st = String(row.status || "").toLowerCase();
    if ((st === "out" || st.includes("out")) && net > 0) buckets.outWithPay.push(rec);
  }

  const agentViewTotals = views.agent?.totals || {};
  const metrics = sumPayrollRowMetrics(views.agent?.rows || payroll);

  const sumBucket = (arr) => round2(arr.reduce((s, r) => s + (r.net || 0), 0));

  const report = {
    month,
    company,
    employeeCount: employees.length,
    payrollRows: payroll.length,
    agentViewRows: (views.agent?.rows || []).length,
    rawDisplayNetSum: round2(rawSum),
    agentViewTotalsNet: agentViewTotals.totalNet ?? agentViewTotals.netSalary ?? null,
    metricsTotalNet: metrics.totalNet,
    manual,
    appUi,
    deltaRawVsManual: round2(rawSum - manual),
    deltaMetricsVsManual: round2(metrics.totalNet - manual),
    deltaAppUiVsManual: round2(appUi - manual),
    bucketSums: {
      dual: sumBucket(buckets.dual),
      training: sumBucket(buckets.training),
      agent: sumBucket(buckets.agent),
      other: sumBucket(buckets.other),
      outWithPay: sumBucket(buckets.outWithPay),
    },
    bucketCounts: {
      dual: buckets.dual.length,
      training: buckets.training.length,
      agent: buckets.agent.length,
      settled: buckets.settledZero.length,
      deferred: buckets.deferredZero.length,
      outWithPay: buckets.outWithPay.length,
    },
    topOutWithPay: buckets.outWithPay.sort((a, b) => b.net - a.net).slice(0, 20),
    topDual: buckets.dual.sort((a, b) => b.net - a.net).slice(0, 15),
    topOverrides: payroll
      .filter((r) => r.netSalaryOverrideActive)
      .map((r) => ({
        id: r.employeeId,
        name: r.name || r.employeeName,
        net: payrollRowDisplayNet(r),
        override: r.netSalaryOverrideValue ?? r.netSalaryOverride,
      }))
      .sort((a, b) => b.net - a.net)
      .slice(0, 20),
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

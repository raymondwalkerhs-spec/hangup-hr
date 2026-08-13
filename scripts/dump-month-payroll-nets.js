#!/usr/bin/env node
require("dotenv").config();
const store = require("../lib/data-store");
const companyContext = require("../lib/company-context");
const enrichedPayroll = require("../lib/enriched-payroll");
const { payrollRowDisplayNet } = require("../lib/payroll-display-net");

function round2(n) {
  return Math.round(n * 100) / 100;
}

(async () => {
  const month = process.argv[2] || "2026-07";
  await store.ensureSynced();
  await store.refreshPayrollAdjustmentsFromSupabase(month);
  await store.refreshAttendanceFromSupabase(month);

  const att = store.getAttendanceEvents(month);
  const uniq = new Set(att.map((a) => a.employeeId));
  console.log("attendance events", att.length, "employees with att", uniq.size);

  let employees = companyContext.filterEmployeesByCompany(store.getEmployees({ hideOut: false }), "hangup");
  const bundle = await enrichedPayroll.buildForEmployees(month, employees, "hangup");
  const rows = (bundle.payroll || [])
    .map((r) => ({
      id: r.employeeId,
      name: r.name || r.employeeName,
      kind: r.payrollKind || "agent",
      status: r.status,
      net: round2(payrollRowDisplayNet(r)),
      basic: round2(Number(r.basicSalary) || 0),
      bonuses: round2(Number(r.totalBonuses) || 0),
      deductions: round2(Number(r.totalDeductions) || 0),
      wd: Number(r.totalWorkingDays) || 0,
      settled: r.payrollSettled || r.trainingPayrollPaid,
      override: r.netSalaryOverrideActive ? Number(r.netSalaryOverrideValue ?? r.netSalaryOverride) : null,
      noPayroll: !!r.noPayroll,
    }))
    .filter((r) => r.net > 0 || (r.override != null && r.override > 0))
    .sort((a, b) => b.net - a.net);

  const sumNet = round2(rows.reduce((s, r) => s + r.net, 0));
  const sumOverrideFace = round2(
    rows.reduce((s, r) => s + (r.override != null ? r.override : r.net), 0)
  );
  console.log(
    JSON.stringify(
      {
        month,
        sumDisplayNet: sumNet,
        sumUsingOverrideFaceValue: sumOverrideFace,
        count: rows.length,
        rows,
      },
      null,
      2
    )
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

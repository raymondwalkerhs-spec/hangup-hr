#!/usr/bin/env node
require("dotenv").config();
const EMP_ID = "HS3-64";
const YM = "2026-07";

async function main() {
  const { getSupabaseAdmin } = require("../lib/supabase-client");
  const rules = require("../lib/training-pay-rules");
  const { enrichPayrollRow, buildProgramPayrollDataForEmployees } = require("../lib/training-payroll");
  const { calcPayrollRow } = require("../lib/payroll");
  const { summarizeEmployeeMonth } = require("../lib/attendance");
  const store = require("../lib/data-store");

  const db = getSupabaseAdmin();

  const { data: emp, error: empErr } = await db.from("employees").select("*").eq("id", EMP_ID).maybeSingle();
  if (empErr) throw empErr;
  if (!emp) throw new Error(`Employee ${EMP_ID} not found`);
  console.log("Employee:", emp.id, emp.american_name, emp.position, emp.status);

  const { data: program, error: progErr } = await db
    .from("agent_training_programs")
    .select("*")
    .eq("employee_id", EMP_ID)
    .maybeSingle();
  if (progErr) throw progErr;
  console.log("\nProgram outcome:", program?.outcome, "promo:", program?.promotion_effective_date);

  const { data: phases } = await db
    .from("agent_training_phases")
    .select("*")
    .eq("employee_id", EMP_ID)
    .order("phase_number");
  program.allPhases = (phases || []).map((p) => ({
    phaseNumber: p.phase_number,
    weekStart: p.week_start,
    weekEnd: p.week_end,
    status: p.status,
    salesPassed: p.sales_passed,
  }));
  console.log("Phases:");
  for (const p of program.allPhases) {
    console.log(`  P${p.phaseNumber} ${p.weekStart}..${p.weekEnd} ${p.status}`);
  }

  const span = rules.getProgramMonthSpan(program);
  console.log("\nProgram month span:", span.join(", "));

  const allAtt = [];
  for (const ym of span) {
    const { data: att } = await db
      .from("attendance_events")
      .select("date,status,paid_leave")
      .eq("employee_id", EMP_ID)
      .gte("date", `${ym}-01`)
      .lte("date", `${ym}-31`);
    for (const r of att || []) {
      allAtt.push({ date: r.date, status: r.status, paidLeave: r.paid_leave });
    }
  }
  allAtt.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  console.log(`\nAttendance (${allAtt.length} records across span):`);
  for (const r of allAtt) {
    const unit = rules.trainingPayUnitForRecord
      ? rules.trainingPayUnitForRecord(r)
      : require("../lib/training-pay-rules").trainingPayUnitForRecord?.(r);
    const payable = rules.isTrainingPayDate(program, String(r.date).slice(0, 10), allAtt, String(r.date).slice(0, 7));
    console.log(`  ${r.date} ${r.status} unit=${unit} payable=${payable}`);
  }

  const payableDates = rules.computeProgramTrainingPayDates(program, allAtt);
  const payableList = [...payableDates].sort();
  const units = rules.countTrainingPayUnits(allAtt.filter((r) => payableDates.has(String(r.date).slice(0, 10))));
  const anchor = rules.resolveTrainingPayrollAnchorMonth(program, allAtt);
  const transportDays = allAtt.filter(
    (r) =>
      payableDates.has(String(r.date).slice(0, 10)) &&
      rules.isTrainingTransportDate(program, String(r.date).slice(0, 10)) &&
      String(r.status) === "Attended"
  ).length;
  const transport = Math.round(transportDays * (3000 / 20) * 100) / 100;
  const basic = units * rules.TRAINING_DAILY_RATE;
  console.log("\nManual calc:");
  console.log("  Anchor month:", anchor);
  console.log("  Payable dates:", payableList.length, payableList.join(", "));
  console.log("  Payable units (phases 2–4, phase 1 excluded):", units);
  console.log("  Training basic:", basic, "EGP");
  console.log("  Transport (from week 2, Attended only):", transportDays, "days =", transport, "EGP");
  console.log("  Expected total:", basic + transport, "EGP");

  const programsByEmployee = new Map([[EMP_ID, program]]);
  const programPayrollByEmployee = buildProgramPayrollDataForEmployees(programsByEmployee, {
    getAttendance: (ym, empId) => {
      if (empId !== EMP_ID) return [];
      return allAtt.filter((r) => String(r.date).startsWith(ym));
    },
    getBonuses: () => [],
    getDeductions: () => [],
  });

  const julyAtt = allAtt.filter((r) => String(r.date).startsWith(YM));
  const config = { latenessRules: { tierA: { amount: 50 }, tierB: { amount: 100 } }, workingDaysByMonth: { [YM]: 22 } };
  const rates = [{ position: "Trainee", monthlySalary: 12000 }, { position: "Agent", monthlySalary: 12000 }];
  const summary = summarizeEmployeeMonth(emp, julyAtt, config, []);
  const standardRow = calcPayrollRow(emp, summary, YM, config, rates, [], [], null, julyAtt, [], [], [], [], []);

  const { data: adj } = await db
    .from("payroll_adjustments")
    .select("*")
    .eq("employee_id", EMP_ID)
    .eq("year_month", YM)
    .maybeSingle();

  const row = enrichPayrollRow(
    emp,
    standardRow,
    {
      ym: YM,
      config,
      rates,
      attendanceRecords: julyAtt,
      bonusEvents: [],
      deductionEvents: [],
      adjustment: adj,
      commissionTiers: [],
      loans: [],
      loanPayments: [],
      allPayrollSplits: [],
      actionPlans: [],
    },
    program,
    programPayrollByEmployee.get(EMP_ID)
  );

  console.log("\nApp July payroll row:");
  console.log("  payrollKind:", row.payrollKind);
  console.log("  anchor:", row.trainingPayrollAnchorMonth);
  console.log("  span months:", row.trainingSpanMonths);
  console.log("  totalWorkingDays:", row.totalWorkingDays);
  console.log("  scopedDayCount:", row.scopedDayCount);
  console.log("  basicSalary:", row.basicSalary);
  console.log("  netSalary:", row.netSalary);
  console.log("  earnedNetSalary:", row.earnedNetSalary);
  console.log("  monthlySalary:", row.monthlySalary);
  console.log("  workingDaysInMonth:", row.workingDaysInMonth);
  if (adj) console.log("  adjustment:", JSON.stringify({ trainingPayrollPaid: adj.training_payroll_paid, noPayroll: adj.no_payroll, payrollStatus: adj.payroll_status }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

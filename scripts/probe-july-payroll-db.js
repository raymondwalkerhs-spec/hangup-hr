#!/usr/bin/env node
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");

async function main() {
  const sb = getSupabaseAdmin();
  const month = process.argv[2] || "2026-07";

  const { data: adj, error: e1 } = await sb
    .from("payroll_adjustments")
    .select(
      "employee_id, year_month, no_payroll, net_salary_override, training_net_salary_override, training_payroll_paid, training_payroll_anchor_month, monthly_salary_override, sales_count"
    )
    .eq("year_month", month);
  if (e1) throw e1;

  const { count: attCount } = await sb
    .from("attendance_events")
    .select("*", { count: "exact", head: true })
    .gte("date", `${month}-01`)
    .lte("date", `${month}-31`);

  const { data: bonus } = await sb
    .from("bonus_events")
    .select("employee_id, amount, type")
    .gte("date", `${month}-01`)
    .lte("date", `${month}-31`);

  const { data: ded } = await sb
    .from("deduction_events")
    .select("employee_id, amount, type")
    .gte("date", `${month}-01`)
    .lte("date", `${month}-31`);

  const overrides = (adj || []).filter((a) => a.net_salary_override != null);
  const overrideSum = overrides.reduce((s, a) => s + Number(a.net_salary_override || 0), 0);

  // Try hybrid RPC if exists
  let hybrid = null;
  const rpc = await sb.rpc("calc_employee_month_payroll", { p_month: month }).maybeSingle?.();
  // list functions? skip

  console.log(
    JSON.stringify(
      {
        month,
        adjustments: (adj || []).length,
        attendanceEvents: attCount,
        bonusEvents: (bonus || []).length,
        bonusSum: Math.round((bonus || []).reduce((s, b) => s + Number(b.amount || 0), 0) * 100) / 100,
        deductionEvents: (ded || []).length,
        deductionSum: Math.round((ded || []).reduce((s, b) => s + Number(b.amount || 0), 0) * 100) / 100,
        netOverrides: overrides.length,
        netOverrideSum: Math.round(overrideSum * 100) / 100,
        overrides: overrides.map((o) => ({
          id: o.employee_id,
          net: o.net_salary_override,
          trainingNet: o.training_net_salary_override,
          paid: o.training_payroll_paid,
          noPayroll: o.no_payroll,
        })),
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

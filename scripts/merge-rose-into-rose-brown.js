#!/usr/bin/env node
/**
 * Merge duplicate ROSE (HS3-56) into Rose Brown (HS3-59), then delete HS3-56.
 * Usage: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/merge-rose-into-rose-brown.js
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");

const FROM = "HS3-56"; // ROSE
const TO = "HS3-59"; // Rose Brown

async function main() {
  const db = getSupabaseAdmin();
  const { data: fromEmp, error: e1 } = await db.from("employees").select("*").eq("id", FROM).maybeSingle();
  const { data: toEmp, error: e2 } = await db.from("employees").select("*").eq("id", TO).maybeSingle();
  if (e1) throw e1;
  if (e2) throw e2;
  if (!fromEmp) throw new Error(`${FROM} not found`);
  if (!toEmp) throw new Error(`${TO} not found`);
  console.log("Merging", fromEmp.american_name, FROM, "→", toEmp.american_name, TO);

  // 1) Sales agent_id
  const { data: salesMoved, error: sErr } = await db
    .from("sales")
    .update({ agent_id: TO })
    .eq("agent_id", FROM)
    .select("id");
  if (sErr) throw sErr;
  console.log("sales moved", (salesMoved || []).length);

  const { error: scErr } = await db.from("sales").update({ closer_id: TO }).eq("closer_id", FROM);
  if (scErr && !/column|does not exist/i.test(scErr.message)) throw scErr;

  // 2) RPM sales
  for (const col of ["agent_id", "closer_id"]) {
    const { error } = await db.from("rpm_sales").update({ [col]: TO }).eq(col, FROM);
    if (error && !/column|does not exist|relation/i.test(error.message)) throw error;
  }

  // 3) Attendance: both have same dates — drop FROM rows (keep Rose Brown)
  const { data: delAtt, error: aErr } = await db
    .from("attendance_events")
    .delete()
    .eq("employee_id", FROM)
    .select("date");
  if (aErr) throw aErr;
  console.log("attendance deleted from ROSE", (delAtt || []).length);

  // 4) Payroll adjustments: delete FROM months that TO already has; move the rest
  const { data: toAdj } = await db.from("payroll_adjustments").select("year_month").eq("employee_id", TO);
  const toMonths = new Set((toAdj || []).map((r) => r.year_month));
  const { data: fromAdj } = await db.from("payroll_adjustments").select("*").eq("employee_id", FROM);
  for (const row of fromAdj || []) {
    if (toMonths.has(row.year_month)) {
      const { error } = await db
        .from("payroll_adjustments")
        .delete()
        .eq("employee_id", FROM)
        .eq("year_month", row.year_month);
      if (error) throw error;
      console.log("dropped duplicate adj", row.year_month);
    } else {
      const { error } = await db
        .from("payroll_adjustments")
        .update({ employee_id: TO })
        .eq("employee_id", FROM)
        .eq("year_month", row.year_month);
      if (error) throw error;
      console.log("moved adj", row.year_month);
    }
  }

  // 5) Training program
  const { data: toProg } = await db
    .from("agent_training_programs")
    .select("id")
    .eq("employee_id", TO)
    .maybeSingle();
  if (toProg?.id) {
    const { error } = await db.from("agent_training_programs").delete().eq("employee_id", FROM);
    if (error && !/relation/i.test(error.message)) throw error;
    console.log("dropped ROSE training program (Rose Brown already has one)");
  } else {
    const { error } = await db
      .from("agent_training_programs")
      .update({ employee_id: TO })
      .eq("employee_id", FROM);
    if (error && !/relation/i.test(error.message)) throw error;
    console.log("moved training program");
  }

  // 6) Bonus/deduction/loans/splits/docs — reassign
  for (const table of [
    "bonus_events",
    "deduction_events",
    "employee_loans",
    "loan_payments",
    "loan_requests",
    "payroll_splits",
    "employee_documents",
    "employee_warnings",
    "extra_payroll_entries",
    "leave_requests",
    "action_improvement_plans",
    "onboarding_checklists",
    "offboarding_checklists",
    "equipment_assignments",
  ]) {
    const { error } = await db.from(table).update({ employee_id: TO }).eq("employee_id", FROM);
    if (error && !/column|does not exist|relation/i.test(error.message)) {
      console.warn(table, error.message);
    }
  }

  // 7) Prefer Rose employment_date on Rose Brown if missing
  const patch = {};
  if (!toEmp.employment_date && fromEmp.employment_date) patch.employment_date = fromEmp.employment_date;
  if (!toEmp.arabic_name && fromEmp.arabic_name) patch.arabic_name = fromEmp.arabic_name;
  if (Object.keys(patch).length) {
    const { error } = await db.from("employees").update(patch).eq("id", TO);
    if (error) throw error;
    console.log("patched Rose Brown", patch);
  }

  // 8) Remove ROSE login
  const { error: uErr } = await db.from("app_users").delete().eq("employee_id", FROM);
  if (uErr) console.warn("app_users delete", uErr.message);
  else console.log("deleted app user HS3-56");

  // 9) Delete ROSE employee
  const { error: dErr } = await db.from("employees").delete().eq("id", FROM);
  if (dErr) throw dErr;
  console.log("deleted employee", FROM);

  const { data: check } = await db.from("employees").select("id,american_name").eq("id", FROM).maybeSingle();
  const { data: brown } = await db
    .from("employees")
    .select("id,american_name,employment_date,arabic_name")
    .eq("id", TO)
    .maybeSingle();
  console.log(JSON.stringify({ deletedGone: !check, roseBrown: brown }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

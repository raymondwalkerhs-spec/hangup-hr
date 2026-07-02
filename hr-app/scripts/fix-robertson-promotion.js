#!/usr/bin/env node
/**
 * Undo mistaken promotion: robertson william (HS3-22) → OP03.
 * Supabase only (DATA_BACKEND=supabase). Does not touch Google Sheets.
 * Usage: node scripts/fix-robertson-promotion.js [--dry-run]
 */
require("dotenv").config();

const backend = require("../lib/backend");
const OLD_ID = "HS3-22";
const BAD_ID = "OP03";
const dryRun = process.argv.includes("--dry-run");

async function main() {
  if (!backend.useSupabase()) {
    console.error("This fix requires DATA_BACKEND=supabase in .env");
    process.exit(1);
  }

  const { getSupabaseAdmin } = require("../lib/supabase-client");
  const supabaseRepo = require("../lib/supabase-repo");
  const db = getSupabaseAdmin();

  const { data: oldEmp } = await db.from("employees").select("*").eq("id", OLD_ID).maybeSingle();
  const { data: badEmp } = await db.from("employees").select("*").eq("id", BAD_ID).maybeSingle();

  console.log(dryRun ? "DRY RUN\n" : "Applying Supabase fix...\n");
  console.log("Before:", {
    [OLD_ID]: oldEmp
      ? {
          promoted_to_id: oldEmp.promoted_to_id,
          team: oldEmp.team,
          position: oldEmp.position,
        }
      : null,
    [BAD_ID]: badEmp ? "exists" : "missing",
  });

  const tablesWithEmployeeId = [
    "attendance_events",
    "bonus_events",
    "deduction_events",
    "payroll_adjustments",
    "employee_loans",
    "employee_documents",
    "employment_periods",
    "leave_requests",
    "employee_warnings",
    "onboarding_checklists",
    "offboarding_checklists",
    "equipment_assignments",
    "action_improvement_plans",
  ];

  for (const table of tablesWithEmployeeId) {
    const { count } = await db
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("employee_id", BAD_ID);
    if (count) {
      console.log(`Reassigning ${count} ${table} row(s) ${BAD_ID} → ${OLD_ID}`);
      if (!dryRun) {
        const { error } = await db.from(table).update({ employee_id: OLD_ID }).eq("employee_id", BAD_ID);
        if (error) throw new Error(`${table}: ${error.message}`);
      }
    }
  }

  for (const table of ["sales", "bonus_requests"]) {
    for (const col of ["agent_id", "closer_id", "employee_id"]) {
      const { count } = await db
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq(col, BAD_ID);
      if (count) {
        console.log(`Reassigning ${count} ${table}.${col} ${BAD_ID} → ${OLD_ID}`);
        if (!dryRun) {
          const { error } = await db.from(table).update({ [col]: OLD_ID }).eq(col, BAD_ID);
          if (error && !/column/.test(error.message)) throw new Error(`${table}.${col}: ${error.message}`);
        }
      }
    }
  }

  if (!oldEmp) throw new Error(`${OLD_ID} not found in Supabase`);

  const hs3Updates = {
    promoted_to_id: null,
    promoted_from_id: null,
    former_ids: null,
    lead_role: null,
    effective_from_month: null,
    position: "Agent",
    team: oldEmp.team || "Team Tris",
    status: "Active",
  };

  console.log(`Updating ${OLD_ID}:`, hs3Updates);
  if (!dryRun) {
    await supabaseRepo.updateEmployee(OLD_ID, hs3Updates, "system-fix");
  }

  if (badEmp) {
    console.log(`Deleting employee ${BAD_ID}`);
    if (!dryRun) {
      await supabaseRepo.deleteEmployee(BAD_ID);
    }
  }

  try {
    const usersAdmin = require("../lib/users-admin");
    const login = await usersAdmin.getAppUser(BAD_ID);
    if (login) {
      console.log(`Deleting app_user ${BAD_ID}`);
      if (!dryRun) {
        await usersAdmin.deleteAppUser(BAD_ID, "Raymond");
      }
    }
  } catch (err) {
    console.warn("app_user cleanup:", err.message);
  }

  console.log("\nDone. Restart the app or run Sync on each HR PC to refresh local SQLite cache.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

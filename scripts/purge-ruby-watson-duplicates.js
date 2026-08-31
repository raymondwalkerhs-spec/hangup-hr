#!/usr/bin/env node
/**
 * Purge mistaken duplicate approvals for Ruby Watson: keep HS3-83, delete HS3-84..HS3-94.
 * Usage: node scripts/purge-ruby-watson-duplicates.js [--dry-run]
 */
require("dotenv").config();

const KEEP_ID = "HS3-83";
const DELETE_FROM = 84;
const DELETE_TO = 94;
const dryRun = process.argv.includes("--dry-run");

const backend = require("../lib/backend");
const supabaseRepo = require("../lib/supabase-repo");

function deleteIds() {
  const ids = [];
  for (let n = DELETE_FROM; n <= DELETE_TO; n++) ids.push(`HS3-${n}`);
  return ids;
}

const TABLES_EMPLOYEE_ID = [
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
  "employee_quality_notes",
  "loan_requests",
  "bonus_requests",
  "agent_training_phases",
  "coaching_tickets",
  "it_requests",
  "leave_request_documents",
  "extra_payroll_entries",
  "payroll_cache_invalidation",
];

const TABLE_COL_PAIRS = [
  ["meeting_requests", "requester_employee_id"],
];

async function countForId(db, table, col, id) {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true }).eq(col, id);
  if (error) {
    const msg = String(error.message || error.code || "");
    if (!msg || /column|relation|does not exist|42703|PGRST/i.test(msg)) return null;
    throw new Error(`${table}.${col}: ${msg}`);
  }
  return count || 0;
}

async function deleteForId(db, table, col, id) {
  const { error } = await db.from(table).delete().eq(col, id);
  if (error) {
    if (/column|relation|does not exist/i.test(error.message)) return;
    throw new Error(`${table}.${col} delete: ${error.message}`);
  }
}

async function main() {
  if (!backend.useSupabase()) {
    console.error("Requires DATA_BACKEND=supabase");
    process.exit(1);
  }

  const { getSupabaseAdmin } = require("../lib/supabase-client");
  const db = getSupabaseAdmin();
  const ids = deleteIds();

  const { data: keep } = await db
    .from("employees")
    .select("id, american_name, arabic_name, status, team, position")
    .eq("id", KEEP_ID)
    .maybeSingle();
  if (!keep) {
    throw new Error(`${KEEP_ID} not found — aborting`);
  }

  const { data: targets } = await db
    .from("employees")
    .select("id, american_name, arabic_name, status, team, position")
    .in("id", ids)
    .order("id");

  console.log(dryRun ? "DRY RUN\n" : "Applying purge...\n");
  console.log("Keep:", keep);
  console.log("Delete employee rows:", (targets || []).map((e) => `${e.id} (${e.american_name || "?"})`));

  for (const id of ids) {
    const { data: emp } = await db.from("employees").select("id").eq("id", id).maybeSingle();
    if (!emp) {
      console.log(`Skip ${id} — no employee row`);
      continue;
    }

    for (const table of TABLES_EMPLOYEE_ID) {
      const n = await countForId(db, table, "employee_id", id);
      if (n) {
        console.log(`  ${id}: delete ${n} from ${table}`);
        if (!dryRun) await deleteForId(db, table, "employee_id", id);
      }
    }

    for (const [table, col] of TABLE_COL_PAIRS) {
      const n = await countForId(db, table, col, id);
      if (n) {
        console.log(`  ${id}: delete ${n} from ${table}.${col}`);
        if (!dryRun) await deleteForId(db, table, col, id);
      }
    }

    for (const table of ["sales"]) {
      for (const col of ["agent_id", "closer_id"]) {
        const n = await countForId(db, table, col, id);
        if (n) {
          console.log(`  ${id}: delete ${n} from ${table}.${col}`);
          if (!dryRun) await deleteForId(db, table, col, id);
        }
      }
    }

    for (const table of ["bonus_requests"]) {
      for (const col of ["employee_id", "bonus_employee_id", "agent_id", "closer_id"]) {
        const n = await countForId(db, table, col, id);
        if (n) {
          console.log(`  ${id}: delete ${n} from ${table}.${col}`);
          if (!dryRun) await deleteForId(db, table, col, id);
        }
      }
    }

    for (const table of ["team_tls", "team_closers", "unit_ops"]) {
      const n = await countForId(db, table, "employee_id", id);
      if (n) {
        console.log(`  ${id}: delete ${n} from ${table}`);
        if (!dryRun) await deleteForId(db, table, "employee_id", id);
      }
    }

    for (const table of ["org_teams"]) {
      const n = await countForId(db, table, "tl_employee_id", id);
      if (n) {
        console.log(`  ${id}: clear ${n} org_teams.tl_employee_id`);
        if (!dryRun) {
          const { error } = await db.from(table).update({ tl_employee_id: null }).eq("tl_employee_id", id);
          if (error) throw new Error(`org_teams: ${error.message}`);
        }
      }
    }

    for (const col of ["coach_employee_id", "author_employee_id"]) {
      const n = await countForId(db, "coaching_tickets", col, id);
      if (n) {
        console.log(`  ${id}: delete ${n} coaching_tickets.${col}`);
        if (!dryRun) await deleteForId(db, "coaching_tickets", col, id);
      }
    }

    const { data: users } = await db
      .from("app_users")
      .select("username, employee_id, status")
      .or(`employee_id.eq.${id},username.eq.${id}`);
    for (const u of users || []) {
      console.log(`  ${id}: delete app_user ${u.username}`);
      if (!dryRun) {
        const usersAdmin = require("../lib/users-admin");
        await usersAdmin.deleteAppUser(u.username, "system-purge");
      }
    }

    const { count: regCount } = await db
      .from("agent_registration_requests")
      .select("*", { count: "exact", head: true })
      .eq("employee_id", id);
    if (regCount) {
      console.log(`  ${id}: delete ${regCount} agent_registration_requests`);
      if (!dryRun) await deleteForId(db, "agent_registration_requests", "employee_id", id);
    }

    console.log(`  ${id}: delete employee row`);
    if (!dryRun) await supabaseRepo.deleteEmployee(id);
  }

  const { data: dupRegs } = await db
    .from("agent_registration_requests")
    .select("id, status, employee_id, full_name, created_at")
    .ilike("full_name", "%ruby%watson%");
  const orphanRegs = (dupRegs || []).filter((r) => r.employee_id !== KEEP_ID && ids.includes(r.employee_id));
  if (orphanRegs.length) {
    console.log("Registration rows to remove:", orphanRegs);
    if (!dryRun) {
      for (const r of orphanRegs) {
        await db.from("agent_registration_requests").delete().eq("id", r.id);
      }
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

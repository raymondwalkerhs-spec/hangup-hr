#!/usr/bin/env node
/**
 * Report broken employee/sales/login relations.
 * Usage: node scripts/audit-relations.js
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");

async function main() {
  const db = getSupabaseAdmin();
  const critical = [];
  const warnings = [];

  const { data: employees } = await db.from("employees").select("id, american_name, status, internal_id");
  const empIds = new Set((employees || []).map((e) => e.id));

  const { data: sales } = await db.from("sales").select("id, agent_id, closer_id, form_data");
  for (const s of sales || []) {
    if (s.agent_id && !empIds.has(s.agent_id)) {
      critical.push(`sale ${s.id}: invalid agent_id ${s.agent_id}`);
    }
    if (s.closer_id && !empIds.has(s.closer_id)) {
      critical.push(`sale ${s.id}: invalid closer_id ${s.closer_id}`);
    }
    const fd = s.form_data || {};
    if (fd.reviewer && !empIds.has(fd.reviewer)) {
      warnings.push(`sale ${s.id}: reviewer ${fd.reviewer} not in employees`);
    }
    if (fd.assignVerifier && !empIds.has(fd.assignVerifier)) {
      warnings.push(`sale ${s.id}: assignVerifier ${fd.assignVerifier} not in employees`);
    }
  }

  const { data: users } = await db.from("app_users").select("username, employee_id");
  for (const u of users || []) {
    if (u.employee_id && !empIds.has(u.employee_id)) {
      critical.push(`app_user ${u.username}: employee_id ${u.employee_id} missing`);
    }
  }

  const { data: attachments } = await db.from("sales_attachments").select("id, sale_id, dropbox_path, dropbox_link");
  for (const a of attachments || []) {
    if (!a.dropbox_path) {
      warnings.push(`attachment ${a.id}: empty dropbox_path`);
    }
  }

  const outEmployees = (employees || []).filter((e) => String(e.status || "").toLowerCase() === "out");
  for (const emp of outEmployees) {
    const { data: clearance } = await db
      .from("clearance_items")
      .select("status")
      .eq("employee_id", emp.id);
    const pending = (clearance || []).filter((c) => c.status === "pending");
    if (pending.length) warnings.push(`OUT ${emp.id}: ${pending.length} clearance items pending`);

    const { data: equipment } = await db
      .from("equipment_assignments")
      .select("returned_at")
      .eq("employee_id", emp.id);
    const open = (equipment || []).filter((e) => !e.returned_at);
    if (open.length) warnings.push(`OUT ${emp.id}: ${open.length} equipment items outstanding`);
  }

  console.log(`=== Relation audit ===`);
  console.log(`Critical: ${critical.length}`);
  critical.slice(0, 50).forEach((l) => console.log(`  CRIT ${l}`));
  console.log(`Warnings: ${warnings.length}`);
  warnings.slice(0, 50).forEach((l) => console.log(`  WARN ${l}`));

  if (critical.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * One-time fix for app_users: Aurora→HR-1, skip owner duplicate logins.
 * Usage: node scripts/fix-app-users.js
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");

const OWNER_USERNAMES = new Set(["mark", "phoebe", "raymond", "eva"]);

const LINKS = [
  { username: "Aurora", employeeId: "HR-1", role: "hr" },
  { username: "Eva", employeeId: null, role: "ceo" },
  { username: "Raymond", employeeId: null, role: "ceo" },
  { username: "Mark", employeeId: null, role: "ceo" },
  { username: "Phoebe", employeeId: null, role: "ceo" },
];

async function main() {
  const db = getSupabaseAdmin();
  const { data: users, error } = await db.from("app_users").select("*");
  if (error) throw new Error(error.message);

  for (const link of LINKS) {
    const user = (users || []).find((u) => String(u.username).toLowerCase() === link.username.toLowerCase());
    if (!user) {
      console.log(`Skip ${link.username}: user not found`);
      continue;
    }
    const patch = { role: link.role, updated_at: new Date().toISOString() };
    if (link.employeeId) patch.employee_id = link.employeeId;
    const { error: e2 } = await db.from("app_users").update(patch).eq("id", user.id);
    if (e2) console.error(`Failed ${link.username}:`, e2.message);
    else console.log(`Linked ${link.username} → ${link.employeeId || "(owner)"} role=${link.role}`);
  }

  const usersAdmin = require("../lib/users-admin");
  const bcrypt = require("bcrypt");
  const crypto = require("crypto");

  const { data: employees, error: empErr } = await db.from("employees").select("id, american_name, arabic_name, email, status");
  if (empErr) throw new Error(empErr.message);

  const { data: usersAfter } = await db.from("app_users").select("id, username, employee_id");
  const linked = new Set(
    (usersAfter || []).map((u) => String(u.employee_id || u.username || "").trim()).filter(Boolean)
  );
  let created = 0;
  for (const emp of employees || []) {
    if (!emp?.id || linked.has(emp.id)) continue;
    if (usersAdmin.isOwnerEmployee(emp)) continue;
    if (String(emp.status || "").trim() === "Deleted") continue;
    const row = {
      username: emp.id,
      employee_id: emp.id,
      email: null,
      password_hash: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10),
      role: usersAdmin.inferRoleFromEmployeeId(emp.id),
      status: "inactive",
      updated_at: new Date().toISOString(),
    };
    const { error: insErr } = await db.from("app_users").insert(row);
    if (insErr) {
      console.warn(`Skip ${emp.id}: ${insErr.message}`);
      continue;
    }
    linked.add(emp.id);
    created += 1;
  }
  console.log(`Synced employee logins: created ${created} of ${(employees || []).length}`);

  for (const u of users || []) {
    const un = String(u.username).toLowerCase();
    if (!OWNER_USERNAMES.has(un)) continue;
    const dup = (users || []).find(
      (x) => x.employee_id && x.id !== u.id && OWNER_USERNAMES.has(String(x.username).toLowerCase()) === false
    );
    if (dup && String(dup.username) === String(dup.employee_id)) {
      console.log(`Note: owner ${u.username} may have duplicate employee-id login ${dup.username}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

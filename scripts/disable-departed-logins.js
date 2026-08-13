/**
 * Backfill: set app_users.status = inactive for Out employees who have a depart_date.
 * Queries Supabase directly (no local SQLite cache).
 * Usage: node scripts/disable-departed-logins.js [--dry-run]
 */
require("dotenv").config();
const { getSupabaseAdmin, isSupabaseConfigured } = require("../lib/supabase-client");

const dryRun = process.argv.includes("--dry-run");
const OUT = new Set(["out", "out but still get paid"]);

async function main() {
  if (!isSupabaseConfigured()) throw new Error("Supabase not configured");
  const db = getSupabaseAdmin();

  const { data: employees, error } = await db
    .from("employees")
    .select("id, status, depart_date, american_name");
  if (error) throw new Error(error.message);

  const targets = (employees || []).filter((e) => {
    const status = String(e.status || "").trim().toLowerCase();
    const depart = String(e.depart_date || "").slice(0, 10);
    return OUT.has(status) && Boolean(depart);
  });

  const { data: users, error: uErr } = await db
    .from("app_users")
    .select("id, username, status, employee_id");
  if (uErr) throw new Error(uErr.message);

  const byEmp = new Map();
  for (const u of users || []) {
    if (u.employee_id) byEmp.set(String(u.employee_id), u);
    byEmp.set(String(u.username), u);
  }

  const result = { disabled: [], skipped: [], errors: [] };
  for (const emp of targets) {
    const user = byEmp.get(String(emp.id));
    if (!user) {
      result.skipped.push({ employeeId: emp.id, reason: "no_login" });
      continue;
    }
    const st = String(user.status || "").toLowerCase();
    if (st === "inactive" || st === "terminated") {
      result.skipped.push({ employeeId: emp.id, username: user.username, reason: `already_${st}` });
      continue;
    }
    if (dryRun) {
      result.disabled.push({ employeeId: emp.id, username: user.username, dryRun: true });
      continue;
    }
    try {
      const { error: updErr } = await db
        .from("app_users")
        .update({ status: "inactive", updated_at: new Date().toISOString() })
        .eq("id", user.id);
      if (updErr) throw new Error(updErr.message);
      // Revoke sessions
      await db
        .from("app_sessions")
        .update({ revoked_at: new Date().toISOString() })
        .eq("username", user.username)
        .is("revoked_at", null);
      result.disabled.push({ employeeId: emp.id, username: user.username, name: emp.american_name });
    } catch (err) {
      result.errors.push({ employeeId: emp.id, error: err.message });
    }
  }

  console.log(JSON.stringify(result, null, 2));
  console.log(
    `Disabled ${result.disabled.length}; skipped ${result.skipped.length}; errors ${result.errors.length}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

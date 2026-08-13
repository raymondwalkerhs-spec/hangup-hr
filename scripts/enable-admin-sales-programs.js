/**
 * Enable MLA + RPM sales flags for system admin employees (Supabase direct).
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");

const ADMIN_USERNAMES = ["raymond", "mark"];

async function main() {
  const db = getSupabaseAdmin();
  const { data: users, error: uErr } = await db
    .from("app_users")
    .select("username, employee_id")
    .in("username", ADMIN_USERNAMES);
  if (uErr) throw new Error(uErr.message);

  let updated = 0;
  for (const user of users || []) {
    const employeeId = String(user.employee_id || "").trim();
    if (!employeeId) {
      console.warn(`[skip] ${user.username}: no employee_id`);
      continue;
    }
    const { data, error } = await db
      .from("employees")
      .update({
        sales_mla_enabled: true,
        sales_rpm_enabled: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", employeeId)
      .select("id, american_name, sales_mla_enabled, sales_rpm_enabled")
      .single();
    if (error) {
      console.warn(`[fail] ${user.username} (${employeeId}): ${error.message}`);
      continue;
    }
    updated += 1;
    console.log(`[updated] ${user.username} → ${data.id} ${data.american_name || ""} (MLA+RPM enabled)`);
  }
  console.log(`Done. Updated ${updated} employee(s). Restart the app to refresh cache.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

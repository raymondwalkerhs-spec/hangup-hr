#!/usr/bin/env node
/** Normalize legacy app_users.role values (superadmin, administrator, etc.) to canonical roles. */
require("dotenv").config();
const roles = require("../lib/roles");
const { getSupabaseAdmin } = require("../lib/supabase-client");

async function main() {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from("app_users").select("username, role");
  if (error) throw error;
  let updated = 0;
  for (const row of data || []) {
    const canonical = roles.normalizeRole(row.role);
    if (canonical !== String(row.role || "").trim().toLowerCase() && canonical !== row.role) {
      const { error: uErr } = await db
        .from("app_users")
        .update({ role: canonical })
        .eq("username", row.username);
      if (uErr) throw uErr;
      console.log(`${row.username}: ${row.role} → ${canonical}`);
      updated += 1;
    }
  }
  console.log(updated ? `Updated ${updated} user(s).` : "All roles already canonical.");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

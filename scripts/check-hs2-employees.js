/**
 * Check HS-2 employees - are they company hangup or hs2?
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");

async function main() {
  const db = getSupabaseAdmin();
  
  // Check HS-2 employees
  const { data: hs2Emps } = await db.from("employees").select("id, american_name, unit, status, position").eq("unit", "HS-2");
  console.log(`HS-2 unit employees: ${(hs2Emps || []).length}`);
  for (const e of (hs2Emps || []).slice(0, 10)) {
    console.log(`  ${e.id}: ${e.american_name || "?"} | status=${e.status} | position=${e.position}`);
  }
  if ((hs2Emps || []).length > 10) console.log(`  ... and ${(hs2Emps || []).length - 10} more`);

  // Check HS2-PT employees
  const { data: hs2ptEmps } = await db.from("employees").select("id, american_name, unit, status, position").eq("unit", "HS2-PT");
  console.log(`\nHS2-PT unit employees: ${(hs2ptEmps || []).length}`);
  for (const e of (hs2ptEmps || []).slice(0, 5)) {
    console.log(`  ${e.id}: ${e.american_name || "?"} | status=${e.status} | position=${e.position}`);
  }

  // Check org_unit_managers for HS-2
  const { data: hs2Mgr } = await db.from("org_unit_managers").select("*").eq("unit", "HS-2");
  console.log(`\norg_unit_managers for HS-2: ${(hs2Mgr || []).length} entries`);
  
  // Check org_teams for HS-2
  const { data: hs2Teams } = await db.from("org_teams").select("*").eq("unit", "HS-2");
  console.log(`org_teams for HS-2: ${(hs2Teams || []).length} entries`);
}

main().catch(console.error);

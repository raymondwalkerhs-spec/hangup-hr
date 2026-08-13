/**
 * Check what units exist in employees and org tables
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");

async function main() {
  const db = getSupabaseAdmin();
  
  // Check distinct units in employees
  const { data: empUnits } = await db.from("employees").select("unit");
  const unitCounts = {};
  for (const e of (empUnits || [])) {
    const u = e.unit || "NULL";
    unitCounts[u] = (unitCounts[u] || 0) + 1;
  }
  console.log("Employee units:");
  for (const [u, c] of Object.entries(unitCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${u}: ${c} employees`);
  }

  // Check org_unit_managers
  const { data: mgrs } = await db.from("org_unit_managers").select("unit, company");
  console.log("\norg_unit_managers:");
  for (const m of (mgrs || [])) {
    console.log(`  ${m.unit} (company=${m.company || "NULL"})`);
  }

  // Check org_teams
  const { data: teams } = await db.from("org_teams").select("unit, name");
  console.log("\norg_teams:");
  for (const t of (teams || [])) {
    console.log(`  ${t.name} → unit=${t.unit || "NULL"}`);
  }
}

main().catch(console.error);

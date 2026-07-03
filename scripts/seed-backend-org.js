#!/usr/bin/env node
/**
 * Seed Back-End unit: Phoebe as HR manager; ensure backend teams under HS-Back-End.
 * Usage: node scripts/seed-backend-org.js [--dry-run]
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");
const orgHierarchy = require("../lib/org-hierarchy");

const DRY = process.argv.includes("--dry-run");
const BACKEND_TEAMS = ["HR", "Quality", "RTM", "Finance", "Admins", "Back-End"];

async function main() {
  const db = getSupabaseAdmin();
  const { data: employees } = await db.from("employees").select("id,american_name,unit,team");
  const phoebe = orgHierarchy.inferHrManager(employees || []);
  if (!phoebe) {
    console.warn("Phoebe (HR) not found in employees — set hr_manager_id manually later.");
  } else {
    console.log(`HR manager: ${phoebe.id} — ${phoebe.american_name}`);
    if (!DRY) {
      await orgHierarchy.upsertUnitManager(orgHierarchy.BACKEND_UNIT, {
        hrManagerId: phoebe.id,
        company: "hangup",
        notes: "No OP — reports to CEO · HR: Phoebe",
      });
    }
  }

  const { data: teams } = await db.from("org_teams").select("id,name,unit");
  const byName = new Map((teams || []).map((t) => [String(t.name).toLowerCase(), t]));

  for (const name of BACKEND_TEAMS) {
    const existing = byName.get(name.toLowerCase());
    if (existing) {
      if (existing.unit !== orgHierarchy.BACKEND_UNIT) {
        console.log(`Move team "${name}" → ${orgHierarchy.BACKEND_UNIT}`);
        if (!DRY) {
          await db.from("org_teams").update({ unit: orgHierarchy.BACKEND_UNIT }).eq("id", existing.id);
        }
      }
      continue;
    }
    console.log(`Create team "${name}" in ${orgHierarchy.BACKEND_UNIT}`);
    if (!DRY) {
      await db.from("org_teams").insert({ name, unit: orgHierarchy.BACKEND_UNIT, dials_sales: false });
    }
  }

  console.log(DRY ? "[dry-run] Done." : "Back-End org seeded.");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

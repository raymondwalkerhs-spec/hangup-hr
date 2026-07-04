#!/usr/bin/env node
/**
 * Repair backend teams stuck on HS-1 / HS-MGMT — upsert org_teams and relocate to HS-Back-End.
 * Usage: node scripts/repair-backend-teams.js [--dry-run] [--teams Office,HR,Quality]
 */
require("dotenv").config();

const DEFAULT_BACKEND_TEAMS = [
  "Office",
  "HR",
  "Quality",
  "RTM",
  "Finance",
  "Back-End",
  "Admins",
  "Daemon",
  "IT",
];

function parseTeamsArg() {
  const idx = process.argv.indexOf("--teams");
  if (idx >= 0 && process.argv[idx + 1]) {
    return process.argv[idx + 1].split(",").map((s) => s.trim()).filter(Boolean);
  }
  return DEFAULT_BACKEND_TEAMS;
}

async function main() {
  const DRY = process.argv.includes("--dry-run");
  const teamNames = parseTeamsArg();
  const orgHierarchy = require("../lib/org-hierarchy");
  const hrms = require("../lib/hrms-repo");
  const { normalizeTeamName } = require("../lib/team-names");
  const targetUnit = orgHierarchy.BACKEND_UNIT;

  const allTeams = await hrms.readOrgTeams();
  const byNorm = new Map(allTeams.map((t) => [normalizeTeamName(t.name), t]));

  for (const name of teamNames) {
    const norm = normalizeTeamName(name);
    let team = byNorm.get(norm);
    if (!team) {
      console.log(`Create org_teams row "${name}" → ${targetUnit}`);
      if (!DRY) {
        team = await hrms.createOrgTeam({
          name,
          unit: targetUnit,
          dialsSales: false,
          displayOrder: 50,
        });
        byNorm.set(norm, team);
      }
      continue;
    }
    if (team.unit === targetUnit && team.dialsSales === false) {
      console.log(`OK: "${team.name}" already on ${targetUnit}`);
      continue;
    }
    console.log(`Relocate "${team.name}" from ${team.unit || "?"} → ${targetUnit}`);
    if (!DRY) {
      const res = await hrms.relocateTeamToUnit(team.id, targetUnit, {
        reassignIds: false,
        username: "repair-backend-teams",
        dialsSales: false,
      });
      console.log(`  Updated ${(res.changes || []).length} employee(s)`);
    }
  }

  console.log(DRY ? "[dry-run] Done." : "Backend team repair complete.");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

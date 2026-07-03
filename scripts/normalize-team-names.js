#!/usr/bin/env node
/**
 * Normalize org_teams + employees.team: merge duplicates, strip "Team " prefix.
 * Usage: node scripts/normalize-team-names.js [--dry-run]
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");
const { normalizeTeamName } = require("../lib/team-names");

const DRY = process.argv.includes("--dry-run");

function pickKeeper(group) {
  return [...group].sort((a, b) => {
    const aNorm = normalizeTeamName(a.name);
    const bNorm = normalizeTeamName(b.name);
    if (aNorm === a.name && bNorm !== b.name) return -1;
    if (bNorm === b.name && aNorm !== a.name) return 1;
    if (a.unit && !b.unit) return -1;
    if (!a.unit && b.unit) return 1;
    return String(a.id).localeCompare(String(b.id));
  })[0];
}

async function main() {
  const db = getSupabaseAdmin();
  const { data: teams, error } = await db.from("org_teams").select("id,name,unit");
  if (error) throw error;

  const groups = new Map();
  for (const t of teams || []) {
    const unit = String(t.unit || "").trim();
    const norm = normalizeTeamName(t.name).toLowerCase();
    if (!norm) continue;
    const key = `${unit}|${norm}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  let renamedTeams = 0;
  let mergedTeams = 0;
  let employeesUpdated = 0;

  for (const [, group] of groups) {
    const canonical = normalizeTeamName(pickKeeper(group).name);
    const keeper = pickKeeper(group);
    if (keeper.name !== canonical && !DRY) {
      await db.from("org_teams").update({ name: canonical }).eq("id", keeper.id);
      renamedTeams += 1;
    }
    for (const t of group) {
      if (t.id === keeper.id) continue;
      const { data: emps } = await db.from("employees").select("id").eq("team", t.name);
      if (emps?.length && !DRY) {
        await db.from("employees").update({ team: canonical }).eq("team", t.name);
        employeesUpdated += emps.length;
      }
      if (!DRY) {
        await db.from("org_teams").delete().eq("id", t.id);
      }
      mergedTeams += 1;
      console.log(`Merge team "${t.name}" → "${canonical}"`);
    }
    const { data: variantEmps } = await db.from("employees").select("id,team").ilike("team", `%${canonical}%`);
    for (const e of variantEmps || []) {
      const norm = normalizeTeamName(e.team);
      if (norm && norm !== e.team && !DRY) {
        await db.from("employees").update({ team: canonical }).eq("id", e.id);
        employeesUpdated += 1;
      }
    }
  }

  const { data: sales } = await db.from("sales").select("id,team,form_data");
  let salesUpdated = 0;
  for (const s of sales || []) {
    const norm = normalizeTeamName(s.team);
    if (!norm || norm === s.team) continue;
    const fd = s.form_data && typeof s.form_data === "object" ? { ...s.form_data } : {};
    fd.team = norm;
    if (!DRY) {
      await db.from("sales").update({ team: norm, form_data: fd }).eq("id", s.id);
    }
    salesUpdated += 1;
  }

  console.log(
    DRY ? "[dry-run] " : "",
    `Done. Renamed ${renamedTeams}, merged ${mergedTeams} duplicate team(s), updated ${employeesUpdated} employees, ${salesUpdated} sales.`
  );
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Merge case-insensitive duplicate org_teams and normalize employees.team.
 *
 * Usage: node scripts/dedupe-teams.js
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");

function pickKeeper(group) {
  return [...group].sort((a, b) => {
    const aUnit = String(a.unit || "").trim();
    const bUnit = String(b.unit || "").trim();
    if (aUnit && !bUnit) return -1;
    if (!aUnit && bUnit) return 1;
    if (a.name.length !== b.name.length) return a.name.length - b.name.length;
    return String(a.id).localeCompare(String(b.id));
  })[0];
}

async function main() {
  const db = getSupabaseAdmin();
  const { data: teams, error } = await db.from("org_teams").select("id,name,unit");
  if (error) throw error;

  const groups = new Map();
  for (const t of teams || []) {
    const key = String(t.name || "").trim().toLowerCase();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  let merged = 0;
  let employeesUpdated = 0;

  for (const [, group] of groups) {
    if (group.length < 2) continue;
    const keeper = pickKeeper(group);
    const dupes = group.filter((t) => t.id !== keeper.id);
    for (const dupe of dupes) {
      const { data: emps, error: empErr } = await db
        .from("employees")
        .select("id")
        .eq("team", dupe.name);
      if (empErr) throw empErr;
      if (emps?.length) {
        const { error: updErr } = await db
          .from("employees")
          .update({ team: keeper.name })
          .eq("team", dupe.name);
        if (updErr) throw updErr;
        employeesUpdated += emps.length;
      }
      const { error: delErr } = await db.from("org_teams").delete().eq("id", dupe.id);
      if (delErr) throw delErr;
      merged += 1;
      console.log(`Merged "${dupe.name}" → "${keeper.name}"`);
    }
  }

  console.log(`Done. Merged ${merged} duplicate team(s); updated ${employeesUpdated} employee row(s).`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Publish version policy to Supabase app_versions.
 *
 * Usage:
 *   node scripts/publish-app-version.js
 *   node scripts/publish-app-version.js --field-breaking
 *   node scripts/publish-app-version.js --breaking
 *   node scripts/publish-app-version.js --version 1.0.8-beta.1 --notes "..."
 *
 * --field-breaking  → force HR/Quality/field roles to update (force_update_min_version = package version)
 * --breaking        → block ALL roles below package version (min_compatible_version = package version)
 * default (minor)   → warn only; min_compatible stays unless --min-compatible is passed
 */
require("dotenv").config();

const { getAppVersion } = require("../lib/app-version");
const { getSupabaseAdmin } = require("../lib/supabase-client");

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    version: getAppVersion(),
    notes: "",
    breaking: false,
    fieldBreaking: false,
    minCompatible: null,
    forceFieldMin: null,
    dryRun: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--breaking") opts.breaking = true;
    else if (a === "--field-breaking") opts.fieldBreaking = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--version" && args[i + 1]) opts.version = args[++i];
    else if (a === "--notes" && args[i + 1]) opts.notes = args[++i];
    else if (a === "--min-compatible" && args[i + 1]) opts.minCompatible = args[++i];
    else if (a === "--force-field-min" && args[i + 1]) opts.forceFieldMin = args[++i];
  }
  if (!opts.notes) {
    opts.notes = `Hangup Portal ${opts.version} — install latest EXE from Admin`;
  }
  if (opts.breaking) {
    opts.minCompatible = opts.minCompatible || opts.version;
    opts.releaseType = "major";
  } else if (opts.fieldBreaking) {
    opts.forceFieldMin = opts.forceFieldMin || opts.version;
    opts.releaseType = "minor";
    opts.minCompatible = opts.minCompatible || "1.0.0";
  } else {
    opts.releaseType = "minor";
    opts.minCompatible = opts.minCompatible || "1.0.0";
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  const db = getSupabaseAdmin();

  const row = {
    version: opts.version,
    release_date: new Date().toISOString().slice(0, 10),
    release_type: opts.releaseType,
    min_compatible_version: opts.minCompatible,
    force_update_min_version: opts.forceFieldMin || null,
    is_current: true,
    notes: opts.notes,
  };

  console.log("Publishing app_versions policy:\n", JSON.stringify(row, null, 2));

  if (opts.dryRun) {
    console.log("\nDry run — no database changes.");
    return;
  }

  const { error: clearErr } = await db
    .from("app_versions")
    .update({ is_current: false })
    .eq("is_current", true);
  if (clearErr && !/force_update_min_version|column/.test(clearErr.message)) {
    throw new Error(`clear current: ${clearErr.message}`);
  }

  let insertPayload = { ...row };
  let { error: insErr } = await db.from("app_versions").upsert(insertPayload, { onConflict: "version" });
  if (insErr && /force_update_min_version/.test(insErr.message)) {
    delete insertPayload.force_update_min_version;
    if (opts.fieldBreaking) {
      insertPayload.min_compatible_version = opts.forceFieldMin || opts.version;
      insertPayload.release_type = "major";
      console.warn(
        "force_update_min_version column missing — using min_compatible_version",
        insertPayload.min_compatible_version,
        "for all roles. Apply migration 20260706_app_versions_force_update.sql for HR-only force."
      );
    }
    ({ error: insErr } = await db.from("app_versions").upsert(insertPayload, { onConflict: "version" }));
  }
  if (insErr) throw new Error(`upsert: ${insErr.message}`);

  const { data } = await db.from("app_versions").select("*").eq("is_current", true).maybeSingle();
  console.log("\nLive policy:", data);

  if (opts.breaking) {
    console.log("\n⚠ BREAKING: all users below", opts.version, "are blocked at login.");
  } else if (opts.fieldBreaking) {
    console.log(
      "\n⚠ FIELD BREAKING: HR, Quality, Agent, TL, OP, RTM below",
      opts.forceFieldMin,
      "are blocked. Admin/CEO/Finance get update warning only."
    );
  } else {
    console.log("\nMinor release: old apps get update warning; set --field-breaking or --breaking when needed.");
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

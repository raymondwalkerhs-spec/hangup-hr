#!/usr/bin/env node
/**
 * Apply employee internal_id migration via Supabase SQL (service role).
 * Usage: node scripts/apply-internal-id-migration.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error("Need SUPABASE_URL and SUPABASE_SECRET_KEY in .env");
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, "../supabase/migrations/20260706_employee_internal_id.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");

  const { getSupabaseAdmin } = require("../lib/supabase-client");
  const db = getSupabaseAdmin();
  const probe = await db.from("employees").select("internal_id").limit(1);
  if (!probe.error) {
    console.log("internal_id column already exists — skipping migration.");
    return;
  }

  const projectRef = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  if (!projectRef) throw new Error("Could not parse project ref from SUPABASE_URL");

  const endpoints = [
    `https://${projectRef}.supabase.co/pg/query`,
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
  ];

  let applied = false;
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ query: sql }),
      });
      if (res.ok) {
        applied = true;
        console.log("Migration applied via", endpoint);
        break;
      }
    } catch {
      /* try next */
    }
  }

  if (!applied) {
    console.error(
      "Could not apply migration automatically. Paste this file into Supabase Dashboard → SQL Editor:\n",
      sqlPath
    );
    process.exit(1);
  }

  const verify = await db.from("employees").select("internal_id").limit(1);
  if (verify.error) throw new Error(verify.error.message);
  console.log("Verified: employees.internal_id exists.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

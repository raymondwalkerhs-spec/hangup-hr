#!/usr/bin/env node
/**
 * Apply WFH working day fix migration via Supabase Management API.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const SQL_PATH = path.join(__dirname, "..", "supabase", "migrations", "20260721_v192_wfh_working_day_fix.sql");

async function main() {
  const sql = fs.readFileSync(SQL_PATH, "utf8");
  const projectRef = process.env.SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

  if (!projectRef || !accessToken) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_ACCESS_TOKEN in .env");
  }

  console.log(`Applying migration to project: ${projectRef}`);

  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Management API error ${res.status}: ${errText}`);
  }

  const result = await res.json();
  console.log("Migration applied successfully");
  console.log("Result:", JSON.stringify(result, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });

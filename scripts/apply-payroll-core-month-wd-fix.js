#!/usr/bin/env node
/**
 * Apply 20260813_payroll_core_month_working_days.sql via Supabase Management API.
 * Usage: node scripts/apply-payroll-core-month-wd-fix.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

async function runQuery(projectRef, token, query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 2000)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function main() {
  const url = process.env.SUPABASE_URL || "";
  const projectRef = (url.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i) || [])[1];
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!projectRef || !token) {
    throw new Error("Need SUPABASE_URL + SUPABASE_ACCESS_TOKEN in .env");
  }

  const sqlPath = path.join(
    __dirname,
    "../supabase/migrations/20260813_payroll_core_month_working_days.sql"
  );
  const sql = fs.readFileSync(sqlPath, "utf8");
  console.log("Applying", path.basename(sqlPath), "…");
  await runQuery(projectRef, token, sql);
  console.log("Applied OK");

  const smoke = await runQuery(
    projectRef,
    token,
    `
    SELECT daily_rate, working_days, monthly_salary
    FROM calculate_payroll_core('2026-07', NULL, 22)
    WHERE monthly_salary = 12000 AND working_days = 10
    LIMIT 5;
    `
  );
  console.log("Smoke (12000 monthly / 10 att days should NOT yield daily_rate 1200):", smoke);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

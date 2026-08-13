#!/usr/bin/env node
/**
 * Apply 20260812_payroll_month_attendance_historical.sql via Supabase Management API.
 * Usage: node scripts/apply-payroll-month-attendance-fix.js
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
    "../supabase/migrations/20260812_payroll_month_attendance_historical.sql"
  );
  const sql = fs.readFileSync(sqlPath, "utf8");
  console.log("Applying payroll month attendance fix…");
  await runQuery(projectRef, token, sql);
  console.log("Migration applied.");

  const verify = await runQuery(
    projectRef,
    token,
    `
    SELECT
      (SELECT COUNT(*) FROM employee_month_attendance('2026-07')) AS july_rows,
      (SELECT COUNT(*) FROM employee_month_attendance('2026-07') v WHERE v.status NOT IN ('', 'OUT')) AS july_with_status,
      (SELECT COUNT(*) FROM calculate_payroll_core('2026-07') c WHERE c.working_days > 0) AS july_core_positive,
      (SELECT ROUND(COALESCE(SUM(c.transport_allowance), 0)::numeric, 2)
       FROM calculate_payroll_core('2026-07') c) AS july_transport_sum
    `
  );
  console.log("Verification:", verify);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

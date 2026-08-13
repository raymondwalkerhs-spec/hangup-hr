#!/usr/bin/env node
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const url = process.env.SUPABASE_URL || "";
const projectRef = (url.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i) || [])[1];
const token = process.env.SUPABASE_ACCESS_TOKEN;

async function q(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query }),
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${t.slice(0, 2500)}`);
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

async function main() {
  const sqlPath = path.join(__dirname, "../supabase/migrations/20260814_nsnc_three_day_penalty.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  console.log("Applying", path.basename(sqlPath), "...");
  await q(sql);
  console.log("Applied OK");

  const elena = await q(`
    SELECT working_days, nsnc, nsnc_half, daily_rate, basic_salary
    FROM calculate_payroll_core('2026-08', 'HS3-42', 21)
  `);
  console.log("Elena HS3-42 after:", JSON.stringify(elena, null, 2));

  const def = await q(`
    SELECT pg_get_functiondef(oid) AS def
    FROM pg_proc
    WHERE proname = 'calculate_payroll_core'
    LIMIT 1
  `);
  const s = String(def[0]?.def || "");
  const idx = s.indexOf("nsnc, 0) * 3");
  console.log("has nsnc * 3:", idx >= 0);
  if (idx >= 0) console.log(s.slice(idx - 180, idx + 80));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

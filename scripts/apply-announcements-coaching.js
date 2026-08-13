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
  if (!projectRef || !token) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_ACCESS_TOKEN");
  }
  const sqlPath = path.join(__dirname, "../supabase/migrations/20260814_announcements_and_coaching.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  console.log("Applying", path.basename(sqlPath), "...");
  await q(sql);
  console.log("Applied OK");

  const tables = await q(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('announcements', 'coaching_tickets')
    ORDER BY table_name
  `);
  console.log("tables:", tables);

  const cols = await q(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('announcements', 'coaching_tickets')
    ORDER BY table_name, ordinal_position
  `);
  console.log("columns:", cols);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

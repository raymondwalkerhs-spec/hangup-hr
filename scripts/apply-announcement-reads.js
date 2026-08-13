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
  const sqlPath = path.join(__dirname, "../supabase/migrations/20260816_announcement_reads.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  console.log("Applying", path.basename(sqlPath), "...");
  await q(sql);
  console.log("Applied OK");

  const table = await q(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'announcement_reads'
    ORDER BY ordinal_position
  `);
  console.log("columns:", table);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

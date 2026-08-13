#!/usr/bin/env node
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
  if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 800)}`);
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
  if (!projectRef || !token) throw new Error("Need SUPABASE_URL + SUPABASE_ACCESS_TOKEN");

  const before = await runQuery(
    projectRef,
    token,
    `SELECT c.relname AS table_name
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
     ORDER BY 1`
  );
  console.log("Before — tables without RLS:", Array.isArray(before) ? before.length : before);
  if (Array.isArray(before) && before.length) {
    console.log(before.map((r) => r.table_name).join(", "));
  }

  const sql = fs.readFileSync(
    path.join(__dirname, "../supabase/migrations/20260821_rls_enable_all_public.sql"),
    "utf8"
  );
  await runQuery(projectRef, token, sql);
  console.log("Applied 20260821_rls_enable_all_public.sql");

  const after = await runQuery(
    projectRef,
    token,
    `SELECT c.relname AS table_name
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
     ORDER BY 1`
  );
  console.log("After — tables without RLS:", Array.isArray(after) ? after.length : after);
  if (Array.isArray(after) && after.length) {
    console.log(after.map((r) => r.table_name).join(", "));
    process.exitCode = 1;
  } else {
    console.log("OK: all public tables have RLS enabled.");
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

#!/usr/bin/env node
/** Apply org registration + training migrations if tables missing. */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

async function runSql(sql) {
  const url = process.env.SUPABASE_URL || "";
  const ref = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!ref || !token) throw new Error("Need SUPABASE_URL + SUPABASE_ACCESS_TOKEN");
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text.slice(0, 500));
  return text;
}

async function main() {
  const { getSupabaseAdmin } = require("../lib/supabase-client");
  const db = getSupabaseAdmin();
  const probe = await db.from("agent_training_phases").select("id").limit(1);
  if (!probe.error) {
    console.log("Training tables already exist.");
    return;
  }
  const files = ["20260712_org_registration.sql", "20260713_agent_training_phases.sql"];
  for (const f of files) {
    const sql = fs.readFileSync(path.join(__dirname, "../supabase/migrations", f), "utf8");
    console.log(`Applying ${f}...`);
    await runSql(sql);
    console.log(`OK ${f}`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

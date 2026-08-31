#!/usr/bin/env node
/** Apply HS3-54 julia jason agent-picker force-include migration. */
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
    // Fallback: service-role update already applied via supabase-js in ship flow.
    const { getSupabaseAdmin } = require("../lib/supabase-client");
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("employees")
      .update({
        status: "Active",
        unit: "HS-3",
        team: "Justin",
        sales_mla_enabled: true,
        sales_rpm_enabled: true,
        sales_agent_picker: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", "HS3-54")
      .select("id, american_name, team, sales_agent_picker")
      .single();
    if (error) throw error;
    console.log("Applied via service role:", data);
    return;
  }
  const sqlPath = path.join(__dirname, "../supabase/migrations/20260814_force_julia_jason_agent_picker.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  console.log("Applying", path.basename(sqlPath), "...");
  await q(sql);
  const rows = await q(`
    SELECT id, american_name, status, team, unit, sales_agent_picker
    FROM employees WHERE id = 'HS3-54'
  `);
  console.log("HS3-54:", rows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

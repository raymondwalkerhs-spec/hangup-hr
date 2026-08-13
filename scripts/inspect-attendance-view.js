#!/usr/bin/env node
require("dotenv").config();

async function q(projectRef, token, query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query }),
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${t.slice(0, 1500)}`);
  return JSON.parse(t);
}

async function main() {
  const url = process.env.SUPABASE_URL || "";
  const projectRef = (url.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i) || [])[1];
  const token = process.env.SUPABASE_ACCESS_TOKEN;

  const def = await q(
    projectRef,
    token,
    "SELECT pg_get_viewdef('public.vw_employee_month_attendance'::regclass, true) AS def"
  );
  console.log("--- VIEW DEF (first 3000) ---\n", String(def[0]?.def || "").slice(0, 3000));

  const counts = await q(
    projectRef,
    token,
    `
    SELECT
      (SELECT count(*) FROM attendance_events WHERE date >= '2026-07-01' AND date <= '2026-07-31') AS att_july,
      (SELECT count(*) FROM vw_employee_month_attendance WHERE date >= DATE '2026-07-01' AND date < DATE '2026-08-01') AS view_july,
      (SELECT count(*) FROM vw_employee_month_attendance) AS view_all
    `
  );
  console.log("counts", counts);

  const sample = await q(
    projectRef,
    token,
    "SELECT employee_id, date, status FROM vw_employee_month_attendance ORDER BY date DESC LIMIT 5"
  );
  console.log("view sample", sample);

  const opts = await q(
    projectRef,
    token,
    `
    SELECT c.relname,
           COALESCE((SELECT option_value FROM pg_options_to_table(c.reloptions) WHERE option_name = 'security_invoker'), 'off') AS security_invoker
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='vw_employee_month_attendance'
    `
  );
  console.log("opts", opts);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env node
require("dotenv").config();

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
  if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 1000)}`);
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
    `
    SELECT c.relname AS view_name,
           COALESCE(
             (SELECT option_value FROM pg_options_to_table(c.reloptions)
              WHERE option_name = 'security_invoker'),
             'off'
           ) AS security_invoker
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
    ORDER BY 1
    `
  );
  console.log("Public views (security_invoker):");
  for (const row of before || []) {
    console.log(`  ${row.view_name}: ${row.security_invoker}`);
  }

  // Fix advisor finding: set SECURITY INVOKER on the flagged view (and any other public views).
  await runQuery(
    projectRef,
    token,
    `
    DO $$
    DECLARE
      v text;
    BEGIN
      FOR v IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'v'
      LOOP
        EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v);
      END LOOP;
    END $$;
    `
  );
  console.log("Applied security_invoker=true on all public views");

  const after = await runQuery(
    projectRef,
    token,
    `
    SELECT c.relname AS view_name,
           COALESCE(
             (SELECT option_value FROM pg_options_to_table(c.reloptions)
              WHERE option_name = 'security_invoker'),
             'off'
           ) AS security_invoker
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
    ORDER BY 1
    `
  );
  const stillDefiner = (after || []).filter((r) => String(r.security_invoker) !== "true");
  console.log("After:");
  for (const row of after || []) {
    console.log(`  ${row.view_name}: ${row.security_invoker}`);
  }
  if (stillDefiner.length) {
    console.error("Still SECURITY DEFINER:", stillDefiner.map((r) => r.view_name).join(", "));
    process.exitCode = 1;
  } else {
    console.log("OK: all public views use security_invoker.");
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

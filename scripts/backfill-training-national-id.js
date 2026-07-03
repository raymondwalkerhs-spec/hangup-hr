#!/usr/bin/env node
require("dotenv").config();

async function runSql(sql) {
  const url = process.env.SUPABASE_URL || "";
  const ref = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text.slice(0, 500));
}

async function main() {
  await runSql("UPDATE employees SET training_passed = true WHERE training_passed IS NOT TRUE;");
  await runSql(`
    UPDATE employees
    SET national_id = identification
    WHERE identification IS NOT NULL
      AND (national_id IS NULL OR national_id = '')
      AND lower(coalesce(nationality, '')) IN ('egyptian', 'egypt', 'egyptain');
  `);
  console.log("Bulk training_passed + national_id backfill done.");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

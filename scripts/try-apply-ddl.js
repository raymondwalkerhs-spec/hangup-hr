#!/usr/bin/env node
/** Try all known Supabase DDL auth paths, then apply pending migrations. */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

async function tryEndpoint(label, url, headers, body) {
  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    const text = await res.text();
    return { label, ok: res.ok, status: res.status, text: text.slice(0, 200) };
  } catch (err) {
    return { label, ok: false, status: 0, text: err.message };
  }
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const token = process.env.SUPABASE_ACCESS_TOKEN || "";
  const ref = url?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  if (!ref || !key) {
    console.error("Need SUPABASE_URL and SUPABASE_SECRET_KEY");
    process.exit(1);
  }

  const sql = fs.readFileSync(
    path.join(__dirname, "../supabase/migrations/20260708_finance_hr_attendance.sql"),
    "utf8"
  );

  const attempts = [];
  if (token) {
    attempts.push(
      await tryEndpoint(
        "mgmt-query",
        `https://api.supabase.com/v1/projects/${ref}/database/query`,
        { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        { query: sql }
      )
    );
    attempts.push(
      await tryEndpoint(
        "mgmt-migration",
        `https://api.supabase.com/v1/projects/${ref}/database/migrations`,
        { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        { name: "finance_hr_attendance", query: sql }
      )
    );
  }
  attempts.push(
    await tryEndpoint(
      "legacy-pg",
      `https://${ref}.supabase.co/pg/query`,
      { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      { query: sql }
    )
  );

  for (const a of attempts) {
    console.log(a.label, a.status, a.ok ? "OK" : a.text);
    if (a.ok) {
      console.log("Migration applied via", a.label);
      return;
    }
  }
  console.error("All DDL endpoints failed. Run: npm run apply:migrations (needs SUPABASE_ACCESS_TOKEN)");
  process.exit(1);
}

main();

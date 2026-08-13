/**
 * Apply v2.2.0 schema pieces needed for registration password + expense categories.
 * Usage: node scripts/apply-v220-schema.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getSupabaseAdmin } = require("../lib/supabase-client");

const FILES = [
  "20260801_v220_password_changed_at.sql",
  "20260801_v220_expense_category.sql",
  "20260801_v220_registration_password_hash.sql",
];

async function loadAccessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  const home = process.env.USERPROFILE || process.env.HOME;
  for (const name of [".supabase/access-token", ".supabase/access_token"]) {
    try {
      const p = path.join(home, name);
      if (fs.existsSync(p)) {
        const t = fs.readFileSync(p, "utf8").trim();
        if (t) return t;
      }
    } catch {
      /* next */
    }
  }
  return "";
}

async function runViaManagementApi(projectRef, accessToken, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Management API ${res.status}: ${text}`);
  return "Management API";
}

async function runViaPg(projectRef, password, sql) {
  const { Client } = require("pg");
  const hosts = [
    `db.${projectRef}.supabase.co`,
    `aws-0-eu-central-1.pooler.supabase.com`,
    `aws-0-us-east-1.pooler.supabase.com`,
  ];
  let lastErr;
  for (const host of hosts) {
    const client = new Client({
      host,
      port: host.includes("pooler") ? 6543 : 5432,
      database: "postgres",
      user: host.includes("pooler") ? `postgres.${projectRef}` : "postgres",
      password,
      ssl: { rejectUnauthorized: false },
    });
    try {
      await client.connect();
      await client.query(sql);
      await client.end();
      return `Postgres (${host})`;
    } catch (err) {
      lastErr = err;
      try {
        await client.end();
      } catch {
        /* ignore */
      }
    }
  }
  throw lastErr;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error("SUPABASE_URL required");
  const projectRef = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  if (!projectRef) throw new Error("Bad SUPABASE_URL");

  const dir = path.join(__dirname, "../supabase/migrations");
  const sql = FILES.map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n\n");
  console.log("Applying:", FILES.join(", "));

  const token = await loadAccessToken();
  let via;
  if (token) via = await runViaManagementApi(projectRef, token, sql);
  else if (process.env.SUPABASE_DB_PASSWORD) {
    via = await runViaPg(projectRef, process.env.SUPABASE_DB_PASSWORD, sql);
  } else {
    throw new Error("Set SUPABASE_ACCESS_TOKEN or SUPABASE_DB_PASSWORD");
  }
  console.log("Applied via", via);

  const db = getSupabaseAdmin();
  const checks = [
    ["app_users.password_changed_at", () => db.from("app_users").select("password_changed_at").limit(1)],
    ["expense_requests.category", () => db.from("expense_requests").select("category").limit(1)],
    [
      "agent_registration_requests.password_hash",
      () => db.from("agent_registration_requests").select("password_hash").limit(1),
    ],
  ];
  for (const [label, fn] of checks) {
    const { error } = await fn();
    console.log(label, error ? `FAIL: ${error.message}` : "ok");
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

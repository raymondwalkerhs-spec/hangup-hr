#!/usr/bin/env node
/**
 * Deploy Supabase → Airtable RPM sync (Edge Function + DB trigger).
 *
 *   node scripts/deploy-airtable-rpm-sync.js
 *
 * Requires SUPABASE_URL, SUPABASE_SECRET_KEY, AIRTABLE_API_KEY, AIRTABLE_RPM_BASE_ID in .env
 * and supabase login (or SUPABASE_ACCESS_TOKEN) to deploy the function.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");

function requireEnv(name) {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`Missing ${name} in .env`);
  return v;
}

async function loadAccessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) return "";
  for (const name of ["access-token", "access_token"]) {
    const p = path.join(home, ".supabase", name);
    if (fs.existsSync(p)) {
      const token = fs.readFileSync(p, "utf8").trim();
      if (token) return token;
    }
  }
  return "";
}

async function managementQuery(projectRef, token, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Management API ${res.status}: ${body.slice(0, 800)}`);
  }
  return res.json();
}

async function putSecrets(projectRef, token, secrets) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/secrets`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(secrets),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Secrets API ${res.status}: ${body.slice(0, 800)}`);
  }
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function main() {
  const url = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SECRET_KEY");
  const airtableKey = String(process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PAT || "").trim();
  const rpmBase = requireEnv("AIRTABLE_RPM_BASE_ID");
  if (!airtableKey) throw new Error("Missing AIRTABLE_API_KEY in .env");

  const projectRef = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  if (!projectRef) throw new Error("Could not parse project ref from SUPABASE_URL");

  const accessToken = await loadAccessToken();
  if (!accessToken) {
    throw new Error("Run `npx supabase login` or set SUPABASE_ACCESS_TOKEN");
  }

  console.log("Setting Edge Function secrets…");
  await putSecrets(projectRef, accessToken, [
    { name: "AIRTABLE_API_KEY", value: airtableKey },
    { name: "AIRTABLE_RPM_BASE_ID", value: rpmBase },
    { name: "AIRTABLE_RPM_SYNC_SECRET", value: serviceKey },
  ]);

  console.log("Deploying function airtable-rpm-sync…");
  const deploy = spawnSync(
    "npx",
    [
      "--yes",
      "supabase@latest",
      "functions",
      "deploy",
      "airtable-rpm-sync",
      "--project-ref",
      projectRef,
      "--no-verify-jwt",
    ],
    { cwd: ROOT, stdio: "inherit", shell: true }
  );
  if (deploy.status !== 0) {
    throw new Error("supabase functions deploy failed");
  }

  const migration = fs.readFileSync(
    path.join(ROOT, "supabase/migrations/20260902_airtable_rpm_supabase_sync.sql"),
    "utf8"
  );
  console.log("Applying trigger migration…");
  await managementQuery(projectRef, accessToken, migration);

  const catchup = fs.readFileSync(
    path.join(ROOT, "supabase/migrations/20260903_airtable_rpm_catchup_cron.sql"),
    "utf8"
  );
  console.log("Applying catch-up cron (optional if pg_cron is unavailable)…");
  try {
    await managementQuery(projectRef, accessToken, catchup);
  } catch (err) {
    console.warn("Catch-up cron skipped:", err.message || err);
  }

  const functionUrl = `${url.replace(/\/$/, "")}/functions/v1/airtable-rpm-sync`;
  const authHeader = `Bearer ${serviceKey}`;
  console.log("Writing trigger config…");
  await managementQuery(
    projectRef,
    accessToken,
    `INSERT INTO public._internal_airtable_rpm_config (id, function_url, auth_header, updated_at)
     VALUES (1, ${sqlLiteral(functionUrl)}, ${sqlLiteral(authHeader)}, now())
     ON CONFLICT (id) DO UPDATE SET
       function_url = EXCLUDED.function_url,
       auth_header = EXCLUDED.auth_header,
       updated_at = now();`
  );

  console.log("Checking function health…");
  const health = await fetch(functionUrl);
  const healthText = await health.text();
  if (!health.ok) {
    throw new Error(`Function GET ${health.status}: ${healthText.slice(0, 300)}`);
  }

  console.log(`Done. Supabase will POST ${functionUrl} on rpm_sales / rpm_checks / rpm_sales_attachments changes.`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Deploy Supabase → Google Form RPM1 sync (Edge Function + INSERT trigger).
 *
 *   node scripts/deploy-rpm-google-form-sync.js
 *
 * Env: SUPABASE_URL, SUPABASE_SECRET_KEY
 * Optional: GOOGLE_FORM_RESPONSE_URL, GOOGLE_FORM_ENTRIES_JSON
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  DEFAULT_FORM_RESPONSE_URL,
  DEFAULT_ENTRIES,
} = require("../lib/rpm-google-form");

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
  const formUrl = String(process.env.GOOGLE_FORM_RESPONSE_URL || DEFAULT_FORM_RESPONSE_URL).trim();
  const entriesJson = String(process.env.GOOGLE_FORM_ENTRIES_JSON || JSON.stringify(DEFAULT_ENTRIES)).trim();
  const {
    DEFAULT_FORM_TARGETS,
  } = require("../lib/rpm-google-form");
  const targetsJson = String(
    process.env.GOOGLE_FORM_TARGETS_JSON || JSON.stringify(DEFAULT_FORM_TARGETS)
  ).trim();

  const projectRef = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  if (!projectRef) throw new Error("Could not parse project ref from SUPABASE_URL");

  const accessToken = await loadAccessToken();
  if (!accessToken) {
    throw new Error("Run `npx supabase login` or set SUPABASE_ACCESS_TOKEN");
  }

  console.log("Setting Edge Function secrets…");
  await putSecrets(projectRef, accessToken, [
    { name: "RPM_GOOGLE_FORM_SYNC_SECRET", value: serviceKey },
    { name: "GOOGLE_FORM_TARGETS_JSON", value: targetsJson },
    // Legacy single-form secrets kept for compatibility
    { name: "GOOGLE_FORM_RESPONSE_URL", value: formUrl },
    { name: "GOOGLE_FORM_ENTRIES_JSON", value: entriesJson },
  ]);

  console.log("Deploying function rpm-google-form-sync…");
  const deploy = spawnSync(
    "npx",
    [
      "--yes",
      "supabase@latest",
      "functions",
      "deploy",
      "rpm-google-form-sync",
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
    path.join(ROOT, "supabase/migrations/20260906_rpm_google_form_sync.sql"),
    "utf8"
  );
  console.log("Applying Google Form sync migration…");
  await managementQuery(projectRef, accessToken, migration);

  const functionUrl = `${url.replace(/\/$/, "")}/functions/v1/rpm-google-form-sync`;
  const authHeader = `Bearer ${serviceKey}`;
  console.log("Writing trigger config…");
  await managementQuery(
    projectRef,
    accessToken,
    `INSERT INTO public._internal_rpm_google_form_config (id, function_url, auth_header, updated_at)
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

  console.log(`Done. New RPM1 inserts will POST ${functionUrl}`);
  const targets = JSON.parse(targetsJson);
  console.log(`Forms (${targets.length}):`);
  for (const t of targets) {
    console.log(`  - ${t.id}: ${t.url}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

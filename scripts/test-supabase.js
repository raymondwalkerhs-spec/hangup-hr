#!/usr/bin/env node
/**
 * Quick Supabase connectivity check (no secrets printed).
 * Usage: node scripts/test-supabase.js
 */
require("dotenv").config();

const {
  isSupabaseConfigured,
  hasSupabaseAdminKey,
  getSupabaseAnon,
  getSupabaseAdmin,
} = require("../lib/supabase-client");

async function main() {
  console.log("Supabase setup check\n");

  if (!process.env.SUPABASE_URL) {
    console.error("Missing SUPABASE_URL in .env");
    process.exit(1);
  }
  console.log("URL:", process.env.SUPABASE_URL);

  if (!process.env.SUPABASE_PUBLISHABLE_KEY) {
    console.warn("WARN: SUPABASE_PUBLISHABLE_KEY not set");
  } else {
    console.log("Publishable key: set");
  }

  if (!hasSupabaseAdminKey()) {
    console.warn(
      "WARN: SUPABASE_SECRET_KEY not set — admin routes will fail until you add it from the dashboard"
    );
  } else {
    console.log("Secret key: set");
    try {
      const admin = getSupabaseAdmin();
      const { error } = await admin.auth.getSession();
      console.log("Admin client:", error ? `error — ${error.message}` : "ok");
    } catch (err) {
      console.error("Admin client failed:", err.message);
    }
  }

  if (isSupabaseConfigured()) {
    try {
      const anon = getSupabaseAnon();
      const { error } = await anon.auth.getSession();
      console.log("Anon client:", error ? `error — ${error.message}` : "ok");
    } catch (err) {
      console.error("Anon client failed:", err.message);
    }
  }

  console.log("\nAPI routes:");
  console.log("  GET /api/supabase/config   — public config (no secrets)");
  console.log("  GET /api/supabase/status   — env + client probe");
  console.log("  GET /api/supabase/ping     — needs apikey header (publishable)");
  console.log("  GET /api/supabase/health   — needs apikey header (secret)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

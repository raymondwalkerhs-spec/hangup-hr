const express = require("express");
const {
  isSupabaseConfigured,
  hasSupabaseAdminKey,
  getSupabasePublicConfig,
  getSupabaseAdmin,
  getSupabaseAnon,
} = require("../lib/supabase-client");
const { withSupabase } = require("../lib/supabase-express");

const router = express.Router();

/** Public — no auth. Reports whether Supabase env is wired. */
router.get("/config", (_req, res) => {
  res.json(getSupabasePublicConfig());
});

/** Publishable-key gate — anonymous client, RLS applies. */
router.get(
  "/ping",
  withSupabase({ auth: "publishable" }),
  async (req, res) => {
    res.json({
      ok: true,
      authMode: req.supabaseContext?.authMode,
      message: "Supabase publishable key accepted",
    });
  }
);

/** Secret-key gate — admin client can bypass RLS. */
router.get(
  "/health",
  withSupabase({ auth: "secret" }),
  async (req, res) => {
    let dbOk = null;
    let dbError = null;

    try {
      const { error } = await req.supabaseAdmin.from("todos").select("id").limit(1);
      if (error) {
        dbOk = false;
        dbError = error.message;
      } else {
        dbOk = true;
      }
    } catch (err) {
      dbOk = false;
      dbError = err.message;
    }

    res.json({
      ok: true,
      authMode: req.supabaseContext?.authMode,
      database: dbOk === null ? "not_checked" : dbOk ? "reachable" : "error",
      databaseError: dbError,
      configured: isSupabaseConfigured(),
      adminReady: hasSupabaseAdminKey(),
    });
  }
);

/** Direct admin probe without withSupabase (uses env secret key). */
router.get("/status", async (_req, res) => {
  if (!isSupabaseConfigured()) {
    return res.json({
      configured: false,
      message: "Set SUPABASE_URL and keys in .env — see .env.example",
    });
  }

  const out = {
    configured: true,
    adminReady: hasSupabaseAdminKey(),
    url: process.env.SUPABASE_URL,
    publishableKeySet: Boolean(
      process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY
    ),
    secretKeySet: hasSupabaseAdminKey(),
    adminPing: null,
    anonPing: null,
  };

  if (hasSupabaseAdminKey()) {
    try {
      const admin = getSupabaseAdmin();
      const { error } = await admin.auth.getSession();
      out.adminPing = error ? { ok: false, error: error.message } : { ok: true };
    } catch (err) {
      out.adminPing = { ok: false, error: err.message };
    }
  }

  try {
    const anon = getSupabaseAnon();
    const { error } = await anon.auth.getSession();
    out.anonPing = error ? { ok: false, error: error.message } : { ok: true };
  } catch (err) {
    out.anonPing = { ok: false, error: err.message };
  }

  res.json(out);
});

module.exports = router;

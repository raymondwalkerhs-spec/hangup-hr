/**
 * Supabase server clients for Hangup HR (Express / Electron).
 *
 * Uses @supabase/supabase-js directly (CommonJS-safe). The secret key stays
 * server-side only; never bundle it in the desktop UI.
 */
const { createClient } = require("@supabase/supabase-js");

let WebSocketImpl = null;
try {
  WebSocketImpl = require("ws");
} catch {
  /* optional — Node 22+ has global WebSocket */
}

let adminClient = null;
let anonClient = null;

function getSupabaseUrl() {
  return process.env.SUPABASE_URL || "";
}

function getSecretKey() {
  return (
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEYS ||
    ""
  );
}

function getPublishableKey() {
  return (
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEYS ||
    ""
  );
}

function getSupabaseEnv() {
  const url = getSupabaseUrl();
  const secretKey = getSecretKey();
  const publishableKey = getPublishableKey();
  if (!url) {
    return { data: null, error: new Error("SUPABASE_URL is not set") };
  }
  if (!secretKey && !publishableKey) {
    return { data: null, error: new Error("Supabase API keys are not set") };
  }
  return { data: { url, secretKey, publishableKey }, error: null };
}

function isSupabaseConfigured() {
  const url = getSupabaseUrl();
  const secret = getSecretKey();
  const publishable = getPublishableKey();
  return Boolean(url && (secret || publishable));
}

function hasSupabaseAdminKey() {
  return Boolean(
    process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      (process.env.SUPABASE_SECRET_KEYS && process.env.SUPABASE_SECRET_KEYS !== "{}")
  );
}

function buildClientOptions(extra = {}) {
  const realtime = {};
  const ws = WebSocketImpl || globalThis.WebSocket;
  if (ws) realtime.transport = ws;
  return {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime,
    ...extra,
  };
}

/** Admin client — bypasses RLS. Server-side only. */
function getSupabaseAdmin() {
  if (!hasSupabaseAdminKey()) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not set. Add it from Supabase Dashboard → Project Settings → API."
    );
  }
  if (!adminClient) {
    adminClient = createClient(getSupabaseUrl(), getSecretKey(), buildClientOptions());
  }
  return adminClient;
}

/** Anonymous / publishable client — RLS applies. */
function getSupabaseAnon() {
  if (!anonClient) {
    anonClient = createClient(getSupabaseUrl(), getPublishableKey(), buildClientOptions());
  }
  return anonClient;
}

/** User-scoped client when you have a Supabase Auth JWT. */
function getSupabaseForUser(accessToken) {
  if (!accessToken) {
    throw new Error("Supabase user token is required");
  }
  return createClient(getSupabaseUrl(), getPublishableKey(), buildClientOptions({
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  }));
}

function getSupabasePublicConfig() {
  return {
    url: process.env.SUPABASE_URL || null,
    publishableKey:
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      null,
    configured: isSupabaseConfigured(),
    adminReady: hasSupabaseAdminKey(),
  };
}

module.exports = {
  getSupabaseEnv,
  isSupabaseConfigured,
  hasSupabaseAdminKey,
  getSupabaseAdmin,
  getSupabaseAnon,
  getSupabaseForUser,
  getSupabasePublicConfig,
};

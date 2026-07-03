/**
 * Per-user permission overrides (exception access).
 */

const catalog = require("./permission-catalog");

const CACHE_TTL_MS = 60_000;
let cache = { loadedAt: 0, overrides: new Map() };
let loadPromise = null;

function overrideKey(username, permissionKey) {
  return `${String(username || "").trim().toLowerCase()}::${permissionKey}`;
}

async function loadOverrides(force = false) {
  const now = Date.now();
  if (!force && now - cache.loadedAt < CACHE_TTL_MS && cache.loadedAt > 0) {
    return cache.overrides;
  }
  if (loadPromise && !force) return loadPromise;
  loadPromise = (async () => {
    const map = new Map();
    try {
      const { getSupabaseAdmin } = require("./supabase-client");
      const { data, error } = await getSupabaseAdmin()
        .from("app_user_permissions")
        .select("username, permission_key, allowed");
      if (error) {
        if (/does not exist|relation/i.test(error.message || "")) {
          cache = { loadedAt: Date.now(), overrides: map };
          return map;
        }
        throw error;
      }
      for (const row of data || []) {
        map.set(overrideKey(row.username, row.permission_key), Boolean(row.allowed));
      }
    } catch (err) {
      console.warn("[user-permissions] load failed:", err.message || err);
    }
    cache = { loadedAt: Date.now(), overrides: map };
    return map;
  })();
  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

function invalidateCache() {
  cache = { loadedAt: 0, overrides: new Map() };
  loadPromise = null;
}

function getOverrideSync(username, permissionKey) {
  if (!username) return undefined;
  return cache.overrides.get(overrideKey(username, permissionKey));
}

function hasAnyOverride(username) {
  const u = String(username || "").trim().toLowerCase();
  if (!u) return false;
  for (const k of cache.overrides.keys()) {
    if (k.startsWith(`${u}::`)) return true;
  }
  return false;
}

async function listForUser(username) {
  await loadOverrides(true);
  const u = String(username || "").trim().toLowerCase();
  const rows = [];
  for (const [k, allowed] of cache.overrides.entries()) {
    const [user, permissionKey] = k.split("::");
    if (user === u) rows.push({ permissionKey, allowed });
  }
  return rows.sort((a, b) => a.permissionKey.localeCompare(b.permissionKey));
}

async function saveForUser(username, entries, updatedBy) {
  const { getSupabaseAdmin } = require("./supabase-client");
  const db = getSupabaseAdmin();
  const name = String(username || "").trim().toLowerCase();
  if (!name) throw new Error("username required");

  const payload = (entries || [])
    .map((e) => ({
      username: name,
      permission_key: String(e.permissionKey || e.permission_key || "").trim(),
      allowed: Boolean(e.allowed),
      updated_at: new Date().toISOString(),
      updated_by: updatedBy || null,
    }))
    .filter((e) => e.permission_key && catalog.getPermission(e.permission_key));

  const { error: delErr } = await db.from("app_user_permissions").delete().eq("username", name);
  if (delErr) throw delErr;

  if (payload.length) {
    const { error } = await db.from("app_user_permissions").insert(payload);
    if (error) throw error;
  }
  invalidateCache();
  await loadOverrides(true);
  return { saved: payload.length };
}

async function clearForUser(username) {
  const { getSupabaseAdmin } = require("./supabase-client");
  const name = String(username || "").trim().toLowerCase();
  const { error } = await getSupabaseAdmin().from("app_user_permissions").delete().eq("username", name);
  if (error) throw error;
  invalidateCache();
  return { cleared: true };
}

module.exports = {
  loadOverrides,
  invalidateCache,
  getOverrideSync,
  hasAnyOverride,
  listForUser,
  saveForUser,
  clearForUser,
};

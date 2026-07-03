/**
 * DB-backed role permission overrides with in-memory cache.
 */

const catalog = require("./permission-catalog");

const CACHE_TTL_MS = 60_000;
let cache = { loadedAt: 0, overrides: new Map() };
let loadPromise = null;

function overrideKey(role, permissionKey) {
  return `${normalizeRole(role)}::${permissionKey}`;
}

function normalizeRole(role) {
  return catalog.MANAGEABLE_ROLES.includes(String(role || "").trim().toLowerCase())
    ? String(role || "").trim().toLowerCase()
    : String(role || "").trim().toLowerCase();
}

async function loadOverrides(force = false) {
  const now = Date.now();
  if (!force && now - cache.loadedAt < CACHE_TTL_MS && cache.loadedAt > 0) {
    return cache.overrides;
  }
  if (loadPromise && !force) {
    return loadPromise;
  }
  loadPromise = (async () => {
    const map = new Map();
    try {
      const { getSupabaseAdmin } = require("./supabase-client");
      const db = getSupabaseAdmin();
      const { data, error } = await db.from("app_role_permissions").select("role, permission_key, allowed");
      if (error) {
        if (/does not exist|relation/i.test(error.message || "")) {
          cache = { loadedAt: Date.now(), overrides: map };
          return map;
        }
        throw error;
      }
      for (const row of data || []) {
        map.set(overrideKey(row.role, row.permission_key), Boolean(row.allowed));
      }
    } catch (err) {
      console.warn("[role-permissions] load failed:", err.message || err);
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

function getCachedOverrides() {
  return cache.overrides;
}

function isAllowedSync(permissionKey, userRole, legacyDefaultFn) {
  const role = normalizeRole(userRole?.role);
  const hit = cache.overrides.get(overrideKey(role, permissionKey));
  if (hit !== undefined) return hit;
  if (typeof legacyDefaultFn === "function") return legacyDefaultFn(userRole);
  const defaults = catalog.defaultForRole(role, userRole);
  return Boolean(defaults[permissionKey]);
}

async function isAllowed(permissionKey, userRole, legacyDefaultFn) {
  await loadOverrides();
  return isAllowedSync(permissionKey, userRole, legacyDefaultFn);
}

async function listOverrides() {
  await loadOverrides(true);
  const rows = [];
  for (const [k, allowed] of cache.overrides.entries()) {
    const [role, permissionKey] = k.split("::");
    rows.push({ role, permissionKey, allowed });
  }
  return rows.sort((a, b) => a.role.localeCompare(b.role) || a.permissionKey.localeCompare(b.permissionKey));
}

async function saveOverrides(entries, updatedBy) {
  const { getSupabaseAdmin } = require("./supabase-client");
  const db = getSupabaseAdmin();
  const payload = (entries || []).map((e) => ({
    role: normalizeRole(e.role),
    permission_key: String(e.permissionKey || e.permission_key || "").trim(),
    allowed: Boolean(e.allowed),
    updated_at: new Date().toISOString(),
    updated_by: updatedBy || null,
  })).filter((e) => e.permission_key && catalog.getPermission(e.permission_key));

  if (!payload.length) return { saved: 0 };

  const { error } = await db.from("app_role_permissions").upsert(payload, { onConflict: "role,permission_key" });
  if (error) throw error;
  invalidateCache();
  await loadOverrides(true);
  return { saved: payload.length };
}

async function resetRole(role, permissionKeys) {
  const { getSupabaseAdmin } = require("./supabase-client");
  const db = getSupabaseAdmin();
  const r = normalizeRole(role);
  let q = db.from("app_role_permissions").delete().eq("role", r);
  if (permissionKeys?.length) {
    q = q.in("permission_key", permissionKeys);
  }
  const { error } = await q;
  if (error) throw error;
  invalidateCache();
  return { role: r, cleared: true };
}

async function getEffectiveMatrix() {
  await loadOverrides(true);
  const defaults = catalog.getDefaultMatrix();
  const effective = {};
  for (const role of catalog.MANAGEABLE_ROLES) {
    effective[role] = {};
    for (const perm of catalog.listPermissions()) {
      const override = cache.overrides.get(overrideKey(role, perm.key));
      effective[role][perm.key] = {
        default: defaults[role][perm.key],
        override: override !== undefined ? override : null,
        effective: override !== undefined ? override : defaults[role][perm.key],
      };
    }
  }
  return effective;
}

module.exports = {
  loadOverrides,
  invalidateCache,
  getCachedOverrides,
  isAllowed,
  isAllowedSync,
  listOverrides,
  saveOverrides,
  resetRole,
  getEffectiveMatrix,
};

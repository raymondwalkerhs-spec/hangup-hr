/**
 * DB-backed role permission overrides with in-memory cache.
 *
 * Overrides are scoped per company ("hangup" = Main Hangup, "hs2" = HS-2) so that,
 * for example, HR in Main Hangup can have different access control than HR in HS-2.
 * Defaults come from the permission catalog (shared across companies); only the
 * overrides differ per company.
 */

const catalog = require("./permission-catalog");

const CACHE_TTL_MS = 60_000;
let cache = { loadedAt: 0, overrides: new Map() };
let loadPromise = null;

function overrideKey(role, permissionKey, company) {
  return `${company}::${normalizeRole(role)}::${permissionKey}`;
}

function normalizeRole(role) {
  return require("./roles").normalizeRole(role);
}

function companyForContext(userRole) {
  if (userRole && userRole.company) return String(userRole.company).toLowerCase();
  try {
    return require("./company-context").getCompanyForUser(userRole);
  } catch {
    return "hangup";
  }
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
      const { data, error } = await db.from("app_role_permissions").select("company, role, permission_key, allowed");
      if (error) {
        if (/does not exist|relation/i.test(error.message || "")) {
          cache = { loadedAt: Date.now(), overrides: map };
          return map;
        }
        throw error;
      }
      for (const row of data || []) {
        const co = (row.company || "hangup").toLowerCase();
        map.set(overrideKey(row.role, row.permission_key, co), Boolean(row.allowed));
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

/** Test helper: skip DB overrides so legacy/catalog parity can be verified. */
function resetOverridesForTest() {
  cache = { loadedAt: Date.now(), overrides: new Map() };
  loadPromise = null;
}

function getCachedOverrides() {
  return cache.overrides;
}

function isAllowedSync(permissionKey, userRole, legacyDefaultFn) {
  const role = normalizeRole(userRole?.role);
  const company = companyForContext(userRole);
  const hit = cache.overrides.get(overrideKey(role, permissionKey, company));
  if (hit !== undefined) return hit;
  if (typeof legacyDefaultFn === "function") return legacyDefaultFn(userRole);
  const defaults = catalog.defaultForRole(role, userRole);
  return Boolean(defaults[permissionKey]);
}

async function isAllowed(permissionKey, userRole, legacyDefaultFn) {
  await loadOverrides();
  return isAllowedSync(permissionKey, userRole, legacyDefaultFn);
}

async function listOverrides(company) {
  await loadOverrides(true);
  const rows = [];
  for (const [k, allowed] of cache.overrides.entries()) {
    const [co, role, permissionKey] = k.split("::");
    if (company && co !== String(company).toLowerCase()) continue;
    rows.push({ company: co, role, permissionKey, allowed });
  }
  return rows.sort(
    (a, b) => a.company.localeCompare(b.company) || a.role.localeCompare(b.role) || a.permissionKey.localeCompare(b.permissionKey)
  );
}

async function saveOverrides(entries, updatedBy, company) {
  const { getSupabaseAdmin } = require("./supabase-client");
  const db = getSupabaseAdmin();
  const co = (company || "hangup").toLowerCase();
  const payload = (entries || []).map((e) => ({
    company: co,
    role: normalizeRole(e.role),
    permission_key: String(e.permissionKey || e.permission_key || "").trim(),
    allowed: Boolean(e.allowed),
    updated_at: new Date().toISOString(),
    updated_by: updatedBy || null,
  })).filter((e) => e.permission_key && catalog.getPermission(e.permission_key));

  if (!payload.length) return { saved: 0 };

  const { error } = await db
    .from("app_role_permissions")
    .upsert(payload, { onConflict: "company,role,permission_key" });
  if (error) throw error;
  invalidateCache();
  await loadOverrides(true);
  return { saved: payload.length };
}

async function resetRole(role, permissionKeys, company) {
  const { getSupabaseAdmin } = require("./supabase-client");
  const db = getSupabaseAdmin();
  const r = normalizeRole(role);
  const co = (company || "hangup").toLowerCase();
  let q = db.from("app_role_permissions").delete().eq("role", r).eq("company", co);
  if (permissionKeys?.length) {
    q = q.in("permission_key", permissionKeys);
  }
  const { error } = await q;
  if (error) throw error;
  invalidateCache();
  return { role: r, company: co, cleared: true };
}

async function getEffectiveMatrix(company) {
  await loadOverrides(true);
  const co = (company || "hangup").toLowerCase();
  const defaults = catalog.getDefaultMatrix();
  const effective = {};
  for (const role of catalog.MANAGEABLE_ROLES) {
    effective[role] = {};
    for (const perm of catalog.listPermissions()) {
      const override = cache.overrides.get(overrideKey(role, perm.key, co));
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
  resetOverridesForTest,
  getCachedOverrides,
  isAllowed,
  isAllowedSync,
  listOverrides,
  saveOverrides,
  resetRole,
  getEffectiveMatrix,
};

/**
 * Dynamic multi-company registry.
 * Replaces hard-coded HS-1/HS-3 → "Hang-Up", HS-2 → "HS-2 Company" distinction.
 * Each company gets its own access-control overrides via company_role_permissions.
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");

function db() {
  return getSupabaseAdmin();
}

function requireSupabase() {
  if (!useSupabase()) throw new Error("Requires DATA_BACKEND=supabase");
}

function mapCompany(r) {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    shortName: r.short_name || r.name,
    isDefault: r.is_default === true,
    active: r.active !== false,
    sortOrder: r.sort_order || 0,
    color: r.color || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    createdBy: r.created_by || "",
  };
}

function mapPermRow(r) {
  return {
    id: r.id,
    companySlug: r.company_slug,
    role: r.role,
    permissionKey: r.permission_key,
    allowed: r.allowed,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by || "",
  };
}

// ─── Companies CRUD ──────────────────────────────────────────────────────────

async function readCompanies({ activeOnly = false } = {}) {
  requireSupabase();
  let q = db().from("companies").select("*").order("sort_order").order("name");
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) {
    // Table may not exist on older installs — return seed defaults gracefully
    if (/does not exist|schema cache/i.test(error.message)) return defaultCompanies();
    throw new Error(error.message);
  }
  return (data || []).map(mapCompany);
}

function defaultCompanies() {
  return [
    { id: null, slug: "hangup", name: "Hang-Up", shortName: "Hang-Up", isDefault: true, active: true, sortOrder: 1, color: null, createdAt: null, updatedAt: null, createdBy: "" },
    { id: null, slug: "hs2",    name: "HS-2 Company", shortName: "HS-2",  isDefault: false, active: true, sortOrder: 2, color: null, createdAt: null, updatedAt: null, createdBy: "" },
  ];
}

async function getCompanyBySlug(slug) {
  requireSupabase();
  const { data, error } = await db().from("companies").select("*").eq("slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapCompany(data) : null;
}

async function createCompany({ slug, name, shortName, color, sortOrder, createdBy }) {
  requireSupabase();
  const s = String(slug || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  if (!s) throw new Error("slug required");
  if (!name) throw new Error("name required");
  const { data, error } = await db()
    .from("companies")
    .insert({
      slug: s,
      name,
      short_name: shortName || name,
      active: true,
      is_default: false,
      sort_order: Number(sortOrder) || 99,
      color: color || null,
      created_by: createdBy || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mapCompany(data);
}

async function updateCompany(slug, patch, actor) {
  requireSupabase();
  const row = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.shortName !== undefined) row.short_name = patch.shortName;
  if (patch.active !== undefined) row.active = Boolean(patch.active);
  if (patch.color !== undefined) row.color = patch.color || null;
  if (patch.sortOrder !== undefined) row.sort_order = Number(patch.sortOrder) || 0;
  const { data, error } = await db().from("companies").update(row).eq("slug", slug).select().single();
  if (error) throw new Error(error.message);
  return mapCompany(data);
}

// ─── Per-company role permission overrides ───────────────────────────────────

async function readCompanyPermissions(companySlug) {
  requireSupabase();
  const { data, error } = await db()
    .from("company_role_permissions")
    .select("*")
    .eq("company_slug", companySlug);
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return (data || []).map(mapPermRow);
}

async function upsertCompanyPermission(companySlug, role, permissionKey, allowed, actor) {
  requireSupabase();
  const { data, error } = await db()
    .from("company_role_permissions")
    .upsert({
      company_slug: companySlug,
      role,
      permission_key: permissionKey,
      allowed: Boolean(allowed),
      updated_at: new Date().toISOString(),
      updated_by: actor || null,
    }, { onConflict: "company_slug,role,permission_key" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mapPermRow(data);
}

async function deleteCompanyPermission(companySlug, role, permissionKey) {
  requireSupabase();
  const { error } = await db()
    .from("company_role_permissions")
    .delete()
    .eq("company_slug", companySlug)
    .eq("role", role)
    .eq("permission_key", permissionKey);
  if (error) throw new Error(error.message);
}

module.exports = {
  readCompanies,
  defaultCompanies,
  getCompanyBySlug,
  createCompany,
  updateCompany,
  readCompanyPermissions,
  upsertCompanyPermission,
  deleteCompanyPermission,
};

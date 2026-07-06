/**
 * Role-based sales form field access (MLA-Ray catalog + DB overrides).
 */
const business = require("./business-repo");
const catalog = require("./sales-field-catalog");

let permissionsCache = null;
let permissionsCacheAt = 0;
const CACHE_MS = 60_000;

async function loadPermissionsMap() {
  const now = Date.now();
  if (permissionsCache && now - permissionsCacheAt < CACHE_MS) return permissionsCache;
  const rows = await business.readSalesFieldPermissions();
  permissionsCache = Object.fromEntries(rows.map((r) => [r.fieldKey, r]));
  permissionsCacheAt = now;
  return permissionsCache;
}

function invalidatePermissionsCache() {
  permissionsCache = null;
  permissionsCacheAt = 0;
}

function roleKey(userRole) {
  return userRole?.role || "agent";
}

async function sanitizeIncomingFormData(formData, userRole, opts = {}) {
  const { create = false, sale = null, surface = "main", qualityTicket = false } = opts;
  const perms = await loadPermissionsMap();
  const resolvedSurface = qualityTicket ? "quality" : surface;
  const sanitized = catalog.sanitizeFormPayload(formData || {}, roleKey(userRole), perms, {
    create,
    user: userRole,
    sale,
    surface: resolvedSurface,
  });
  if (create && !sanitized.leadType) {
    sanitized.leadType = catalog.LEAD_TYPE_DEFAULT;
  }
  return sanitized;
}

function redactSaleForRole(sale, userRole, perms, opts = {}) {
  if (!sale) return sale;
  const role = roleKey(userRole);
  const surface = opts.surface || "main";
  const viewOpts = { user: userRole, sale, surface };
  const fd = catalog.filterFormDataForRole(sale.formData || {}, role, perms, viewOpts);
  const out = { ...sale, formData: fd };
  for (const field of catalog.FIELDS) {
    if (catalog.isSystemHiddenField(field)) {
      if (out.formData && out.formData[field.key] !== undefined) delete out.formData[field.key];
      continue;
    }
    if (!catalog.canViewFieldOnSurface(field, role, perms[field.key], surface, viewOpts)) {
      if (field.key === "phoneNumber") out.phoneNumber = sale.phoneNumber ? "***" : "";
      if (out.formData && out.formData[field.key] !== undefined) delete out.formData[field.key];
    }
  }
  return out;
}

async function redactSalesForRole(sales, userRole) {
  const perms = await loadPermissionsMap();
  return (sales || []).map((s) => redactSaleForRole(s, userRole, perms, { surface: "main" }));
}

function buildPayloadFromBody(body, sanitizedForm) {
  const fd = sanitizedForm || {};
  const fullName =
    body.fullName ||
    [fd.firstName, fd.lastName].filter(Boolean).join(" ").trim() ||
    fd.fullName ||
    "";
  return {
    phoneNumber: body.phoneNumber || fd.phoneNumber || "",
    fullName,
    device: body.device || fd.deviceType || "",
    price: body.price != null ? body.price : fd.price,
    client: body.client || fd.client || "",
    agentId: body.agentId,
    closerId: body.closerId,
    status: body.status || fd.status,
    submissionDate: body.submissionDate || fd.submissionDate,
    effectiveDate: body.effectiveDate || fd.effectiveDate,
    feedback: body.feedback || fd.feedback || "",
    formData: fd,
  };
}

module.exports = {
  loadPermissionsMap,
  invalidatePermissionsCache,
  sanitizeIncomingFormData,
  redactSalesForRole,
  redactSaleForRole,
  buildPayloadFromBody,
};

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

async function sanitizeIncomingFormData(formData, userRole, { create = false, sale = null } = {}) {
  const perms = await loadPermissionsMap();
  return catalog.sanitizeFormPayload(formData || {}, roleKey(userRole), perms, {
    create,
    user: userRole,
    sale,
  });
}

function redactSaleForRole(sale, userRole, perms) {
  if (!sale) return sale;
  const role = roleKey(userRole);
  const fd = catalog.filterFormDataForRole(sale.formData || {}, role, perms);
  const out = { ...sale, formData: fd };
  for (const field of catalog.FIELDS) {
    if (!catalog.canViewField(field, role, perms[field.key])) {
      if (field.key === "phoneNumber") out.phoneNumber = sale.phoneNumber ? "***" : "";
      if (field.key === "cardNumber" || field.key === "cvv") {
        /* kept in formData only */
      }
    }
  }
  if (!catalog.canViewField(catalog.getFieldDef("paymentMethod"), role, perms.paymentMethod)) {
    /* sensitive columns only in formData */
  }
  return out;
}

async function redactSalesForRole(sales, userRole) {
  const perms = await loadPermissionsMap();
  return (sales || []).map((s) => redactSaleForRole(s, userRole, perms));
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

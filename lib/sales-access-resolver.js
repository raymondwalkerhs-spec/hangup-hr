/**
 * Single source of truth for sales field + attachment access by surface.
 */
const catalog = require("./sales-field-catalog");

const {
  FIELDS,
  ATTACHMENT_KINDS,
  DEFAULT_VIEW,
  DEFAULT_EDIT,
  QUALITY_ROLES,
  PASSTHROUGH_KEYS,
  LEAD_TYPE_DEFAULT,
} = catalog;

function normalizeRole(role) {
  return String(role || "agent").trim().toLowerCase();
}

function roleInList(role, list) {
  const r = normalizeRole(role);
  return (list || []).map(normalizeRole).includes(r);
}

function getFieldDef(key) {
  return FIELDS.find((f) => f.key === key) || null;
}

function isSystemHiddenField(field) {
  return Boolean(field?.systemHidden) || field?.key === "leadType";
}

const QUALITY_ALWAYS_HIDDEN = new Set([
  "agentName",
  "closerName",
  "leadType",
  "client",
  "deviceType",
  "unit",
  "team",
  "price",
]);

/** Workflow fields excluded from new-sale submit form (unless approver sets status). */
const SUBMIT_EXCLUDED_KEYS = new Set([
  "verifierFeedback",
  "clientFeedback",
  "assignVerifier",
  "status",
  "agentName",
  "closerName",
  "leadType",
  "client",
  "deviceType",
  "unit",
  "team",
  "price",
]);

function isQualityAlwaysHidden(field, surface) {
  return surface === "quality" && field && QUALITY_ALWAYS_HIDDEN.has(field.key);
}

/** DB rows use snake_case; business-repo uses camelCase — accept both. */
function permRoles(dbPerm, snakeKey, camelKey) {
  if (!dbPerm) return null;
  const v = dbPerm[snakeKey] ?? dbPerm[camelKey];
  return Array.isArray(v) ? v : null;
}

function rolesFromPerm(dbPerm, snakeKey, camelKey, fallback) {
  const fromDb = permRoles(dbPerm, snakeKey, camelKey);
  return fromDb?.length ? fromDb : fallback;
}

function rolesForSurface(dbPerm, field, surface) {
  if (surface === "main") {
    const main = permRoles(dbPerm, "main_view_roles", "mainViewRoles") || permRoles(dbPerm, "view_roles", "viewRoles");
    return main?.length ? main : field.viewRoles || DEFAULT_VIEW;
  }
  if (surface === "quality") {
    if (isQualityAlwaysHidden(field, surface)) return [];
    const q = permRoles(dbPerm, "quality_view_roles", "qualityViewRoles");
    if (q?.length) return q;
    if (field.section === "quality") return field.viewRoles || QUALITY_ROLES;
    return [];
  }
  if (surface === "edit") {
    const edit = permRoles(dbPerm, "edit_roles", "editRoles");
    return edit?.length ? edit : field.editRoles || DEFAULT_EDIT;
  }
  const viewRoles = permRoles(dbPerm, "view_roles", "viewRoles");
  return viewRoles?.length ? viewRoles : field.viewRoles || DEFAULT_VIEW;
}

function canEditVerifierFeedback(user, sale, dbPerm = null) {
  const field = getFieldDef("verifierFeedback");
  if (!field) return false;
  const role = normalizeRole(user?.role);
  const editRoles = rolesFromPerm(dbPerm, "edit_roles", "editRoles", field.editRoles || []);
  if (["admin", "ceo", "rtm"].includes(role)) return true;
  if (role === "quality" && roleInList(role, editRoles)) return true;
  const assignVerifier = sale?.formData?.assignVerifier || sale?.assignVerifier;
  const isAssignee =
    assignVerifier && user?.employeeId && String(user.employeeId) === String(assignVerifier);
  if (["op", "tl"].includes(role)) {
    return isAssignee && roleInList(role, editRoles);
  }
  return roleInList(role, editRoles);
}

function canEditClientFeedback(user, dbPerm = null) {
  const field = getFieldDef("clientFeedback");
  if (!field) return false;
  const editRoles = rolesFromPerm(dbPerm, "edit_roles", "editRoles", field.editRoles || ["admin", "ceo", "rtm"]);
  return roleInList(user?.role, editRoles);
}

function canViewVerifierFeedbackOnQuality(role, dbPerm, opts = {}) {
  const r = normalizeRole(role);
  if (!["op", "tl"].includes(r) || !opts.user || !opts.sale) return false;
  const q = permRoles(dbPerm, "quality_view_roles", "qualityViewRoles");
  if (q?.length && roleInList(r, q)) return true;
  return canEditVerifierFeedback(opts.user, opts.sale, dbPerm);
}

function canViewFieldOnSurface(field, role, dbPerm = null, surface = "main", opts = {}) {
  if (!field || isSystemHiddenField(field) || isQualityAlwaysHidden(field, surface)) return false;
  const r = normalizeRole(role);
  if (
    field.key === "verifierFeedback" &&
    surface === "quality" &&
    ["op", "tl"].includes(r) &&
    opts.user &&
    opts.sale
  ) {
    return canViewVerifierFeedbackOnQuality(r, dbPerm, opts);
  }
  if (!roleInList(r, rolesForSurface(dbPerm, field, surface))) return false;
  return true;
}

function canEditFieldOnSurface(field, role, dbPerm = null, surface = "main", opts = {}) {
  if (!field || isSystemHiddenField(field) || isQualityAlwaysHidden(field, surface)) return false;
  if (!canViewFieldOnSurface(field, role, dbPerm, surface, opts)) return false;
  const editRoles = rolesFromPerm(dbPerm, "edit_roles", "editRoles", field.editRoles || DEFAULT_EDIT);
  let canEdit = roleInList(role, editRoles);
  if (field.key === "verifierFeedback" && opts.user && opts.sale) {
    canEdit = canEditVerifierFeedback(opts.user, opts.sale, dbPerm);
  } else if (field.key === "clientFeedback" && opts.user) {
    canEdit = canEditClientFeedback(opts.user, dbPerm);
  }
  return canEdit;
}

function mapFieldForRole(field, role, dbPerm = null, opts = {}) {
  const surface = opts.surface || "main";
  return {
    ...field,
    canView: canViewFieldOnSurface(field, role, dbPerm, surface, opts),
    canEdit: canEditFieldOnSurface(field, role, dbPerm, surface, opts),
  };
}

function filterFormDataForRole(formData, role, permissionsMap = {}, opts = {}) {
  const surface = opts.surface || "main";
  const out = {};
  for (const field of FIELDS) {
    if (isSystemHiddenField(field)) continue;
    const perm = permissionsMap[field.key];
    if (!canViewFieldOnSurface(field, role, perm, surface, opts)) continue;
    if (formData[field.key] != null && formData[field.key] !== "") {
      out[field.key] = formData[field.key];
    }
  }
  for (const key of PASSTHROUGH_KEYS) {
    if (formData[key] != null && formData[key] !== "") out[key] = formData[key];
  }
  return out;
}

function sanitizeFormPayload(formData, role, permissionsMap = {}, opts = {}) {
  const { create = false, user = null, sale = null } = opts;
  const surface = opts.surface || "main";
  const out = create ? {} : { ...(sale?.formData || {}) };
  for (const field of FIELDS) {
    if (isSystemHiddenField(field)) continue;
    if (create && SUBMIT_EXCLUDED_KEYS.has(field.key)) continue;
    if (create) {
      if (formData[field.key] !== undefined) out[field.key] = formData[field.key];
      continue;
    }
    const perm = permissionsMap[field.key];
    const canEdit = canEditFieldOnSurface(field, role, perm, surface, { user, sale });
    if (!canEdit) continue;
    if (formData[field.key] !== undefined) {
      out[field.key] = formData[field.key];
    }
  }
  for (const key of PASSTHROUGH_KEYS) {
    if (formData[key] !== undefined) out[key] = formData[key];
  }
  return out;
}

function listFieldsForSubmit(role, opts = {}) {
  const r = normalizeRole(role);
  const includeStatus = opts.canApproveStatus === true;
  return FIELDS.filter((f) => {
    if (isSystemHiddenField(f) || f.hideOnCreate) return false;
    if (f.section === "quality") return false;
    if (SUBMIT_EXCLUDED_KEYS.has(f.key)) {
      if (f.key === "status" && includeStatus) return true;
      return false;
    }
    return true;
  }).map((f) => ({
    ...f,
    canView: true,
    canEdit: true,
  }));
}

function listAttachmentKindsForSubmit(role) {
  const r = normalizeRole(role);
  return ATTACHMENT_KINDS.map((kindDef) => {
    const editRoles = kindDef.editRoles || [];
    const viewRoles = kindDef.viewRoles || [];
    const canEdit = roleInList(r, editRoles);
    const canView = canEdit || roleInList(r, viewRoles);
    return {
      key: kindDef.key,
      label: kindDef.label,
      viewRoles,
      editRoles,
      canView,
      canEdit,
    };
  }).filter((k) => k.canEdit);
}

function listFieldsForRole(role, permissionsMap = {}, opts = {}) {
  const surface = opts.surface || "main";
  return FIELDS.filter(
    (f) => !isSystemHiddenField(f) && canViewFieldOnSurface(f, role, permissionsMap[f.key], surface, opts)
  ).map((f) => mapFieldForRole(f, role, permissionsMap[f.key], { ...opts, surface }));
}

function listFieldsForRoleOnSurface(role, permissionsMap = {}, surface = "quality", opts = {}) {
  return listFieldsForRole(role, permissionsMap, { ...opts, surface });
}

function resolveAttachmentKind(kindDef, role, attachPerm = null, opts = {}) {
  const surface = opts.surface || "main";
  const r = normalizeRole(role);
  if (surface === "quality" && ["op", "tl"].includes(r) && opts.user && opts.sale) {
    const assignVerifier = opts.sale?.formData?.assignVerifier || opts.sale?.assignVerifier;
    const isAssignee =
      assignVerifier && opts.user?.employeeId && String(opts.user.employeeId) === String(assignVerifier);
    if (isAssignee) {
      return { key: kindDef.key, label: kindDef.label, canView: false, canEdit: false };
    }
  }
  const viewRoles = attachPerm?.viewRoles || attachPerm?.view_roles || kindDef.viewRoles || [];
  const editRoles = attachPerm?.editRoles || attachPerm?.edit_roles || kindDef.editRoles || [];
  return {
    key: kindDef.key,
    label: attachPerm?.label || kindDef.label,
    viewRoles,
    editRoles,
    canView: roleInList(role, viewRoles),
    canEdit: roleInList(role, editRoles),
  };
}

function listAttachmentKindsForRole(role, attachPermMap = {}, catalogKinds = ATTACHMENT_KINDS, opts = {}) {
  return catalogKinds
    .map((k) => resolveAttachmentKind(k, role, attachPermMap[k.key], opts))
    .filter((k) => k.canView);
}

function canViewAttachmentKind(kind, role, attachPermMap = {}) {
  const def = ATTACHMENT_KINDS.find((x) => x.key === kind);
  if (!def) return true;
  const perm = attachPermMap[kind];
  const viewRoles = perm?.viewRoles || perm?.view_roles || def.viewRoles || [];
  return roleInList(role, viewRoles);
}

function canEditAttachmentKind(kind, role, attachPermMap = {}) {
  const def = ATTACHMENT_KINDS.find((x) => x.key === kind);
  if (!def) return false;
  const perm = attachPermMap[kind];
  const editRoles = perm?.editRoles || perm?.edit_roles || def.editRoles || [];
  return roleInList(role, editRoles);
}

function getDefaultFieldPermissions(field) {
  const viewRoles = field.viewRoles || DEFAULT_VIEW;
  const editRoles = field.editRoles || DEFAULT_EDIT;
  const qualityRoles = field.section === "quality" ? field.viewRoles || QUALITY_ROLES : [];
  return {
    viewRoles,
    editRoles,
    mainViewRoles: viewRoles,
    qualityViewRoles: qualityRoles,
  };
}

module.exports = {
  QUALITY_ALWAYS_HIDDEN,
  SUBMIT_EXCLUDED_KEYS,
  rolesForSurface,
  canViewFieldOnSurface,
  canEditFieldOnSurface,
  canEditVerifierFeedback,
  canEditClientFeedback,
  mapFieldForRole,
  filterFormDataForRole,
  sanitizeFormPayload,
  listFieldsForRole,
  listFieldsForRoleOnSurface,
  listFieldsForSubmit,
  listAttachmentKindsForSubmit,
  resolveAttachmentKind,
  listAttachmentKindsForRole,
  canViewAttachmentKind,
  canEditAttachmentKind,
  getDefaultFieldPermissions,
  LEAD_TYPE_DEFAULT,
};

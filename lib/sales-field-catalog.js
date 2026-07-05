/**
 * MLA-Ray sales form field catalog (from Asset/MLA-Ray status View copy.csv)
 */

const US_STATES = require("./us-states");

const ROLE_GROUPS = {
  agent: ["agent"],
  tl: ["tl", "op"],
  op: ["tl", "op"],
  quality: ["quality"],
  rtm: ["rtm"],
  admin: ["admin", "hr", "finance", "ceo"],
};

const DEFAULT_VIEW = ["agent", "tl", "op", "quality", "rtm", "admin", "hr", "finance", "ceo"];
const DEFAULT_EDIT = ["agent", "tl", "op", "admin", "hr"];
const ADMIN_ONLY = ["admin", "finance", "ceo"];
const ADMIN_RTM_VIEW = ["admin", "finance", "ceo", "rtm"];
const SUBMIT_EDIT = ["agent", "tl", "op", "admin", "hr"];
const HR_ROLES = ["hr"];
const QUALITY_ROLES = ["quality", "rtm", "admin", "ceo", "public_relations"];
const STATUS_VIEW = ["op", "quality", "rtm", "admin", "hr", "finance", "ceo"];
const STATUS_EDIT = ["op", "admin", "hr", "quality", "rtm"];

const PAYMENT_CARD_KEYS = new Set(["cardType", "cardNumber", "cardExpDate", "cvv"]);
const PAYMENT_BANK_KEYS = new Set(["routingNumber", "bankName", "bankAccountNumber", "bankAddress", "bankAccountChosenBy"]);

// Catalog reference IDs stored alongside form fields; must survive sanitize/redact
// so the edit modal can preselect client/product/price dropdowns.
const PASSTHROUGH_KEYS = ["salesClientId", "salesProductId", "salesPriceId"];

const VERIFIER_FEEDBACK_OPTIONS = [
  "Sale done",
  "Postdated",
  "Pending bank approval",
  "On hold",
  "Rejected",
  "Callback",
];

const CLIENT_FEEDBACK_OPTIONS = [
  "Passed",
  "Dropped",
  "Chargeback",
  "Duplicate",
  "Retransfer",
  "Pending bank approval",
  "Processed",
];

const FIELDS = [
  { key: "submissionDate", label: "Submission Date", section: "lead", type: "datetime" },
  { key: "leadType", label: "Lead Type", section: "lead", type: "text", defaultValue: "MLA Lead" },
  { key: "client", label: "Client", section: "lead", type: "text", hideOnCreate: true, hideOnEdit: true },
  { key: "unit", label: "Unit", section: "lead", type: "text", hideOnCreate: true, hideOnEdit: true },
  { key: "team", label: "Team", section: "lead", type: "text", hideOnCreate: true, hideOnEdit: true },
  { key: "agentName", label: "Agent Name", section: "lead", type: "text", hideOnEdit: true, hideOnCreate: true },
  { key: "closerName", label: "Closer Name", section: "lead", type: "text", hideOnEdit: true, hideOnCreate: true },
  {
    key: "deviceType",
    label: "Device Type",
    section: "lead",
    type: "select",
    options: ["bracelet", "necklace", "smartwatch"],
    hideOnCreate: true,
    hideOnEdit: true,
  },
  {
    key: "firstTimeDevice",
    label: "First time getting a device?",
    section: "lead",
    type: "select",
    options: ["Yes", "No"],
    selectPlaceholder: true,
  },
  { key: "serviceActiveInfo", label: "If no, service active / company", section: "lead", type: "text" },
  { key: "phoneNumber", label: "Phone Number", section: "client", type: "tel", required: true },
  { key: "firstName", label: "First Name", section: "client", type: "text", required: true },
  { key: "lastName", label: "Last Name", section: "client", type: "text", required: true },
  { key: "dateOfBirth", label: "Date Of Birth", section: "client", type: "date" },
  { key: "streetAddress", label: "Street Address", section: "client", type: "text" },
  { key: "cityName", label: "City", section: "client", type: "text" },
  {
    key: "state",
    label: "State",
    section: "client",
    type: "select",
    options: US_STATES,
    selectPlaceholder: true,
  },
  { key: "zipCode", label: "Zip code", section: "client", type: "text" },
  { key: "emergencyFirstName", label: "Emergency contact first name", section: "emergency", type: "text" },
  { key: "emergencyLastName", label: "Emergency contact last name", section: "emergency", type: "text" },
  { key: "emergencyPhone", label: "Emergency contact phone", section: "emergency", type: "tel" },
  { key: "emergencyRelation", label: "Emergency contact relation", section: "emergency", type: "text" },
  {
    key: "paymentMethod",
    label: "Payment method",
    section: "payment",
    type: "select",
    options: ["Bank account", "Card"],
    selectPlaceholder: true,
    sensitive: true,
    viewRoles: ADMIN_RTM_VIEW,
    editRoles: SUBMIT_EDIT,
  },
  {
    key: "cardType",
    label: "Card Type",
    section: "payment",
    type: "text",
    sensitive: true,
    cardField: true,
    viewRoles: ADMIN_RTM_VIEW,
    editRoles: SUBMIT_EDIT,
  },
  {
    key: "cardExpDate",
    label: "Card Exp Date",
    section: "payment",
    type: "text",
    sensitive: true,
    cardField: true,
    viewRoles: ADMIN_RTM_VIEW,
    editRoles: SUBMIT_EDIT,
  },
  {
    key: "cvv",
    label: "CVV",
    section: "payment",
    type: "text",
    sensitive: true,
    cardField: true,
    viewRoles: ADMIN_RTM_VIEW,
    editRoles: SUBMIT_EDIT,
  },
  {
    key: "cardNumber",
    label: "Card Number",
    section: "payment",
    type: "text",
    sensitive: true,
    cardField: true,
    viewRoles: ADMIN_RTM_VIEW,
    editRoles: SUBMIT_EDIT,
  },
  {
    key: "billingDate",
    label: "Billing Date (If Postponed)",
    section: "payment",
    type: "date",
    sensitive: true,
    viewRoles: ADMIN_RTM_VIEW,
    editRoles: ADMIN_ONLY,
  },
  {
    key: "routingNumber",
    label: "Routing number",
    section: "payment",
    type: "text",
    bankField: true,
    sensitive: true,
    viewRoles: ADMIN_RTM_VIEW,
    editRoles: SUBMIT_EDIT,
  },
  {
    key: "bankName",
    label: "Bank name",
    section: "payment",
    type: "text",
    bankField: true,
    sensitive: true,
    viewRoles: ADMIN_RTM_VIEW,
    editRoles: SUBMIT_EDIT,
  },
  {
    key: "bankAccountNumber",
    label: "Bank account number",
    section: "payment",
    type: "text",
    bankField: true,
    sensitive: true,
    viewRoles: ADMIN_RTM_VIEW,
    editRoles: SUBMIT_EDIT,
  },
  {
    key: "bankAddress",
    label: "Bank address",
    section: "payment",
    type: "text",
    bankField: true,
    sensitive: true,
    viewRoles: ADMIN_RTM_VIEW,
    editRoles: SUBMIT_EDIT,
  },
  {
    key: "bankAccountChosenBy",
    label: "Who chose bank account",
    section: "payment",
    type: "employee",
    employeeFilter: "all",
    bankField: true,
    sensitive: true,
    viewRoles: ADMIN_RTM_VIEW,
    editRoles: SUBMIT_EDIT,
  },
  { key: "notes", label: "Notes", section: "general", type: "textarea" },
  {
    key: "clientFeedback",
    label: "Client status",
    section: "general",
    type: "select",
    options: CLIENT_FEEDBACK_OPTIONS,
    selectPlaceholder: true,
    viewRoles: [...ADMIN_RTM_VIEW, "hr"],
    editRoles: ["admin", "ceo", "rtm"],
  },
  { key: "reviewer", label: "Reviewer", section: "quality", type: "employee", employeeFilter: "reviewers", viewRoles: QUALITY_ROLES, editRoles: QUALITY_ROLES },
  { key: "qualityComments", label: "Quality Comments", section: "quality", type: "textarea", viewRoles: QUALITY_ROLES, editRoles: QUALITY_ROLES },
  { key: "payerName", label: "Payer Name", section: "client", type: "text" },
  { key: "medicalConditions", label: "Medical Conditions?", section: "client", type: "text" },
  { key: "chargeAmount", label: "Charge Amount (Monthly)", section: "payment", type: "text" },
  { key: "monthlyBillingDate", label: "Monthly Billing Date", section: "payment", type: "text" },
  { key: "alternativePhone", label: "Alternative Phone", section: "client", type: "tel" },
  { key: "assignVerifier", label: "Assign Verifier", section: "quality", type: "employee", employeeFilter: "verifiers", viewRoles: QUALITY_ROLES, editRoles: QUALITY_ROLES },
  {
    key: "verifierFeedback",
    label: "Reviewer status",
    section: "quality",
    type: "select",
    options: VERIFIER_FEEDBACK_OPTIONS,
    selectPlaceholder: true,
    viewRoles: QUALITY_ROLES,
    editRoles: ["quality", "rtm", "admin", "ceo", "op", "tl"],
  },
  { key: "price", label: "Price", section: "lead", type: "number", hideOnCreate: true, hideOnEdit: true },
  { key: "effectiveDate", label: "Effective date", section: "lead", type: "date" },
  {
    key: "status",
    label: "Workflow status",
    section: "lead",
    type: "select",
    options: ["passed", "pending", "postdated", "denied", "callback"],
    viewRoles: STATUS_VIEW,
    editRoles: STATUS_EDIT,
    hideOnCreate: true,
    hideOnEdit: true,
    hideInList: true,
  },
  { key: "feedback", label: "Feedback", section: "general", type: "text", viewRoles: DEFAULT_VIEW, editRoles: ["tl", "op", "admin", "hr", "quality", "rtm"] },
];

const ATTACHMENT_KINDS = [
  { key: "recording", label: "Recordings", viewRoles: [...DEFAULT_VIEW, "quality"], editRoles: ["agent", "tl", "op", "admin", "hr"] },
  { key: "raw_call", label: "Raw call record", viewRoles: QUALITY_ROLES, editRoles: QUALITY_ROLES },
  { key: "quality_record", label: "Quality Record", viewRoles: QUALITY_ROLES, editRoles: QUALITY_ROLES },
  { key: "receipt", label: "Receipt Attachment", viewRoles: [...DEFAULT_VIEW, "quality", "rtm"], editRoles: ["agent", "tl", "op", "admin", "hr", "quality", "rtm"] },
  { key: "confirmation", label: "Confirmation", viewRoles: [...DEFAULT_VIEW, "quality"], editRoles: ["agent", "tl", "op", "admin", "hr"] },
];

function listAttachmentKindsForRole(role) {
  return ATTACHMENT_KINDS.map((k) => ({
    key: k.key,
    label: k.label,
    viewRoles: k.viewRoles,
    editRoles: k.editRoles,
    canView: roleInList(role, k.viewRoles),
    canEdit: roleInList(role, k.editRoles),
  })).filter((k) => k.canView);
}

function canViewAttachmentKind(kind, role) {
  const k = ATTACHMENT_KINDS.find((x) => x.key === kind);
  if (!k) return true;
  return roleInList(role, k.viewRoles);
}

function canEditAttachmentKind(kind, role) {
  const k = ATTACHMENT_KINDS.find((x) => x.key === kind);
  if (!k) return false;
  return roleInList(role, k.editRoles);
}

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

function getDefaultPermissions(field) {
  const viewRoles = field.viewRoles || DEFAULT_VIEW;
  const editRoles = field.editRoles || DEFAULT_EDIT;
  const qualityRoles = field.viewRoles?.length && field.section === "quality" ? field.viewRoles : QUALITY_ROLES;
  return {
    viewRoles,
    editRoles,
    mainViewRoles: viewRoles,
    qualityViewRoles: field.section === "quality" ? qualityRoles : viewRoles,
  };
}

function rolesForSurface(dbPerm, field, surface) {
  if (surface === "main") {
    const main = dbPerm?.main_view_roles?.length ? dbPerm.main_view_roles : dbPerm?.view_roles;
    return main?.length ? main : field.viewRoles || DEFAULT_VIEW;
  }
  if (surface === "quality") {
    const q = dbPerm?.quality_view_roles?.length ? dbPerm.quality_view_roles : null;
    if (q?.length) return q;
    if (field.section === "quality") return field.viewRoles || QUALITY_ROLES;
    return field.viewRoles || DEFAULT_VIEW;
  }
  if (surface === "edit") {
    const edit = dbPerm?.edit_roles?.length ? dbPerm.edit_roles : field.editRoles || DEFAULT_EDIT;
    return edit;
  }
  const viewRoles = dbPerm?.view_roles || field.viewRoles || DEFAULT_VIEW;
  return viewRoles;
}

function canViewFieldForSurface(field, role, dbPerm = null, surface = "main") {
  const editRoles = dbPerm?.edit_roles || field.editRoles || DEFAULT_EDIT;
  if (surface !== "edit" && roleInList(role, editRoles)) return true;
  return roleInList(role, rolesForSurface(dbPerm, field, surface));
}

function canEditField(field, role, dbPerm = null) {
  const editRoles = dbPerm?.edit_roles || field.editRoles || DEFAULT_EDIT;
  return roleInList(role, editRoles);
}

function enrichFieldCanEdit(field, role, dbPerm = null, { user = null, sale = null } = {}) {
  let canEdit = canEditField(field, role, dbPerm);
  if (field.key === "verifierFeedback" && user && sale) {
    canEdit = canEditVerifierFeedback(user, sale, dbPerm);
  } else if (field.key === "clientFeedback" && user) {
    canEdit = canEditClientFeedback(user, dbPerm);
  }
  return canEdit;
}

function mapFieldForRole(field, role, dbPerm = null, opts = {}) {
  return {
    ...field,
    canEdit: enrichFieldCanEdit(field, role, dbPerm, opts),
  };
}

function canViewField(field, role, dbPerm = null) {
  return canViewFieldForSurface(field, role, dbPerm, "main") || canEditField(field, role, dbPerm);
}

function filterFormDataForRole(formData, role, permissionsMap = {}) {
  const out = {};
  for (const field of FIELDS) {
    const perm = permissionsMap[field.key];
    if (!canViewField(field, role, perm)) {
      if (field.sensitive) continue;
      continue;
    }
    if (formData[field.key] != null && formData[field.key] !== "") {
      out[field.key] = formData[field.key];
    }
  }
  for (const key of PASSTHROUGH_KEYS) {
    if (formData[key] != null && formData[key] !== "") out[key] = formData[key];
  }
  return out;
}

function sanitizeFormPayload(formData, role, permissionsMap = {}, { create = false, user = null, sale = null } = {}) {
  const out = {};
  for (const field of FIELDS) {
    const perm = permissionsMap[field.key];
    let canEdit = canEditField(field, role, perm);
    if (field.key === "verifierFeedback" && user && sale) {
      canEdit = canEditVerifierFeedback(user, sale, perm);
    }
    if (field.key === "clientFeedback" && user) {
      canEdit = canEditClientFeedback(user, perm);
    }
    if (!canEdit && !create) continue;
    if (!canEdit && create && formData[field.key] == null) continue;
    if (formData[field.key] !== undefined) {
      out[field.key] = formData[field.key];
    }
  }
  for (const key of PASSTHROUGH_KEYS) {
    if (formData[key] !== undefined) out[key] = formData[key];
  }
  return out;
}

function listFieldsForRole(role, permissionsMap = {}, opts = {}) {
  return FIELDS.filter((f) => canViewField(f, role, permissionsMap[f.key])).map((f) =>
    mapFieldForRole(f, role, permissionsMap[f.key], opts)
  );
}

function listFieldsForRoleOnSurface(role, permissionsMap = {}, surface = "quality", opts = {}) {
  return FIELDS.filter((f) => {
    const perm = permissionsMap[f.key];
    if (canEditField(f, role, perm)) return true;
    return canViewFieldForSurface(f, role, perm, surface);
  }).map((f) => mapFieldForRole(f, role, permissionsMap[f.key], opts));
}

function listSections() {
  return [...new Set(FIELDS.map((f) => f.section))];
}

function listPaymentSubmitFields() {
  return FIELDS.filter(
    (f) =>
      f.section === "payment" &&
      (f.key === "paymentMethod" || f.cardField || f.bankField || PAYMENT_CARD_KEYS.has(f.key) || PAYMENT_BANK_KEYS.has(f.key))
  );
}

function canEditVerifierFeedback(user, sale, dbPerm = null) {
  const field = getFieldDef("verifierFeedback");
  if (!field) return false;
  const role = normalizeRole(user?.role);
  const editRoles = dbPerm?.edit_roles?.length ? dbPerm.edit_roles : field.editRoles || [];
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
  return roleInList(user?.role, dbPerm?.edit_roles || field.editRoles || ["admin", "ceo", "rtm"]);
}

async function seedDefaultPermissions(db) {
  for (let i = 0; i < FIELDS.length; i += 1) {
    const f = FIELDS[i];
    const perms = getDefaultPermissions(f);
    await db.from("sales_field_permissions").upsert(
      {
        field_key: f.key,
        label: f.label,
        section: f.section,
        sensitive: Boolean(f.sensitive),
        view_roles: perms.viewRoles,
        edit_roles: perms.editRoles,
        main_view_roles: perms.mainViewRoles,
        quality_view_roles: perms.qualityViewRoles,
        display_order: i,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "field_key" }
    );
  }
}

module.exports = {
  FIELDS,
  ATTACHMENT_KINDS,
  ROLE_GROUPS,
  PAYMENT_CARD_KEYS,
  PAYMENT_BANK_KEYS,
  VERIFIER_FEEDBACK_OPTIONS,
  CLIENT_FEEDBACK_OPTIONS,
  DEFAULT_VIEW,
  DEFAULT_EDIT,
  getFieldDef,
  canViewField,
  canViewFieldForSurface,
  canEditField,
  canEditVerifierFeedback,
  canEditClientFeedback,
  filterFormDataForRole,
  sanitizeFormPayload,
  listFieldsForRole,
  listFieldsForRoleOnSurface,
  mapFieldForRole,
  enrichFieldCanEdit,
  listPaymentSubmitFields,
  listAttachmentKindsForRole,
  canViewAttachmentKind,
  canEditAttachmentKind,
  listSections,
  seedDefaultPermissions,
  getDefaultPermissions,
};

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
const PAYMENT_BANK_KEYS = new Set(["routingNumber", "bankName", "bankAccountNumber", "bankAddress"]);
const LEAD_TYPE_DEFAULT = "MLA Lead";

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
  {
    key: "leadType",
    label: "Lead Type",
    section: "lead",
    type: "text",
    defaultValue: LEAD_TYPE_DEFAULT,
    systemHidden: true,
    viewRoles: [],
    editRoles: [],
  },
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
    required: true,
  },
  { key: "serviceActiveInfo", label: "If no, service active / company", section: "lead", type: "text" },
  { key: "phoneNumber", label: "Phone Number", section: "client", type: "tel", required: true },
  { key: "firstName", label: "First Name", section: "client", type: "text", required: true },
  { key: "lastName", label: "Last Name", section: "client", type: "text", required: true },
  { key: "dateOfBirth", label: "Date Of Birth", section: "client", type: "date", required: true },
  { key: "streetAddress", label: "Street Address", section: "client", type: "text", required: true },
  { key: "cityName", label: "City", section: "client", type: "text", required: true },
  {
    key: "state",
    label: "State",
    section: "client",
    type: "select",
    options: US_STATES,
    selectPlaceholder: true,
    required: true,
  },
  { key: "zipCode", label: "Zip code", section: "client", type: "text", required: true },
  { key: "emergencyFirstName", label: "Emergency contact first name", section: "emergency", type: "text", required: true },
  { key: "emergencyLastName", label: "Emergency contact last name", section: "emergency", type: "text", required: true },
  { key: "emergencyPhone", label: "Emergency contact phone", section: "emergency", type: "tel", required: true },
  { key: "emergencyRelation", label: "Emergency contact relation", section: "emergency", type: "text", required: true },
  {
    key: "paymentMethod",
    label: "Payment method",
    section: "payment",
    type: "select",
    options: ["Bank account", "Card"],
    selectPlaceholder: true,
    required: true,
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
  { key: "payerName", label: "Payer Name", section: "client", type: "text", required: true },
  {
    key: "medicalConditions",
    label: "Medical Conditions?",
    section: "client",
    type: "select",
    options: ["Yes", "No"],
    selectPlaceholder: true,
    required: true,
  },
  { key: "chargeAmount", label: "Charge Amount (Monthly)", section: "payment", type: "text" },
  { key: "monthlyBillingDate", label: "Monthly Billing Date", section: "payment", type: "date" },
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
  { key: "recording", label: "Recordings", viewRoles: ["agent", "tl", "quality", "rtm", "admin", "hr", "finance", "ceo"], editRoles: ["agent", "tl", "admin", "hr"] },
  { key: "raw_call", label: "Raw call record", viewRoles: QUALITY_ROLES, editRoles: QUALITY_ROLES },
  { key: "quality_record", label: "Quality Record", viewRoles: QUALITY_ROLES, editRoles: QUALITY_ROLES },
  { key: "receipt", label: "Receipt Attachment", viewRoles: [...DEFAULT_VIEW, "quality", "rtm"], editRoles: ["agent", "tl", "op", "admin", "hr", "quality", "rtm"] },
  { key: "confirmation", label: "Confirmation", viewRoles: [...DEFAULT_VIEW, "quality"], editRoles: ["agent", "tl", "op", "admin", "hr"] },
];

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
  return require("./sales-access-resolver").getDefaultFieldPermissions(field);
}

function isSystemHiddenField(field) {
  return Boolean(field?.systemHidden) || field?.key === "leadType";
}

function resolver() {
  return require("./sales-access-resolver");
}

function listAttachmentKindsForRole(role, opts = {}) {
  return resolver().listAttachmentKindsForRole(role, opts.attachPermMap || {}, ATTACHMENT_KINDS, opts);
}

function canViewAttachmentKind(kind, role, attachPermMap = {}) {
  return resolver().canViewAttachmentKind(kind, role, attachPermMap);
}

function canEditAttachmentKind(kind, role, attachPermMap = {}) {
  return resolver().canEditAttachmentKind(kind, role, attachPermMap);
}

function canViewFieldOnSurface(...args) {
  return resolver().canViewFieldOnSurface(...args);
}

function canViewFieldForSurface(...args) {
  return resolver().canViewFieldOnSurface(...args);
}

function canEditFieldOnSurface(...args) {
  return resolver().canEditFieldOnSurface(...args);
}

function canEditField(field, role, dbPerm = null) {
  const editRoles = dbPerm?.edit_roles || field.editRoles || DEFAULT_EDIT;
  return roleInList(role, editRoles);
}

function enrichFieldCanEdit(field, role, dbPerm = null, opts = {}) {
  return resolver().canEditFieldOnSurface(field, role, dbPerm, opts.surface || "main", opts);
}

function mapFieldForRole(...args) {
  return resolver().mapFieldForRole(...args);
}

function canViewField(...args) {
  return resolver().canViewFieldOnSurface(...args);
}

function filterFormDataForRole(...args) {
  return resolver().filterFormDataForRole(...args);
}

function sanitizeFormPayload(...args) {
  return resolver().sanitizeFormPayload(...args);
}

function listFieldsForRole(...args) {
  return resolver().listFieldsForRole(...args);
}

function listFieldsForRoleOnSurface(...args) {
  return resolver().listFieldsForRoleOnSurface(...args);
}

function listFieldsForSubmit(role, opts = {}) {
  return resolver().listFieldsForSubmit(role, opts);
}

function listAttachmentKindsForSubmit(role) {
  return resolver().listAttachmentKindsForSubmit(role);
}

function canEditVerifierFeedback(...args) {
  return resolver().canEditVerifierFeedback(...args);
}

function canEditClientFeedback(...args) {
  return resolver().canEditClientFeedback(...args);
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

async function seedDefaultPermissions(db) {
  for (let i = 0; i < FIELDS.length; i += 1) {
    const f = FIELDS[i];
    if (isSystemHiddenField(f)) continue;
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
  try {
    await db.from("sales_field_permissions").delete().eq("field_key", "bankAccountChosenBy");
  } catch {
    /* optional */
  }
  await require("./sales-attachment-permissions").seedDefaults();
}

module.exports = {
  FIELDS,
  ATTACHMENT_KINDS,
  ROLE_GROUPS,
  PAYMENT_CARD_KEYS,
  PAYMENT_BANK_KEYS,
  LEAD_TYPE_DEFAULT,
  PASSTHROUGH_KEYS,
  VERIFIER_FEEDBACK_OPTIONS,
  CLIENT_FEEDBACK_OPTIONS,
  DEFAULT_VIEW,
  DEFAULT_EDIT,
  getFieldDef,
  isSystemHiddenField,
  canViewField,
  canViewFieldForSurface,
  canViewFieldOnSurface,
  canEditField,
  canEditFieldOnSurface,
  canEditVerifierFeedback,
  canEditClientFeedback,
  filterFormDataForRole,
  sanitizeFormPayload,
  listFieldsForRole,
  listFieldsForRoleOnSurface,
  listFieldsForSubmit,
  listAttachmentKindsForSubmit,
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

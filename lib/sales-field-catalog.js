/**
 * MLA-Ray sales form field catalog (from Asset/MLA-Ray status View copy.csv)
 */

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
const HR_ROLES = ["hr"];
const QUALITY_ROLES = ["quality", "rtm", "admin", "ceo", "public_relations"];

const FIELDS = [
  { key: "submissionDate", label: "Submission Date", section: "lead", type: "datetime" },
  { key: "leadType", label: "Lead Type", section: "lead", type: "text", defaultValue: "MLA Lead" },
  { key: "client", label: "Client", section: "lead", type: "text" },
  { key: "unit", label: "Unit", section: "lead", type: "text" },
  { key: "team", label: "Team", section: "lead", type: "text" },
  { key: "agentName", label: "Agent Name", section: "lead", type: "text", hideOnEdit: true, hideOnCreate: true },
  { key: "closerName", label: "Closer Name", section: "lead", type: "text", hideOnEdit: true, hideOnCreate: true },
  { key: "deviceType", label: "Device Type", section: "lead", type: "select", options: ["bracelet", "necklace", "smartwatch"] },
  { key: "firstTimeDevice", label: "First time getting a device?", section: "lead", type: "text" },
  { key: "serviceActiveInfo", label: "If no, service active / company", section: "lead", type: "text" },
  { key: "phoneNumber", label: "Phone Number", section: "client", type: "tel", required: true },
  { key: "firstName", label: "First Name", section: "client", type: "text", required: true },
  { key: "lastName", label: "Last Name", section: "client", type: "text", required: true },
  { key: "dateOfBirth", label: "Date Of Birth", section: "client", type: "date" },
  { key: "streetAddress", label: "Street Address", section: "client", type: "text" },
  { key: "cityName", label: "City", section: "client", type: "text" },
  { key: "state", label: "State", section: "client", type: "text" },
  { key: "zipCode", label: "Zip code", section: "client", type: "text" },
  { key: "emergencyFirstName", label: "Emergency contact first name", section: "emergency", type: "text" },
  { key: "emergencyLastName", label: "Emergency contact last name", section: "emergency", type: "text" },
  { key: "emergencyPhone", label: "Emergency contact phone", section: "emergency", type: "tel" },
  { key: "emergencyRelation", label: "Emergency contact relation", section: "emergency", type: "text" },
  { key: "paymentMethod", label: "Payment method", section: "payment", type: "text", sensitive: true, viewRoles: ADMIN_ONLY, editRoles: ADMIN_ONLY },
  { key: "cardType", label: "Card Type", section: "payment", type: "text", sensitive: true, viewRoles: ADMIN_ONLY, editRoles: ADMIN_ONLY },
  { key: "cardExpDate", label: "Card Exp Date", section: "payment", type: "text", sensitive: true, viewRoles: ADMIN_ONLY, editRoles: ADMIN_ONLY },
  { key: "cvv", label: "CVV", section: "payment", type: "text", sensitive: true, viewRoles: ADMIN_ONLY, editRoles: ADMIN_ONLY },
  { key: "cardNumber", label: "Card Number", section: "payment", type: "text", sensitive: true, viewRoles: ADMIN_ONLY, editRoles: ADMIN_ONLY },
  { key: "billingDate", label: "Billing Date (If Postponed)", section: "payment", type: "date", sensitive: true, viewRoles: ADMIN_ONLY, editRoles: ADMIN_ONLY },
  { key: "notes", label: "Notes", section: "general", type: "textarea" },
  { key: "clientFeedback", label: "Client Feedback", section: "general", type: "text" },
  { key: "reviewer", label: "Reviewer", section: "quality", type: "employee", employeeFilter: "reviewers", viewRoles: QUALITY_ROLES, editRoles: QUALITY_ROLES },
  { key: "qualityComments", label: "Quality Comments", section: "quality", type: "textarea", viewRoles: QUALITY_ROLES, editRoles: QUALITY_ROLES },
  { key: "payerName", label: "Payer Name", section: "client", type: "text" },
  { key: "medicalConditions", label: "Medical Conditions?", section: "client", type: "text" },
  { key: "chargeAmount", label: "Charge Amount (Monthly)", section: "payment", type: "text" },
  { key: "monthlyBillingDate", label: "Monthly Billing Date", section: "payment", type: "text" },
  { key: "alternativePhone", label: "Alternative Phone", section: "client", type: "tel" },
  { key: "assignVerifier", label: "Assign Verifier", section: "quality", type: "employee", employeeFilter: "verifiers", viewRoles: QUALITY_ROLES, editRoles: QUALITY_ROLES },
  { key: "verifierFeedback", label: "Verifier Feedback", section: "quality", type: "text", viewRoles: QUALITY_ROLES },
  { key: "price", label: "Price", section: "lead", type: "number" },
  { key: "effectiveDate", label: "Effective date", section: "lead", type: "date" },
  { key: "status", label: "Status", section: "lead", type: "select", options: ["passed", "pending", "postdated", "denied", "callback"], viewRoles: [...DEFAULT_VIEW, "tl", "op"], editRoles: ["tl", "op", "admin", "hr", "quality", "rtm"] },
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
  return {
    viewRoles: field.viewRoles || DEFAULT_VIEW,
    editRoles: field.editRoles || DEFAULT_EDIT,
  };
}

function canViewField(field, role, dbPerm = null) {
  const r = normalizeRole(role);
  if (r === "agent" || r === "office_assistant") {
    const agentKeys = new Set([
      "status",
      "deviceType",
      "firstName",
      "lastName",
      "submissionDate",
      "agentName",
      "team",
      "unit",
    ]);
    if (!agentKeys.has(field.key)) return false;
  }
  const viewRoles = dbPerm?.view_roles || field.viewRoles || DEFAULT_VIEW;
  return roleInList(role, viewRoles);
}

function canEditField(field, role, dbPerm = null) {
  const editRoles = dbPerm?.edit_roles || field.editRoles || DEFAULT_EDIT;
  return roleInList(role, editRoles);
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
  return out;
}

function sanitizeFormPayload(formData, role, permissionsMap = {}, { create = false } = {}) {
  const out = {};
  for (const field of FIELDS) {
    const perm = permissionsMap[field.key];
    const canEdit = canEditField(field, role, perm);
    if (!canEdit && !create) continue;
    if (!canEdit && create && formData[field.key] == null) continue;
    if (formData[field.key] !== undefined) {
      out[field.key] = formData[field.key];
    }
  }
  return out;
}

function listFieldsForRole(role, permissionsMap = {}) {
  return FIELDS.filter((f) => canViewField(f, role, permissionsMap[f.key])).map((f) => ({
    ...f,
    canEdit: canEditField(f, role, permissionsMap[f.key]),
  }));
}

function listSections() {
  return [...new Set(FIELDS.map((f) => f.section))];
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
  getFieldDef,
  canViewField,
  canEditField,
  filterFormDataForRole,
  sanitizeFormPayload,
  listFieldsForRole,
  listAttachmentKindsForRole,
  listSections,
  seedDefaultPermissions,
};

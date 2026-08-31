/**
 * RPM-PH sales form + quality field catalog.
 */
const rpmStatus = require("./rpm-sales-status");

const LEAD_TYPE_DEFAULT = "RPM PH";
const PASSTHROUGH_KEYS = ["salesClientId"];

const DEFAULT_VIEW = ["agent", "tl", "op", "quality", "rtm", "admin", "hr", "finance", "ceo"];
const DEFAULT_EDIT = ["agent", "tl", "op", "admin", "hr"];
const QUALITY_ROLES = ["quality", "rtm", "admin", "ceo"];
const INTERNAL_FEEDBACK_VIEW_ROLES = ["quality", "rtm", "admin"];
const INTERNAL_FEEDBACK_EDIT_ROLES = ["admin", "rtm"];
const CLOSER_VIEW_ROLES = ["agent", "tl", "op", "quality", "rtm", "admin", "ceo", "hr"];
const SUBMIT_EDIT = ["agent", "tl", "op", "admin", "hr"];
const STATUS_VIEW = ["op", "quality", "rtm", "admin", "hr", "finance", "ceo", "agent", "tl"];
const STATUS_EDIT = ["quality", "admin", "rtm"];

const REVIEWER_FEEDBACK_OPTIONS = [rpmStatus.REVIEWER_FEEDBACK_DONE, rpmStatus.REVIEWER_FEEDBACK_PENDING];
const INTERNAL_FEEDBACK_OPTIONS = [rpmStatus.INTERNAL_FEEDBACK_PENDING, rpmStatus.INTERNAL_FEEDBACK_PROCESSED];
const RPM_CLIENT_FEEDBACK_OPTIONS = [
  rpmStatus.CLIENT_APPROVED,
  rpmStatus.CLIENT_PENDING,
  rpmStatus.CLIENT_DENIED,
  rpmStatus.CLIENT_CALLBACK,
  rpmStatus.CLIENT_RETRANSFER,
];

const GENDER_OPTIONS = ["Male", "Female", "Non-binary", "Prefer not to say"];

const MEDICAL_CONDITIONS = [
  "Cancer",
  "Diabetes",
  "Heart disease",
  "High blood pressure",
  "High cholesterol",
  "Stroke",
  "Kidney disease",
  "Liver disease",
  "Lung disease",
  "Depression",
  "Anxiety",
  "Dementia",
  "Alzheimer's",
  "Alzheimer's / Dementia",
  "Parkinson's",
  "Epilepsy",
  "Arthritis",
  "Osteoporosis",
  "HIV/AIDS",
  "Mental health condition",
  "Substance abuse",
  "Vision impairment",
  "Hearing impairment",
  "Mobility impairment",
  "Other",
];

const FIELDS = [
  {
    key: "submissionDate",
    label: "Submission Date",
    section: "basic",
    type: "datetime",
    hideOnCreate: true,
    hideOnEdit: true,
  },
  {
    key: "leadType",
    label: "Lead Type",
    section: "basic",
    type: "text",
    defaultValue: LEAD_TYPE_DEFAULT,
    systemHidden: true,
    viewRoles: [],
    editRoles: [],
  },
  {
    key: "client",
    label: "Client Name",
    section: "basic",
    type: "select",
    required: true,
    viewRoles: DEFAULT_VIEW,
    editRoles: SUBMIT_EDIT,
  },
  { key: "fullName", label: "Full Name", section: "basic", type: "text", required: true, viewRoles: DEFAULT_VIEW, editRoles: SUBMIT_EDIT },
  { key: "phoneNumber", label: "Phone Number", section: "basic", type: "tel", required: true, viewRoles: DEFAULT_VIEW, editRoles: SUBMIT_EDIT },
  { key: "alternativePhone", label: "Alternative Phone Number", section: "basic", type: "tel", required: true, viewRoles: DEFAULT_VIEW, editRoles: SUBMIT_EDIT },
  { key: "dateOfBirth", label: "Date of Birth", section: "basic", type: "date", required: true, viewRoles: DEFAULT_VIEW, editRoles: SUBMIT_EDIT },
  { key: "memberId", label: "Member ID", section: "basic", type: "text", required: true, viewRoles: DEFAULT_VIEW, editRoles: SUBMIT_EDIT },
  { key: "email", label: "Email Address", section: "basic", type: "email", required: true, viewRoles: DEFAULT_VIEW, editRoles: SUBMIT_EDIT },
  { key: "address", label: "Address", section: "basic", type: "text", required: true, viewRoles: DEFAULT_VIEW, editRoles: SUBMIT_EDIT },
  {
    key: "gender",
    label: "Gender",
    section: "basic",
    type: "select",
    options: GENDER_OPTIONS,
    selectPlaceholder: true,
    required: true,
    viewRoles: DEFAULT_VIEW,
    editRoles: SUBMIT_EDIT,
  },
  {
    key: "medicalConditions",
    label: "Medical Conditions",
    section: "medical",
    type: "multi-checkbox",
    options: MEDICAL_CONDITIONS,
    required: true,
    viewRoles: DEFAULT_VIEW,
    editRoles: SUBMIT_EDIT,
  },
  { key: "emergencyFullName", label: "Emergency Contact Full Name", section: "emergency", type: "text", required: true, viewRoles: DEFAULT_VIEW, editRoles: SUBMIT_EDIT },
  { key: "emergencyPhone", label: "Emergency Contact Phone", section: "emergency", type: "tel", required: true, viewRoles: DEFAULT_VIEW, editRoles: SUBMIT_EDIT },
  { key: "emergencyRelation", label: "Emergency Contact Relation", section: "emergency", type: "text", required: true, viewRoles: DEFAULT_VIEW, editRoles: SUBMIT_EDIT },
  {
    key: "notes",
    label: "Notes",
    section: "notes",
    type: "textarea",
    viewRoles: DEFAULT_VIEW,
    editRoles: SUBMIT_EDIT,
    mainViewRoles: DEFAULT_VIEW,
    qualityViewRoles: DEFAULT_VIEW,
  },
  { key: "agentName", label: "Agent Name", section: "assignment", type: "text", hideOnCreate: true, hideOnEdit: true },
  { key: "closerName", label: "Closer Name", section: "assignment", type: "text", hideOnCreate: true, hideOnEdit: true },
  { key: "unit", label: "Unit", section: "assignment", type: "text", hideOnCreate: true, hideOnEdit: true },
  { key: "team", label: "Team", section: "assignment", type: "text", hideOnCreate: true, hideOnEdit: true },
  {
    key: "reviewer",
    label: "Reviewer",
    section: "quality",
    type: "employee",
    employeeFilter: "reviewers",
    viewRoles: [...QUALITY_ROLES, "hr"],
    editRoles: [...QUALITY_ROLES],
    qualityViewRoles: [...QUALITY_ROLES, "hr"],
    mainViewRoles: ["admin", "hr"],
  },
  {
    key: "reviewerFeedback",
    label: "Reviewer feedback",
    section: "quality",
    type: "select",
    options: REVIEWER_FEEDBACK_OPTIONS,
    selectPlaceholder: false,
    defaultValue: rpmStatus.REVIEWER_FEEDBACK_PENDING,
    viewRoles: [...QUALITY_ROLES, "tl", "op", "agent"],
    editRoles: ["quality", "admin"],
    qualityViewRoles: [...QUALITY_ROLES, "tl", "op"],
    mainViewRoles: [...QUALITY_ROLES, "tl", "op", "agent", "admin"],
  },
  {
    key: "clientFeedbackComments",
    label: "Client feedback comments",
    section: "client",
    type: "textarea",
    viewRoles: CLOSER_VIEW_ROLES,
    editRoles: ["quality", "admin"],
    qualityViewRoles: CLOSER_VIEW_ROLES,
    mainViewRoles: CLOSER_VIEW_ROLES,
  },
  {
    key: "clientFeedback",
    label: "Client feedback",
    section: "client",
    type: "select",
    options: RPM_CLIENT_FEEDBACK_OPTIONS,
    selectPlaceholder: false,
    defaultValue: rpmStatus.CLIENT_PENDING,
    viewRoles: CLOSER_VIEW_ROLES,
    editRoles: ["quality", "admin", "rtm"],
    qualityViewRoles: CLOSER_VIEW_ROLES,
    mainViewRoles: CLOSER_VIEW_ROLES,
  },
  {
    key: "internalFeedback",
    label: "Internal feedback",
    section: "internal",
    type: "select",
    options: INTERNAL_FEEDBACK_OPTIONS,
    selectPlaceholder: false,
    defaultValue: rpmStatus.INTERNAL_FEEDBACK_PENDING,
    hideOnCreate: true,
    viewRoles: INTERNAL_FEEDBACK_VIEW_ROLES,
    editRoles: INTERNAL_FEEDBACK_EDIT_ROLES,
    qualityViewRoles: INTERNAL_FEEDBACK_VIEW_ROLES,
    mainViewRoles: INTERNAL_FEEDBACK_VIEW_ROLES,
  },
  {
    key: "status",
    label: "Workflow status",
    section: "basic",
    type: "select",
    options: ["passed", "pending", "denied", "callback"],
    viewRoles: STATUS_VIEW,
    editRoles: STATUS_EDIT,
    hideOnCreate: true,
    hideOnEdit: true,
    hideInList: false,
  },
];

const ATTACHMENT_KINDS = [
  {
    key: "recording",
    label: "Recording",
    viewRoles: [...QUALITY_ROLES, "hr"],
    editRoles: ["quality", "rtm", "admin", "ceo"],
  },
  {
    key: "quality_record",
    label: "Quality Record",
    viewRoles: QUALITY_ROLES,
    editRoles: ["quality", "rtm", "admin", "ceo"],
  },
  {
    key: "raw_call",
    label: "Raw call",
    viewRoles: QUALITY_ROLES,
    editRoles: ["quality", "rtm", "admin", "ceo"],
  },
];

function normalizeRole(role) {
  return String(role || "agent").trim().toLowerCase();
}

function roleInList(role, list) {
  return (list || []).map(normalizeRole).includes(normalizeRole(role));
}

function getFieldDef(key) {
  return FIELDS.find((f) => f.key === key) || null;
}

function isSystemHiddenField(field) {
  return Boolean(field?.systemHidden) || field?.key === "leadType";
}

function resolver() {
  return require("./sales-rpm-access-resolver");
}

function listSections() {
  return [...new Set(FIELDS.map((f) => f.section))];
}

function getDefaultPermissions(field) {
  return resolver().getDefaultFieldPermissions(field);
}

function canViewFieldOnSurface(...args) {
  return resolver().canViewFieldOnSurface(...args);
}

function canEditFieldOnSurface(...args) {
  return resolver().canEditFieldOnSurface(...args);
}

function mapFieldForRole(...args) {
  return resolver().mapFieldForRole(...args);
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

function listFieldsForSubmit(...args) {
  return resolver().listFieldsForSubmit(...args);
}

function listAttachmentKindsForRole(role, opts = {}) {
  return resolver().listAttachmentKindsForRole(role, opts.attachPermMap || {}, ATTACHMENT_KINDS, opts);
}

function listAttachmentKindsForSubmit(role) {
  return resolver().listAttachmentKindsForSubmit(role);
}

function canViewAttachmentKind(kind, role, attachPermMap = {}) {
  return resolver().canViewAttachmentKind(kind, role, attachPermMap);
}

function canEditAttachmentKind(kind, role, attachPermMap = {}) {
  return resolver().canEditAttachmentKind(kind, role, attachPermMap);
}

async function seedDefaultPermissions(db) {
  for (let i = 0; i < FIELDS.length; i += 1) {
    const f = FIELDS[i];
    if (isSystemHiddenField(f)) continue;
    const perms = getDefaultPermissions(f);
    await db.from("rpm_sales_field_permissions").upsert(
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
  await require("./sales-rpm-attachment-permissions").seedDefaults();
}

module.exports = {
  FIELDS,
  ATTACHMENT_KINDS,
  LEAD_TYPE_DEFAULT,
  PASSTHROUGH_KEYS,
  REVIEWER_FEEDBACK_OPTIONS,
  INTERNAL_FEEDBACK_OPTIONS,
  RPM_CLIENT_FEEDBACK_OPTIONS,
  DEFAULT_VIEW,
  DEFAULT_EDIT,
  QUALITY_ROLES,
  INTERNAL_FEEDBACK_VIEW_ROLES,
  INTERNAL_FEEDBACK_EDIT_ROLES,
  getFieldDef,
  isSystemHiddenField,
  canViewFieldOnSurface,
  canEditFieldOnSurface,
  mapFieldForRole,
  filterFormDataForRole,
  sanitizeFormPayload,
  listFieldsForRole,
  listFieldsForRoleOnSurface,
  listFieldsForSubmit,
  listAttachmentKindsForRole,
  listAttachmentKindsForSubmit,
  canViewAttachmentKind,
  canEditAttachmentKind,
  listSections,
  seedDefaultPermissions,
  getDefaultPermissions,
};

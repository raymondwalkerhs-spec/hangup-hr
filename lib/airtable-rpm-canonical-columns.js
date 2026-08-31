/**
 * Canonical RPM Airtable columns for Hangup RPM base (RPM Sales + Q Feedback).
 */
const rpmCatalog = require("./sales-rpm-field-catalog");
const rpmStatus = require("./rpm-sales-status");
const { FEEDBACK_STATUS_LABELS, CHECK_STATUS_LABELS } = require("./rpm-check-status");

const DATE_OPTS = { dateFormat: { name: "local", format: "l" } };
const DATETIME_OPTS = {
  dateFormat: { name: "local", format: "l" },
  timeFormat: { name: "12hour", format: "h:mma" },
  timeZone: "client",
};

function selectChoices(names) {
  return { choices: names.map((name) => ({ name })) };
}

const RPM_SALES_COLUMNS = [
  { name: "Full Name", type: "singleLineText" },
  { name: "Portal Sale ID", type: "singleLineText" },
  { name: "Submission Date", type: "dateTime", options: DATETIME_OPTS },
  { name: "Lead Type", type: "singleLineText" },
  {
    name: "Client",
    type: "singleSelect",
    options: selectChoices(["RPM1", "RPM2", "RPM3"]),
  },
  { name: "Center Code", type: "singleLineText" },
  { name: "Team", type: "singleLineText" },
  { name: "Agent Name", type: "singleLineText" },
  { name: "Closer Name", type: "singleLineText" },
  { name: "Phone Number", type: "singleLineText" },
  { name: "Alternative Phone Number", type: "singleLineText" },
  { name: "Date Of Birth", type: "date", options: DATE_OPTS },
  { name: "Member ID", type: "singleLineText" },
  { name: "Email Address", type: "singleLineText" },
  { name: "Address", type: "multilineText" },
  {
    name: "Gender",
    type: "singleSelect",
    options: selectChoices(["Male", "Female", "Non-binary", "Prefer not to say"]),
  },
  {
    name: "Medical Conditions",
    type: "multipleSelects",
    options: selectChoices(rpmCatalog.FIELDS.find((f) => f.key === "medicalConditions")?.options || []),
  },
  { name: "Emergency Contact Full Name", type: "singleLineText" },
  { name: "Emergency Contact Phone", type: "singleLineText" },
  { name: "Emergency Contact Relation", type: "singleLineText" },
  { name: "Notes", type: "multilineText" },
  { name: "Reviewer", type: "singleLineText" },
  {
    name: "Reviewer feedback",
    type: "singleSelect",
    options: selectChoices([rpmStatus.REVIEWER_FEEDBACK_DONE, rpmStatus.REVIEWER_FEEDBACK_PENDING]),
  },
  {
    name: "Client feedback",
    type: "singleSelect",
    options: selectChoices(rpmCatalog.RPM_CLIENT_FEEDBACK_OPTIONS),
  },
  { name: "Client feedback comments", type: "multilineText" },
  {
    name: "Internal feedback",
    type: "singleSelect",
    options: selectChoices([rpmStatus.INTERNAL_FEEDBACK_PENDING, rpmStatus.INTERNAL_FEEDBACK_PROCESSED]),
  },
  {
    name: "Workflow status",
    type: "singleSelect",
    options: selectChoices(["passed", "pending", "denied", "callback"]),
  },
  { name: "Effective date", type: "date", options: DATE_OPTS },
  { name: "Recordings", type: "multipleAttachments" },
  { name: "Quality Record", type: "multipleAttachments" },
  { name: "Raw call record", type: "multipleAttachments" },
  { name: "Portal Check ID", type: "singleLineText" },
];

const Q_FEEDBACK_CHOICES = [
  FEEDBACK_STATUS_LABELS.callback,
  FEEDBACK_STATUS_LABELS.not_int,
  FEEDBACK_STATUS_LABELS.retransfer,
  FEEDBACK_STATUS_LABELS.dropped_with_client,
  FEEDBACK_STATUS_LABELS.sale,
];

const NQ_CHECKS_TABLE_NAME = "NQ Checks";
const NQ_STATUS_CHOICES = [
  CHECK_STATUS_LABELS.nq,
  CHECK_STATUS_LABELS.age_limit,
  CHECK_STATUS_LABELS.under_age,
  CHECK_STATUS_LABELS.duplicate,
];

const NQ_CHECKS_COLUMNS = [
  { name: "Timestamp", type: "dateTime", options: DATETIME_OPTS },
  { name: "Phone No", type: "singleLineText" },
  { name: "Team", type: "singleLineText" },
  { name: "Unit", type: "singleLineText" },
  { name: "Agent Name", type: "singleLineText" },
  { name: "Status", type: "singleSelect", options: selectChoices(NQ_STATUS_CHOICES) },
  { name: "Info", type: "multilineText" },
  { name: "Full Name", type: "singleLineText" },
  { name: "Date Of Birth", type: "date", options: DATE_OPTS },
  { name: "Member ID", type: "singleLineText" },
  { name: "Working Day", type: "date", options: DATE_OPTS },
  { name: "Portal Check ID", type: "singleLineText" },
];

const Q_FEEDBACK_COLUMNS = [
  { name: "Timestamp", type: "dateTime", options: DATETIME_OPTS },
  { name: "Phone No", type: "singleLineText" },
  { name: "Team", type: "singleLineText" },
  { name: "Unit", type: "singleLineText" },
  { name: "Agent Name", type: "singleLineText" },
  { name: "Closer", type: "singleLineText" },
  { name: "Feedback", type: "singleSelect", options: selectChoices(Q_FEEDBACK_CHOICES) },
  { name: "Info", type: "multilineText" },
  { name: "Full Name", type: "singleLineText" },
  { name: "Date Of Birth", type: "date", options: DATE_OPTS },
  { name: "Member ID", type: "singleLineText" },
  { name: "Working Day", type: "date", options: DATE_OPTS },
  { name: "Feedback At", type: "dateTime", options: DATETIME_OPTS },
  { name: "Portal Check ID", type: "singleLineText" },
  { name: "Portal Sale ID", type: "singleLineText" },
];

const RPM_SALES_TABLE_NAME = "RPM Sales";
const Q_FEEDBACK_TABLE_NAME = "Q Feedback";
const RPM_SALE_LINK_FIELD = "RPM Sale";
const PORTAL_SALE_ID_FIELD = "Portal Sale ID";
const PORTAL_CHECK_ID_FIELD = "Portal Check ID";

const RPM_SALES_ATTACHMENT_COLUMNS = {
  recording: "Recordings",
  quality_record: "Quality Record",
  raw_call: "Raw call record",
};

function fieldCreateBody(spec) {
  const body = { name: spec.name, type: spec.type };
  if (spec.options) body.options = spec.options;
  return body;
}

function csvHeader(columns) {
  return columns
    .map((c) => {
      const n = c.name;
      if (n.includes(",") || n.includes('"')) return `"${n.replace(/"/g, '""')}"`;
      return n;
    })
    .join(",");
}

module.exports = {
  RPM_SALES_TABLE_NAME,
  Q_FEEDBACK_TABLE_NAME,
  NQ_CHECKS_TABLE_NAME,
  RPM_SALE_LINK_FIELD,
  PORTAL_SALE_ID_FIELD,
  PORTAL_CHECK_ID_FIELD,
  RPM_SALES_COLUMNS,
  Q_FEEDBACK_COLUMNS,
  Q_FEEDBACK_CHOICES,
  NQ_CHECKS_COLUMNS,
  NQ_STATUS_CHOICES,
  RPM_SALES_ATTACHMENT_COLUMNS,
  fieldCreateBody,
  csvHeader,
};

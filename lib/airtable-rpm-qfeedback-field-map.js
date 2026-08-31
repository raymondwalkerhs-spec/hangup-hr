/**
 * Completed Q Feedback row → Airtable Q Feedback fields.
 */
const fieldMap = require("./airtable-sales-field-map");
const { FEEDBACK_STATUS_LABELS } = require("./rpm-check-status");
const {
  PORTAL_SALE_ID_FIELD,
  PORTAL_CHECK_ID_FIELD,
  RPM_SALE_LINK_FIELD,
} = require("./airtable-rpm-canonical-columns");

const { reverseMapUnit, formatTeamForAirtable, formatDateForAirtable, formatDateTimeForAirtable, formatInstantForAirtable, employeeNameById } =
  fieldMap;

const COMPLETED_FEEDBACK = new Set([
  "dropped_with_client",
  "callback",
  "not_int",
  "retransfer",
  "sale",
]);

function isCompletedFeedback(status) {
  return COMPLETED_FEEDBACK.has(String(status || "").trim());
}

function feedbackLabel(status) {
  const key = String(status || "").trim();
  return FEEDBACK_STATUS_LABELS[key] || key;
}

function timestampForCheck(check) {
  if (check.submissionDate) {
    return formatDateTimeForAirtable(check.submissionDate, check.submissionTime);
  }
  if (check.createdAt) {
    return formatInstantForAirtable(check.createdAt);
  }
  if (check.workingDay) {
    return formatDateTimeForAirtable(check.workingDay, check.submissionTime);
  }
  return null;
}

function buildQFeedbackFieldsForAirtable(check, employees, { saleAirtableRecordId } = {}) {
  const fields = {};
  const emp = employees || [];
  if (check.id) fields[PORTAL_CHECK_ID_FIELD] = check.id;

  const ts = timestampForCheck(check);
  if (ts) fields.Timestamp = ts;

  if (check.phone) fields["Phone No"] = String(check.phone);
  if (check.team) fields.Team = formatTeamForAirtable(check.team);
  if (check.unit) fields.Unit = reverseMapUnit(check.unit);

  const agentName = check.agentName || employeeNameById(emp, check.agentId);
  if (agentName) fields["Agent Name"] = agentName;

  const closerName = check.closerName || employeeNameById(emp, check.closerId);
  if (closerName) fields.Closer = closerName;

  if (isCompletedFeedback(check.feedbackStatus)) {
    fields.Feedback = feedbackLabel(check.feedbackStatus);
  }
  if (check.info) fields.Info = String(check.info);
  if (check.fullName) fields["Full Name"] = String(check.fullName);
  const dob = formatDateForAirtable(check.dateOfBirth);
  if (dob) fields["Date Of Birth"] = dob;
  if (check.memberId) fields["Member ID"] = String(check.memberId);
  const wd = formatDateForAirtable(check.workingDay);
  if (wd) fields["Working Day"] = wd;
  if (check.feedbackAt) {
    const at = formatInstantForAirtable(check.feedbackAt);
    if (at) fields["Feedback At"] = at;
  }
  if (check.linkedRpmSaleId) fields[PORTAL_SALE_ID_FIELD] = check.linkedRpmSaleId;
  else fields[PORTAL_SALE_ID_FIELD] = "";

  if (saleAirtableRecordId) {
    fields[RPM_SALE_LINK_FIELD] = [saleAirtableRecordId];
  } else {
    fields[RPM_SALE_LINK_FIELD] = [];
  }

  return fields;
}

module.exports = {
  PORTAL_CHECK_ID_FIELD,
  PORTAL_SALE_ID_FIELD,
  RPM_SALE_LINK_FIELD,
  COMPLETED_FEEDBACK,
  isCompletedFeedback,
  feedbackLabel,
  timestampForCheck,
  buildQFeedbackFieldsForAirtable,
};

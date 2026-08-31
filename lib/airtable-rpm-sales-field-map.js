/**
 * RPM sale → Airtable RPM Sales fields.
 */
const fieldMap = require("./airtable-sales-field-map");
const {
  PORTAL_SALE_ID_FIELD,
  PORTAL_CHECK_ID_FIELD,
  RPM_SALES_ATTACHMENT_COLUMNS,
} = require("./airtable-rpm-canonical-columns");

const {
  reverseMapUnit,
  formatTeamForAirtable,
  formatDateForAirtable,
  formatDateTimeForAirtable,
  employeeNameById,
} = fieldMap;

function asText(val) {
  if (val == null) return "";
  if (Array.isArray(val)) return val.filter(Boolean).join(", ");
  return String(val).trim();
}

function medicalList(val) {
  if (Array.isArray(val)) return val.map((v) => String(v).trim()).filter(Boolean);
  const s = String(val || "").trim();
  if (!s) return [];
  return s.split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
}

function buildRpmSaleFieldsForAirtable(sale, employees, { linkedCheckId } = {}) {
  const fields = {};
  const form = { ...(sale.formData || {}) };
  const emp = employees || [];

  if (PORTAL_SALE_ID_FIELD && sale.id) fields[PORTAL_SALE_ID_FIELD] = sale.id;

  const fullName = sale.fullName || form.fullName || "";
  if (fullName) fields["Full Name"] = fullName;

  if (sale.submissionDate) {
    fields["Submission Date"] = formatDateTimeForAirtable(sale.submissionDate, sale.submissionTime);
  }

  const leadType = form.leadType || "RPM PH";
  if (leadType) fields["Lead Type"] = leadType;

  const client = sale.client || form.client;
  if (client) fields.Client = client;

  const unit = sale.unit || form.unit;
  if (unit) fields["Center Code"] = reverseMapUnit(unit);

  const team = sale.team || form.team;
  if (team) fields.Team = formatTeamForAirtable(team);

  const agentName = form.agentName || employeeNameById(emp, sale.agentId);
  if (agentName) fields["Agent Name"] = agentName;

  const closerName = form.closerName || employeeNameById(emp, sale.closerId);
  if (closerName) fields["Closer Name"] = closerName;

  const phone = sale.phoneNumber || form.phoneNumber;
  if (phone) fields["Phone Number"] = asText(phone);

  const alt = form.alternativePhone || form.alternativePhoneNumber;
  if (alt) fields["Alternative Phone Number"] = asText(alt);

  const dob = formatDateForAirtable(form.dateOfBirth);
  if (dob) fields["Date Of Birth"] = dob;

  const memberId = sale.memberId || form.memberId;
  if (memberId) fields["Member ID"] = asText(memberId);

  if (form.email) fields["Email Address"] = asText(form.email);
  if (form.address) fields.Address = asText(form.address);
  if (form.gender) fields.Gender = asText(form.gender);

  const medical = medicalList(form.medicalConditions);
  if (medical.length) fields["Medical Conditions"] = medical;

  if (form.emergencyFullName) fields["Emergency Contact Full Name"] = asText(form.emergencyFullName);
  if (form.emergencyPhone) fields["Emergency Contact Phone"] = asText(form.emergencyPhone);
  if (form.emergencyRelation) fields["Emergency Contact Relation"] = asText(form.emergencyRelation);
  if (form.notes) fields.Notes = asText(form.notes);

  const reviewer = form.reviewer ? employeeNameById(emp, form.reviewer) || asText(form.reviewer) : "";
  if (reviewer) fields.Reviewer = reviewer;
  if (form.reviewerFeedback) fields["Reviewer feedback"] = asText(form.reviewerFeedback);
  if (form.clientFeedback) fields["Client feedback"] = asText(form.clientFeedback);
  if (form.clientFeedbackComments) fields["Client feedback comments"] = asText(form.clientFeedbackComments);
  if (form.internalFeedback) fields["Internal feedback"] = asText(form.internalFeedback);

  if (sale.status) fields["Workflow status"] = asText(sale.status);

  const effective = formatDateForAirtable(sale.effectiveDate);
  if (effective) fields["Effective date"] = effective;

  if (linkedCheckId) fields[PORTAL_CHECK_ID_FIELD] = linkedCheckId;

  return fields;
}

module.exports = {
  PORTAL_SALE_ID_FIELD,
  PORTAL_CHECK_ID_FIELD,
  RPM_SALES_ATTACHMENT_COLUMNS,
  buildRpmSaleFieldsForAirtable,
  reverseMapUnit,
  formatTeamForAirtable,
  formatDateForAirtable,
  formatDateTimeForAirtable,
  employeeNameById,
};

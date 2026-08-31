/**
 * NQ / Age limit / Duplicate / Under Age check → Airtable "NQ Checks".
 */
const fieldMap = require("./airtable-sales-field-map");
const { CHECK_STATUS_LABELS, isNqFamilyCheck } = require("./rpm-check-status");
const { PORTAL_CHECK_ID_FIELD } = require("./airtable-rpm-canonical-columns");
const { timestampForCheck } = require("./airtable-rpm-qfeedback-field-map");

const { reverseMapUnit, formatTeamForAirtable, formatDateForAirtable, employeeNameById } = fieldMap;

function formPhoneDigits(phone) {
  return String(phone || "").replace(/\D/g, "");
}

/** Checks form stores a US phone; ignore empty / junk imports. */
function nationalPhoneDigits(phone) {
  let digits = formPhoneDigits(phone);
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits;
}

function hasFormPhone(phone) {
  return nationalPhoneDigits(phone).length === 10;
}

function formPhoneForAirtable(phone) {
  return hasFormPhone(phone) ? nationalPhoneDigits(phone) : "";
}

function statusLabel(checkStatus) {
  const key = String(checkStatus || "").trim();
  return CHECK_STATUS_LABELS[key] || key;
}

function buildNqCheckFieldsForAirtable(check, employees) {
  const fields = {};
  const emp = employees || [];
  if (check.id) fields[PORTAL_CHECK_ID_FIELD] = check.id;

  const ts = timestampForCheck(check);
  if (ts) fields.Timestamp = ts;

  const formPhone = formPhoneForAirtable(check.phone || check.phoneNormalized);
  if (formPhone) fields["Phone No"] = formPhone;
  if (check.team) fields.Team = formatTeamForAirtable(check.team);
  if (check.unit) fields.Unit = reverseMapUnit(check.unit);

  const agentName = check.agentName || employeeNameById(emp, check.agentId);
  if (agentName) fields["Agent Name"] = agentName;

  if (isNqFamilyCheck(check.checkStatus)) {
    fields.Status = statusLabel(check.checkStatus);
  }
  if (check.info) fields.Info = String(check.info);
  if (check.fullName) fields["Full Name"] = String(check.fullName);
  const dob = formatDateForAirtable(check.dateOfBirth);
  if (dob) fields["Date Of Birth"] = dob;
  if (check.memberId) fields["Member ID"] = String(check.memberId);
  const wd = formatDateForAirtable(check.workingDay);
  if (wd) fields["Working Day"] = wd;

  return fields;
}

module.exports = {
  PORTAL_CHECK_ID_FIELD,
  isNqFamilyCheck,
  statusLabel,
  hasFormPhone,
  formPhoneForAirtable,
  buildNqCheckFieldsForAirtable,
};

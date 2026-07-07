/**
 * Canonical Airtable column ↔ app form_data mapping (shared with import).
 */
const { CSV_ATTACHMENT_COLUMNS } = require("./sales-attachment-import-config");

/** Airtable CSV column label → form_data key */
const CSV_TO_FORM = [
  ["Submission Date", "submissionDate"],
  ["Lead Type", "leadType"],
  ["Client", "client"],
  ["Center Code", "unit"],
  ["Team", "team"],
  ["Agent Name", "agentName"],
  ["Closer Name", "closerName"],
  ["Device Type", "deviceType"],
  ["First time getting a device?", "firstTimeDevice"],
  ["If no, Is the service currently active", "serviceActiveInfo"],
  ["Phone Number", "phoneNumber"],
  ["First Name", "firstName"],
  ["Last Name", "lastName"],
  ["Date Of Birth", "dateOfBirth"],
  ["Address ( Street Address )", "streetAddress"],
  ["Address", "streetAddress"],
  ["City Name", "cityName"],
  ["State", "state"],
  ["Zip code", "zipCode"],
  ["Emergency contact first name", "emergencyFirstName"],
  ["Emergency contact last name", "emergencyLastName"],
  ["Emergency contact phone number", "emergencyPhone"],
  ["Emergency contact relation", "emergencyRelation"],
  ["Payment method", "paymentMethod"],
  ["Card Type", "cardType"],
  ["Card Exp Date", "cardExpDate"],
  ["CVV", "cvv"],
  ["Card Number", "cardNumber"],
  ["Billing Date", "billingDate"],
  ["Monthly Billing Date", "monthlyBillingDate"],
  ["Notes", "notes"],
  ["Client Feedback", "clientFeedback"],
  ["Quality Comments", "qualityComments"],
  ["Payer Name", "payerName"],
  ["Medical Conditions", "medicalConditions"],
  ["Charge Amount", "chargeAmount"],
  ["Alternative Phone", "alternativePhone"],
  ["Verifier Feedback", "verifierFeedback"],
];

/** form_data keys not in CSV import — use Airtable column labels from catalog */
const EXTRA_FORM_TO_AIRTABLE = [
  ["routingNumber", "Routing Number"],
  ["bankName", "Bank Name"],
  ["bankAccountNumber", "Bank Account Number"],
  ["bankAddress", "Bank Address"],
  ["reviewer", "Reviewer"],
  ["assignVerifier", "Assign Verifier"],
];

/** Empty string env disables; unset defaults to provisioned column name */
const PORTAL_SALE_ID_FIELD =
  process.env.AIRTABLE_PORTAL_SALE_ID_FIELD === ""
    ? ""
    : process.env.AIRTABLE_PORTAL_SALE_ID_FIELD || "Portal Sale ID";

/** Outbound-only overrides when Airtable column labels differ from CSV import headers */
const AIRTABLE_FIELD_OVERRIDES = {
  serviceActiveInfo: "If no, Is the service currently active or no? Mention the company name",
  alternativePhone: "Alternative Phone Number",
  chargeAmount: "Charge Amount ( Monthly Subscription Fees ) ",
  medicalConditions: "Do you have any Medical Conditions?",
  assignVerifier: "Assign Verifier ",
  billingDate: "Billing Date ( If Postponed Payment",
  monthlyBillingDate: "Monthly Billing Date",
};

/** Attachment kinds to skip when not on the target table (comma-separated env) */
const SKIP_ATTACHMENT_KINDS = new Set(
  process.env.AIRTABLE_SKIP_ATTACHMENT_KINDS === undefined
    ? []
    : String(process.env.AIRTABLE_SKIP_ATTACHMENT_KINDS)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
);

const EMPLOYEE_ID_FORM_KEYS = new Set(["reviewer", "assignVerifier"]);

function buildFormToAirtable() {
  const map = new Map();
  for (const [airtableCol, formKey] of CSV_TO_FORM) {
    if (!map.has(formKey)) map.set(formKey, airtableCol);
  }
  for (const [formKey, airtableCol] of EXTRA_FORM_TO_AIRTABLE) {
    if (!map.has(formKey)) map.set(formKey, airtableCol);
  }
  for (const [formKey, airtableCol] of Object.entries(AIRTABLE_FIELD_OVERRIDES)) {
    map.set(formKey, airtableCol);
  }
  return map;
}

const FORM_TO_AIRTABLE = buildFormToAirtable();

/** kind → Airtable attachment column */
const KIND_TO_ATTACHMENT_COLUMN = Object.fromEntries(
  CSV_ATTACHMENT_COLUMNS.map(({ headerMatch, kind }) => [kind, headerMatch])
);

function reverseMapUnit(unit) {
  const u = String(unit || "").trim().toUpperCase();
  if (u === "HS-3" || u === "HS3") return "HS3";
  if (u === "HS-1" || u === "HS1") return "HS1";
  if (u === "HS-2" || u === "HS2") return "HS2";
  return String(unit || "").replace(/^HS-/i, "HS");
}

function formatTeamForAirtable(team) {
  const t = String(team || "").trim();
  if (!t) return "";
  if (/^team\s+/i.test(t)) return t;
  if (/^hs\s*\d/i.test(t)) return t;
  return `Team ${t}`;
}

function reverseMapDevice(device) {
  const d = String(device || "").trim().toLowerCase();
  if (d === "smartwatch") return "Smartwatch";
  if (d === "bracelet") return "Bracelet";
  if (d === "necklace") return "Necklace";
  return device || "";
}

function formatDateForAirtable(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const [, mo, da, yr] = m;
    return `${yr}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}`;
  }
  // Airtable date fields reject arbitrary strings (e.g. "5th of each month").
  // Fail-soft by sending null so the record still syncs.
  return null;
}

function formatDateTimeForAirtable(dateVal, timeVal) {
  const date = formatDateForAirtable(dateVal);
  if (!date) return null;
  const time = String(timeVal || "").trim();
  if (time && /^\d{1,2}:\d{2}/.test(time)) {
    const [h, mi] = time.split(":");
    return `${date}T${h.padStart(2, "0")}:${mi.padStart(2, "0")}:00.000Z`;
  }
  return `${date}T12:00:00.000Z`;
}

function employeeNameById(employees, id) {
  if (!id) return "";
  const hit = (employees || []).find((e) => e.id === id);
  return hit?.american_name || hit?.americanName || "";
}

function resolveFormValue(formKey, raw, employees) {
  if (raw == null || raw === "") return null;
  if (EMPLOYEE_ID_FORM_KEYS.has(formKey)) {
    const name = employeeNameById(employees, raw);
    return name || String(raw);
  }
  if (formKey === "submissionDate") return formatDateTimeForAirtable(raw);
  if (formKey === "dateOfBirth" || formKey === "billingDate" || formKey === "monthlyBillingDate" || formKey === "effectiveDate") {
    return formatDateForAirtable(raw);
  }
  if (formKey === "unit") return reverseMapUnit(raw);
  if (formKey === "team") return formatTeamForAirtable(raw);
  if (formKey === "deviceType") return reverseMapDevice(raw);
  return String(raw);
}

/**
 * Build Airtable fields object from sale row (excludes attachments).
 */
function buildSaleFieldsForAirtable(sale, employees) {
  const fields = {};
  const form = { ...(sale.formData || {}) };

  if (PORTAL_SALE_ID_FIELD) fields[PORTAL_SALE_ID_FIELD] = sale.id;

  const unit = sale.unit || form.unit;
  if (unit) fields["Center Code"] = reverseMapUnit(unit);

  const team = sale.team || form.team;
  if (team) fields.Team = formatTeamForAirtable(team);

  const client = sale.client || form.client;
  if (client) fields.Client = client;

  const device = sale.device || form.deviceType;
  if (device) fields["Device Type"] = reverseMapDevice(device);

  if (sale.price != null && sale.price !== "") {
    const raw = String(sale.price);
    const m = raw.match(/\$?([\d,]+\.?\d*)/);
    fields.Price = m ? parseFloat(m[1].replace(/,/g, "")) : undefined;
    fields["Price tier"] = raw;
  }

  const agentName = form.agentName || employeeNameById(employees, sale.agentId);
  if (agentName) fields["Agent Name"] = agentName;

  const closerName = form.closerName || employeeNameById(employees, sale.closerId);
  if (closerName) fields["Closer Name"] = closerName;

  if (sale.phoneNumber && !form.phoneNumber) form.phoneNumber = sale.phoneNumber;
  if (sale.fullName && !form.firstName && !form.lastName) {
    const parts = String(sale.fullName).trim().split(/\s+/);
    if (parts.length) form.firstName = parts[0];
    if (parts.length > 1) form.lastName = parts.slice(1).join(" ");
  }

  if (sale.submissionDate) {
    fields["Submission Date"] = formatDateTimeForAirtable(sale.submissionDate, sale.submissionTime);
  }

  if (sale.effectiveDate) {
    fields["Effective date"] = formatDateForAirtable(sale.effectiveDate);
  }

  if (sale.feedback) fields.Feedback = sale.feedback;

  if (sale.status) fields["Workflow status"] = sale.status;

  for (const [formKey, airtableCol] of FORM_TO_AIRTABLE.entries()) {
    if (fields[airtableCol] != null && fields[airtableCol] !== "") continue;
    const raw = form[formKey];
    if (raw == null || raw === "") continue;
    const val = resolveFormValue(formKey, raw, employees);
    if (val != null && val !== "") fields[airtableCol] = val;
  }

  return fields;
}

module.exports = {
  CSV_TO_FORM,
  FORM_TO_AIRTABLE,
  KIND_TO_ATTACHMENT_COLUMN,
  SKIP_ATTACHMENT_KINDS,
  PORTAL_SALE_ID_FIELD,
  reverseMapUnit,
  formatTeamForAirtable,
  reverseMapDevice,
  formatDateForAirtable,
  formatDateTimeForAirtable,
  buildSaleFieldsForAirtable,
  employeeNameById,
};

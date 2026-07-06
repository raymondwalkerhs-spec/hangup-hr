/**
 * Required-field rules for sales submit (aligned with MLA Airtable form).
 */
const catalog = require("./sales-field-catalog");

const REQUIRED_ON_SUBMIT = [
  "phoneNumber",
  "firstName",
  "lastName",
  "dateOfBirth",
  "streetAddress",
  "cityName",
  "state",
  "zipCode",
  "emergencyFirstName",
  "emergencyLastName",
  "emergencyPhone",
  "emergencyRelation",
  "firstTimeDevice",
  "medicalConditions",
  "payerName",
  "paymentMethod",
];

const TOP_LEVEL_REQUIRED = ["agentId", "unit", "team", "device", "client"];

const LABELS = Object.fromEntries(catalog.FIELDS.map((f) => [f.key, f.label]));

function labelFor(key) {
  if (key === "agentId") return "Agent";
  if (key === "closerId") return "Closer";
  if (key === "unit") return "Unit";
  if (key === "team") return "Team";
  if (key === "device") return "Device";
  if (key === "client") return "Client";
  if (key === "price") return "Price";
  if (key === "recording") return "Recordings";
  return LABELS[key] || key;
}

function str(val) {
  return String(val ?? "").trim();
}

function normalizePaymentMethod(method) {
  const m = str(method).toLowerCase();
  if (m === "card") return "Card";
  if (m === "bank account" || m === "bank") return "Bank account";
  return str(method);
}

function collectFormData(body) {
  const fd = { ...(body?.formData || {}) };
  if (body?.phoneNumber) fd.phoneNumber = body.phoneNumber;
  if (body?.fullName && !fd.firstName) {
    const parts = str(body.fullName).split(/\s+/);
    fd.firstName = parts[0] || "";
    fd.lastName = parts.slice(1).join(" ");
  }
  return fd;
}

/**
 * @param {object} body - POST body shape (agentId, unit, team, device, client, formData, ...)
 * @param {object} opts - { hasCatalog }
 */
function validateSaleSubmitPayload(body, opts = {}) {
  const errors = [];
  const fd = collectFormData(body);
  const hasCatalog = opts.hasCatalog !== false;

  for (const key of TOP_LEVEL_REQUIRED) {
    if (key === "client" && !hasCatalog) continue;
    if (key === "device" && hasCatalog && body?.device) continue;
    const val = key === "device" ? body?.device || fd.deviceType : body?.[key];
    if (!str(val)) {
      errors.push({ key, label: labelFor(key), message: `${labelFor(key)} is required` });
    }
  }

  if (hasCatalog) {
    if (!str(body?.salesClientId || fd.salesClientId)) {
      errors.push({ key: "salesClientId", label: "Client", message: "Select client from catalog" });
    }
    if (!str(body?.salesProductId || fd.salesProductId)) {
      errors.push({ key: "salesProductId", label: "Device", message: "Select device from catalog" });
    }
    if (!str(body?.salesPriceId || fd.salesPriceId)) {
      errors.push({ key: "salesPriceId", label: "Price", message: "Select price from catalog" });
    }
  }

  if (!str(body?.closerId)) {
    errors.push({ key: "closerId", label: "Closer", message: "Closer is required" });
  }

  for (const key of REQUIRED_ON_SUBMIT) {
    if (!str(fd[key])) {
      errors.push({ key, label: labelFor(key), message: `${labelFor(key)} is required` });
    }
  }

  if (str(fd.firstTimeDevice).toLowerCase() === "no" && !str(fd.serviceActiveInfo)) {
    errors.push({
      key: "serviceActiveInfo",
      label: labelFor("serviceActiveInfo"),
      message: "Service active / company name is required when not first-time device",
    });
  }

  const method = normalizePaymentMethod(fd.paymentMethod);
  if (method === "Card") {
    for (const key of ["cardNumber", "cardExpDate", "cvv"]) {
      if (!str(fd[key])) {
        errors.push({ key, label: labelFor(key), message: `${labelFor(key)} is required for Card payment` });
      }
    }
  }
  if (method === "Bank account") {
    for (const key of ["routingNumber", "bankName", "bankAccountNumber"]) {
      if (!str(fd[key])) {
        errors.push({ key, label: labelFor(key), message: `${labelFor(key)} is required for Bank account payment` });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  REQUIRED_ON_SUBMIT,
  TOP_LEVEL_REQUIRED,
  validateSaleSubmitPayload,
  labelFor,
};

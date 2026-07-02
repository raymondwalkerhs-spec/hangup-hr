const NATIONALITY_SUGGESTIONS = [
  "Egyptian",
  "Sudanese",
  "Ethiopian",
  "Eritrean",
  "South Sudanese",
  "Syrian",
  "Yemeni",
  "Jordanian",
  "Palestinian",
  "Lebanese",
  "Iraqi",
  "Moroccan",
  "Tunisian",
  "Algerian",
  "Libyan",
];

const NATIONALITY_ALIASES = {
  egyptain: "Egyptian",
  egypt: "Egyptian",
  sudan: "Sudanese",
  ethiopia: "Ethiopian",
  eritrea: "Eritrean",
  "south sudan": "South Sudanese",
  "south sudanese": "South Sudanese",
};

function normalizeNationality(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (NATIONALITY_ALIASES[lower]) return NATIONALITY_ALIASES[lower];
  const exact = NATIONALITY_SUGGESTIONS.find((n) => n.toLowerCase() === lower);
  return exact || raw;
}

const WORK_PERMIT_OPTIONS = [
  { value: "have_permit", label: "Have permit" },
  { value: "no_permit", label: "Don't have permit" },
];

const INSURANCE_STATUS_OPTIONS = [
  { value: "insured", label: "Insured" },
  { value: "not_insured", label: "Not insured" },
];

function isEgyptianNationality(nationality) {
  const n = normalizeNationality(nationality).toLowerCase();
  return n === "egyptian" || n === "egyptain" || n === "egypt";
}

function sanitizeEmployeeComplianceFields(emp) {
  const out = { ...emp };
  const nationality = normalizeNationality(out.nationality);
  out.nationality = nationality || null;

  if (isEgyptianNationality(nationality)) {
    out.work_permit = null;
    const status = String(out.insurance_status || "").trim();
    out.insurance_status = status === "insured" || status === "not_insured" ? status : null;
    if (out.insurance_status !== "insured") {
      out.insurance_type = null;
      out.insurance_amount = null;
      out.insurance_employee_deduction = null;
    } else {
      out.insurance_type = String(out.insurance_type || "").trim() || null;
      out.insurance_amount =
        out.insurance_amount != null && out.insurance_amount !== ""
          ? Number(out.insurance_amount)
          : null;
      out.insurance_employee_deduction =
        out.insurance_employee_deduction != null && out.insurance_employee_deduction !== ""
          ? Number(out.insurance_employee_deduction)
          : null;
    }
  } else if (nationality) {
    out.insurance_status = null;
    out.insurance_type = null;
    out.insurance_amount = null;
    out.insurance_employee_deduction = null;
    const permit = String(out.work_permit || "").trim();
    out.work_permit = permit === "have_permit" || permit === "no_permit" ? permit : null;
  } else {
    out.work_permit = null;
    out.insurance_status = null;
    out.insurance_type = null;
    out.insurance_amount = null;
    out.insurance_employee_deduction = null;
  }

  return out;
}

function workPermitLabel(value) {
  return WORK_PERMIT_OPTIONS.find((o) => o.value === value)?.label || value || "—";
}

function insuranceStatusLabel(value) {
  return INSURANCE_STATUS_OPTIONS.find((o) => o.value === value)?.label || value || "—";
}

module.exports = {
  NATIONALITY_SUGGESTIONS,
  NATIONALITY_ALIASES,
  WORK_PERMIT_OPTIONS,
  INSURANCE_STATUS_OPTIONS,
  normalizeNationality,
  isEgyptianNationality,
  sanitizeEmployeeComplianceFields,
  workPermitLabel,
  insuranceStatusLabel,
};

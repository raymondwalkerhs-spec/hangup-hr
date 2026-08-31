/**
 * Shared person-name / phone validators for Checks + RPM forms.
 */
function digitsOnlyPhone(raw) {
  return String(raw || "").replace(/\D/g, "");
}

function validateDigitsPhone(raw, { required = true, label = "Phone" } = {}) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    if (!required) return { ok: true, value: "" };
    return { ok: false, message: `${label} is required` };
  }
  if (/[A-Za-z]/.test(trimmed)) {
    return { ok: false, message: `${label} must be numbers only` };
  }
  const digits = digitsOnlyPhone(trimmed);
  if (!digits) {
    return { ok: false, message: `${label} must contain digits` };
  }
  return { ok: true, value: digits };
}

/** Letters, spaces, hyphen, apostrophe — no digits. */
function validatePersonName(raw, { required = true, label = "Full name" } = {}) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    if (!required) return { ok: true, value: "" };
    return { ok: false, message: `${label} is required` };
  }
  if (/\d/.test(trimmed)) {
    return { ok: false, message: `${label} must contain letters only (no numbers)` };
  }
  if (!/^[A-Za-z][A-Za-z\s'-]*$/.test(trimmed)) {
    return { ok: false, message: `${label} must contain letters only` };
  }
  return { ok: true, value: trimmed };
}

module.exports = {
  digitsOnlyPhone,
  validateDigitsPhone,
  validatePersonName,
};

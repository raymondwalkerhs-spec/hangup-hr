/**
 * Required-field validation for RPM sale submit.
 */
const catalog = require("./sales-rpm-field-catalog");

const REQUIRED_SUBMIT_KEYS = [
  "client",
  "fullName",
  "phoneNumber",
  "alternativePhone",
  "dateOfBirth",
  "memberId",
  "email",
  "address",
  "gender",
  "medicalConditions",
  "emergencyFullName",
  "emergencyPhone",
  "emergencyRelation",
];

function validateRpmSaleSubmitPayload(body = {}) {
  const fd = body.formData || body;
  const errors = [];
  for (const key of REQUIRED_SUBMIT_KEYS) {
    const field = catalog.getFieldDef(key);
    const val = fd[key] ?? body[key];
    if (key === "medicalConditions") {
      const list = Array.isArray(val) ? val : String(val || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!list.length) errors.push({ field: key, message: "Select at least one medical condition" });
      continue;
    }
    if (val == null || String(val).trim() === "") {
      errors.push({ field: key, message: `${field?.label || key} is required` });
    }
  }
  const memberRaw = fd.memberId ?? body.memberId;
  if (memberRaw != null && String(memberRaw).trim() !== "") {
    const memberCheck = require("./rpm-member-id").validateMemberId(memberRaw);
    if (!memberCheck.ok) errors.push({ field: "memberId", message: memberCheck.message });
  }
  if (!body.agentId) errors.push({ field: "agentId", message: "Agent is required" });
  if (!body.closerId && !body.formData?.closerId) {
    errors.push({ field: "closerId", message: "Closer is required" });
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

module.exports = { validateRpmSaleSubmitPayload, REQUIRED_SUBMIT_KEYS };

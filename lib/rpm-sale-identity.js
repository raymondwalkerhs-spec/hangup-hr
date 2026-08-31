/**
 * RPM sale identity helpers — phones (main + alt) and member ID for duplicate checks.
 */

const { stripMemberId } = require("./rpm-member-id");

function normalizePhoneDigits(phone) {
  return String(phone || "").replace(/\D/g, "").slice(-10);
}

function collectRpmSalePhones(saleOrRow) {
  const fd =
    (saleOrRow && saleOrRow.formData) ||
    (saleOrRow && saleOrRow.form_data && typeof saleOrRow.form_data === "object" ? saleOrRow.form_data : {}) ||
    {};
  const raw = [
    saleOrRow?.phoneNumber,
    saleOrRow?.phone_number,
    fd.phoneNumber,
    fd.alternativePhone,
    fd.alternativePhoneNumber,
    fd.altPhone,
    fd.alt_phone,
  ];
  const out = [];
  const seen = new Set();
  for (const p of raw) {
    const n = normalizePhoneDigits(p);
    if (n.length >= 7 && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

function normalizeMemberIdKey(raw) {
  return stripMemberId(raw || "");
}

function clientFeedbackLabel(sale) {
  const fd = sale.formData || sale.form_data || {};
  const cf = String(fd.clientFeedback || sale.feedback || "").trim();
  if (cf) return cf;
  const st = String(sale.status || "").toLowerCase();
  if (st === "pending") return "Pending";
  if (st === "passed") return "Approved";
  if (st === "denied") return "Denied";
  return st || "Pending";
}

function saleDateLabel(sale) {
  return (
    String(sale.workingDay || sale.working_day || "").slice(0, 10) ||
    String(sale.submissionDate || sale.submission_date || "").slice(0, 10) ||
    String(sale.createdAt || sale.created_at || "").slice(0, 10) ||
    "—"
  );
}

function formatDuplicatePriorSummary(priors = []) {
  if (!priors.length) return "";
  return priors
    .map((s) => `${saleDateLabel(s)} (${clientFeedbackLabel(s)})`)
    .join("; ");
}

function phonesOverlap(a, b) {
  const setB = new Set(b);
  return a.some((p) => setB.has(p));
}

function duplicateGroupKey(sale) {
  const phones = collectRpmSalePhones(sale);
  const mid = normalizeMemberIdKey(sale.memberId || sale.member_id || sale.formData?.memberId);
  const phonePart = phones.slice().sort().join("|") || "_";
  const midPart = mid || "_";
  return `p:${phonePart}|m:${midPart}`;
}

module.exports = {
  normalizePhoneDigits,
  collectRpmSalePhones,
  normalizeMemberIdKey,
  clientFeedbackLabel,
  saleDateLabel,
  formatDuplicatePriorSummary,
  phonesOverlap,
  duplicateGroupKey,
};

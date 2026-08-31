/** Canonical RPM check + Q Feedback status values. */

const CHECK_STATUSES = ["q", "nq", "age_limit", "under_age", "duplicate"];
const FEEDBACK_STATUSES = [
  "dropped_with_client",
  "callback",
  "not_int",
  "retransfer",
  "sale",
];
/** Manual Q Feedback dispositions (Sale is auto-only). */
const MANUAL_FEEDBACK_STATUSES = [
  "dropped_with_client",
  "callback",
  "not_int",
  "retransfer",
];
const EDITABLE_FEEDBACK_STATUSES = ["callback", "not_int", "retransfer"];

const CHECK_STATUS_LABELS = {
  q: "Q",
  nq: "NQ",
  age_limit: "Age limit",
  under_age: "Under Age",
  duplicate: "Duplicate",
};

const FEEDBACK_STATUS_LABELS = {
  dropped_with_client: "Dropped with Client",
  callback: "CallBack",
  not_int: "Not Int",
  retransfer: "Retransfer",
  sale: "Sale",
};

function normalizeCheckStatus(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (CHECK_STATUSES.includes(s)) return s;
  if (s === "agelimit" || s === "age") return "age_limit";
  if (s === "underage" || s === "under_age") return "under_age";
  if (s === "dup") return "duplicate";
  return null;
}

function normalizeFeedbackStatus(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!s) return null;
  if (FEEDBACK_STATUSES.includes(s)) return s;
  if (s === "dropped" || s === "dropped_with_client" || s === "droppedwithclient") {
    return "dropped_with_client";
  }
  if (s === "call_back" || s === "callback") return "callback";
  if (s === "notint" || s === "not_interested" || s === "not_int") return "not_int";
  if (s === "re_transfer" || s === "retransfer") return "retransfer";
  return null;
}

function isTerminalFeedback(status) {
  return status === "dropped_with_client" || status === "sale";
}

function canManuallySetFeedback(status) {
  return MANUAL_FEEDBACK_STATUSES.includes(status);
}

const NQ_FAMILY_STATUSES = ["nq", "age_limit", "under_age", "duplicate"];

/** Total Checks = Q + NQ + Age limit + Under Age + Duplicate. */
function countsTowardTotalChecks(checkStatus) {
  return checkStatus === "q" || isNqFamilyCheck(checkStatus);
}

function isNqFamilyCheck(status) {
  return NQ_FAMILY_STATUSES.includes(String(status || "").trim());
}

module.exports = {
  CHECK_STATUSES,
  FEEDBACK_STATUSES,
  MANUAL_FEEDBACK_STATUSES,
  EDITABLE_FEEDBACK_STATUSES,
  CHECK_STATUS_LABELS,
  FEEDBACK_STATUS_LABELS,
  NQ_FAMILY_STATUSES,
  normalizeCheckStatus,
  normalizeFeedbackStatus,
  isTerminalFeedback,
  canManuallySetFeedback,
  countsTowardTotalChecks,
  isNqFamilyCheck,
};

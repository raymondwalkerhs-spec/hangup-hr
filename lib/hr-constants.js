/** Fixed team list for employee edit / add-agent flows. */
const TEAM_OPTIONS = [
  "Back-End",
  "Daemon",
  "Steven",
  "Justin",
  "Ayla",
  "Tris",
  "Jude",
  "HR",
  "Quality",
  "_____",
];

const CASH_BRANCHES = ["Makram", "Abbas", "Square", "Other"];

/** Canonical employee/payroll payment method keys (stored in DB). */
const PAYMENT_METHOD_KEYS = ["cash", "instapay", "bank"];

/** Filter sentinel for employees/payroll with no payment method set. */
const PAYMENT_METHOD_NONE = "__none__";

const PAYMENT_METHOD_OPTIONS = [
  { value: "instapay", label: "Instapay / Wallet" },
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank Account" },
];

const PAYMENT_METHOD_FILTER_OPTIONS = [
  { value: PAYMENT_METHOD_NONE, label: "No payment method" },
  ...PAYMENT_METHOD_OPTIONS,
];

const TL_BONUS_TYPE = "Bonus from TL / OP";

function normalizePaymentMethodValue(method) {
  const m = String(method || "").trim().toLowerCase();
  if (!m) return "";
  if (m.includes("insta") || m.includes("wallet") || m.includes("instapay")) return "instapay";
  if (m.includes("cash")) return "cash";
  if (m.includes("bank")) return "bank";
  return "";
}

function resolvePaymentMethod(emp, profile) {
  return (
    normalizePaymentMethodValue(emp?.payment_method || emp?.paymentMethod) ||
    normalizePaymentMethodValue(profile?.paymentMethod || profile?.payment_method) ||
    ""
  );
}

function paymentMethodLabel(method) {
  const key = normalizePaymentMethodValue(method);
  const opt = PAYMENT_METHOD_OPTIONS.find((o) => o.value === key);
  return opt?.label || (key ? key : "");
}

/** Export grouping key used by bank CSV/PDF routes (`insta` not `instapay`). */
function paymentMethodExportKey(method) {
  const key = normalizePaymentMethodValue(method);
  if (key === "instapay") return "insta";
  if (key === "cash" || key === "bank") return key;
  return "other";
}

module.exports = {
  TEAM_OPTIONS,
  CASH_BRANCHES,
  PAYMENT_METHOD_KEYS,
  PAYMENT_METHOD_NONE,
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_METHOD_FILTER_OPTIONS,
  TL_BONUS_TYPE,
  normalizePaymentMethodValue,
  resolvePaymentMethod,
  paymentMethodLabel,
  paymentMethodExportKey,
};

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

const PAYMENT_METHOD_OPTIONS = [
  { value: "Instapay / Wallet", label: "Instapay / Wallet" },
  { value: "Cash", label: "Cash" },
  { value: "Bank Account", label: "Bank Account" },
];

const TL_BONUS_TYPE = "Bonus from TL / OP";

function normalizePaymentMethodValue(method) {
  const m = String(method || "").trim().toLowerCase();
  if (!m) return "";
  if (m.includes("insta") || m.includes("wallet") || m.includes("instapay")) {
    return "Instapay / Wallet";
  }
  if (m.includes("cash")) return "Cash";
  if (m.includes("bank")) return "Bank Account";
  return method;
}

module.exports = {
  TEAM_OPTIONS,
  CASH_BRANCHES,
  PAYMENT_METHOD_OPTIONS,
  TL_BONUS_TYPE,
  normalizePaymentMethodValue,
};

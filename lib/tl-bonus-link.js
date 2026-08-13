const TL_RECIPIENT_RE = /(?:^|\s)TL bonus paid to\s+(\S+)/i;
const TL_SOURCE_RE = /\(deducted from\s+(\S+)\)/i;

function formatTlDeductionReason(reason, employeeId) {
  const recipient = String(employeeId || "").trim();
  const base = String(reason || "").trim().replace(/\s*—?\s*TL bonus paid to\s+\S+\s*$/i, "").trim();
  if (!recipient) return base || "TL bonus";
  if (base) return `${base} — TL bonus paid to ${recipient}`;
  return `TL bonus paid to ${recipient}`;
}

function parseTlBonusRecipientFromReason(reason) {
  const m = String(reason || "").match(TL_RECIPIENT_RE);
  return m ? m[1] : "";
}

function parseTlBonusSourceFromReason(reason) {
  const m = String(reason || "").match(TL_SOURCE_RE);
  return m ? m[1] : "";
}

function findPairedBonusForDeduction(d, bonuses) {
  if (!d || d.type !== "Bonus from TL / OP") return null;
  const amount = Number(d.amount);
  const date = String(d.date || "");
  const deductFromId = String(d.employeeId || "");
  return (
    (bonuses || []).find((b) => {
      if (b.type !== "Bonus from TL / OP") return false;
      if (Number(b.amount) !== amount) return false;
      if (String(b.date || "") !== date) return false;
      return parseTlBonusSourceFromReason(b.reason) === deductFromId;
    }) || null
  );
}

module.exports = {
  formatTlDeductionReason,
  parseTlBonusRecipientFromReason,
  parseTlBonusSourceFromReason,
  findPairedBonusForDeduction,
};

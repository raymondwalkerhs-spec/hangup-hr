/**
 * Who may appear in "Deduct from (TL/OP pays)" for Bonus from TL / OP.
 * Mirrors lib/employee-ids.js isBonusTransferPayerId.
 */
export function isBonusTransferPayerId(id: string | undefined | null): boolean {
  const s = String(id || "").trim().toUpperCase();
  if (!s) return false;
  if (/^(TL|CL|OP|HR|RTM|IT|Q)(-?\d+)?$/i.test(s)) return true;
  if (/^O\d+$/i.test(s)) return true;
  return false;
}

/** @deprecated Prefer isBonusTransferPayerId for deduct-from pickers */
export function isLeadershipEmployeeId(id: string | undefined | null): boolean {
  return isBonusTransferPayerId(id) || /^(TL|CL|OP|HR)/i.test(String(id || "").trim());
}

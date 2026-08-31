/** Client copy of lib/rpm-member-id.js — keep in sync. */

const BANNED = new Set(["L", "O", "B", "I", "Z", "S"]);
const PATTERN = ["N", "L", "A", "N", "L", "A", "N", "L", "L", "N", "N"] as const;

function isDigit(c: string) {
  return c >= "0" && c <= "9";
}
function isAllowedLetter(c: string) {
  return c >= "A" && c <= "Z" && !BANNED.has(c);
}
function isAllowedAlnum(c: string) {
  return isDigit(c) || isAllowedLetter(c);
}

export function stripMemberId(raw: string): string {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 11);
}

export function formatMemberId(raw: string): string {
  const s = stripMemberId(raw);
  const a = s.slice(0, 4);
  const b = s.slice(4, 7);
  const c = s.slice(7, 11);
  if (s.length <= 4) return a;
  if (s.length <= 7) return `${a}-${b}`;
  return `${a}-${b}-${c}`;
}

function groupedCaretFromStripped(strippedIndex: number) {
  const i = Math.max(0, Math.min(11, strippedIndex));
  if (i <= 4) return i;
  if (i <= 7) return i + 1;
  return i + 2;
}

export function applyMemberIdInput(nextRaw: string, caretInNext: number) {
  const next = String(nextRaw || "");
  const strippedBefore = stripMemberId(next.slice(0, caretInNext));
  return {
    display: formatMemberId(next),
    stored: stripMemberId(next),
    caret: groupedCaretFromStripped(strippedBefore.length),
  };
}

function slotReason(slot: string, displayPos: number) {
  if (slot === "N") return `Character ${displayPos} must be a digit`;
  if (slot === "L") return `Character ${displayPos} must be a letter (not L,O,B,I,Z,S)`;
  return `Character ${displayPos} must be a digit or letter (not L,O,B,I,Z,S)`;
}

export function validateMemberId(
  raw: string,
  opts: { required?: boolean } = {}
): { ok: boolean; message?: string; value?: string; display?: string } {
  const s = stripMemberId(raw);
  if (!s) {
    if (opts.required === false) return { ok: true, value: "", display: "" };
    return { ok: false, message: "Member ID is required" };
  }
  if (s.length !== 11) {
    return { ok: false, message: "Wrong MCN" };
  }
  for (let i = 0; i < 11; i++) {
    const c = s[i];
    const slot = PATTERN[i];
    if (slot === "N" && !isDigit(c)) return { ok: false, message: "Wrong MCN" };
    if (slot === "L" && !isAllowedLetter(c)) return { ok: false, message: "Wrong MCN" };
    if (slot === "A" && !isAllowedAlnum(c)) return { ok: false, message: "Wrong MCN" };
  }
  return { ok: true, value: s, display: formatMemberId(s) };
}

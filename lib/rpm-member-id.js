/** RPM Member ID: 11 chars, display XXXX-XXX-XXXX, pattern NLAN-LAN-LLNN. */

const BANNED = new Set(["L", "O", "B", "I", "Z", "S"]);
const PATTERN = ["N", "L", "A", "N", "L", "A", "N", "L", "L", "N", "N"];

function isDigit(c) {
  return c >= "0" && c <= "9";
}

function isAllowedLetter(c) {
  return c >= "A" && c <= "Z" && !BANNED.has(c);
}

function isAllowedAlnum(c) {
  return isDigit(c) || isAllowedLetter(c);
}

function stripMemberId(raw) {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 11);
}

function formatMemberId(raw) {
  const s = stripMemberId(raw);
  const a = s.slice(0, 4);
  const b = s.slice(4, 7);
  const c = s.slice(7, 11);
  if (s.length <= 4) return a;
  if (s.length <= 7) return a + "-" + b;
  return a + "-" + b + "-" + c;
}

function groupedCaretFromStripped(strippedIndex) {
  const i = Math.max(0, Math.min(11, strippedIndex));
  if (i <= 4) return i;
  if (i <= 7) return i + 1;
  return i + 2;
}

function strippedCaretFromGrouped(formatted, caret) {
  const s = String(formatted || "");
  const pos = Math.max(0, Math.min(s.length, caret));
  let n = 0;
  for (let i = 0; i < pos; i++) {
    if (/[A-Z0-9]/i.test(s[i])) n += 1;
  }
  return n;
}

function applyMemberIdInput(nextRaw, caretInNext) {
  const next = String(nextRaw || "");
  const strippedBefore = stripMemberId(next.slice(0, caretInNext));
  const formatted = formatMemberId(next);
  return {
    display: formatted,
    stored: stripMemberId(next),
    caret: groupedCaretFromStripped(strippedBefore.length),
  };
}

function slotReason(slot, displayPos) {
  if (slot === "N") return `Character ${displayPos} must be a digit`;
  if (slot === "L") return `Character ${displayPos} must be a letter (not L,O,B,I,Z,S)`;
  return `Character ${displayPos} must be a digit or letter (not L,O,B,I,Z,S)`;
}

function validateMemberId(raw, { required = true } = {}) {
  const s = stripMemberId(raw);
  if (!s) {
    if (!required) return { ok: true, value: "", display: "" };
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

module.exports = {
  BANNED,
  PATTERN,
  stripMemberId,
  formatMemberId,
  validateMemberId,
  applyMemberIdInput,
  groupedCaretFromStripped,
  strippedCaretFromGrouped,
};

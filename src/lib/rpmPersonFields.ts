/** Client copy of lib/rpm-person-fields.js — keep in sync. */

export function digitsOnlyPhone(raw: string) {
  return String(raw || "").replace(/\D/g, "");
}

export function validateDigitsPhone(
  raw: string,
  opts: { required?: boolean; label?: string } = {}
): { ok: boolean; message?: string; value?: string } {
  const label = opts.label || "Phone";
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    if (opts.required === false) return { ok: true, value: "" };
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

export function validatePersonName(
  raw: string,
  opts: { required?: boolean; label?: string } = {}
): { ok: boolean; message?: string; value?: string } {
  const label = opts.label || "Full name";
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    if (opts.required === false) return { ok: true, value: "" };
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

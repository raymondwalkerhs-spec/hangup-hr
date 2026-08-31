/** Client helpers for RPM phone digits + flexible DOB paste. */

export function digitsOnlyPhone(raw: string): string {
  return String(raw || "").replace(/\D/g, "");
}

function pad2(n: number | string) {
  return String(n).padStart(2, "0");
}

/** Parse common pasted DOB strings into YYYY-MM-DD for <input type="date">. */
export function parseFlexibleIsoDate(raw: string): string | null {
  const t = String(raw || "").trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;

  let m = t.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (m) {
    const y = m[1];
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad2(mo)}-${pad2(d)}`;
  }

  m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = m[3];
    if (a > 12 && b >= 1 && b <= 12) return `${y}-${pad2(b)}-${pad2(a)}`;
    if (b > 12 && a >= 1 && a <= 12) return `${y}-${pad2(a)}-${pad2(b)}`;
    if (a >= 1 && a <= 12 && b >= 1 && b <= 31) return `${y}-${pad2(a)}-${pad2(b)}`;
  }

  return null;
}

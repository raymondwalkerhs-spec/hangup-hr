/**
 * Calendar-day helpers (YYYY-MM-DD only).
 * Never use Date#toISOString().slice(0,10) for hire/probation/depart/training weeks —
 * that shifts days across timezones. Use UTC calendar math for date arithmetic and
 * egyptTodayDate() for "today" in business timezone.
 */

function parseIsoDate(value) {
  if (!value) return "";
  const s = String(value).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function compareIsoDates(a, b) {
  const aa = parseIsoDate(a);
  const bb = parseIsoDate(b);
  if (!aa || !bb) return 0;
  if (aa < bb) return -1;
  if (aa > bb) return 1;
  return 0;
}

function isAfterIsoDate(date, pivot) {
  return compareIsoDates(date, pivot) > 0;
}

function isOnOrBeforeIsoDate(date, pivot) {
  const c = compareIsoDates(date, pivot);
  return c <= 0;
}

/** Parse YYYY-MM-DD as a UTC calendar day (noon not needed; midnight UTC is fine). */
function utcMsFromIsoDate(value) {
  const s = parseIsoDate(value);
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function formatUtcIsoDate(ms) {
  if (ms == null || Number.isNaN(ms)) return "";
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Add whole calendar days to a YYYY-MM-DD string (timezone-safe). */
function addCalendarDays(dateStr, days) {
  const ms = utcMsFromIsoDate(dateStr);
  if (ms == null) return "";
  const n = Number(days);
  if (!Number.isFinite(n)) return parseIsoDate(dateStr);
  return formatUtcIsoDate(ms + Math.trunc(n) * 86400000);
}

/** Monday (ISO week) containing dateStr. */
function mondayOfWeek(dateStr) {
  const ms = utcMsFromIsoDate(dateStr);
  if (ms == null) return "";
  const dow = new Date(ms).getUTCDay(); // 0=Sun … 6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  return formatUtcIsoDate(ms + diff * 86400000);
}

/** Friday of the week containing dateStr (or of the Monday if already Monday). */
function fridayOfWeek(dateStr) {
  const mon = mondayOfWeek(dateStr);
  if (!mon) return "";
  return addCalendarDays(mon, 4);
}

/**
 * Business "today" as YYYY-MM-DD in Africa/Cairo.
 * Prefer this over UTC ISO slice for hire defaults and depart status.
 */
function todayLocalIsoDate(date = new Date()) {
  try {
    return require("./egypt-datetime").egyptTodayDate(date);
  } catch {
    return formatUtcIsoDate(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  }
}

module.exports = {
  parseIsoDate,
  compareIsoDates,
  isAfterIsoDate,
  isOnOrBeforeIsoDate,
  addCalendarDays,
  mondayOfWeek,
  fridayOfWeek,
  todayLocalIsoDate,
  formatUtcIsoDate,
  utcMsFromIsoDate,
};

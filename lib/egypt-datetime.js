/** Date/time helpers for Africa/Cairo (Egypt local). */

function partsInCairo(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return Object.fromEntries(fmt.formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
}

/** YYYY-MM-DD HH:mm:ss in Egypt local time */
function egyptNowFormatted(date = new Date()) {
  const p = partsInCairo(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** YYYY-MM-DD portion in Egypt local time */
function egyptTodayDate(date = new Date()) {
  const p = partsInCairo(date);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Human-readable display for forms */
function egyptNowDisplay(date = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

/** YYYY-MM-DDTHH:mm in Egypt local time (datetime-local inputs). */
function egyptDateTimeLocal(date = new Date()) {
  const p = partsInCairo(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const CAIRO_WALL = new Intl.DateTimeFormat("en-US", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function cairoWallAsUtcMs(ms) {
  const p = {};
  for (const part of CAIRO_WALL.formatToParts(new Date(ms))) {
    if (part.type !== "literal") p[part.type] = part.value;
  }
  let hour = parseInt(p.hour, 10);
  if (hour === 24) hour = 0;
  return Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    hour,
    Number(p.minute),
    Number(p.second)
  );
}

/**
 * Portal stores date + time as Africa/Cairo wall clock (not UTC).
 * Airtable dateTime fields are UTC instants; tagging Cairo 14:30 as Z made
 * Cairo clients see +3 hours. Convert the local wall time to a real UTC ISO.
 */
function cairoLocalToUtcIso(dateVal, timeVal) {
  const date = String(dateVal || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const tm = String(timeVal || "12:00:00").trim();
  const m = tm.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const hour = m ? parseInt(m[1], 10) : 12;
  const minute = m ? parseInt(m[2], 10) : 0;
  const second = m && m[3] != null ? parseInt(m[3], 10) : 0;
  const [year, month, day] = date.split("-").map(Number);
  const want = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = want;
  for (let i = 0; i < 4; i += 1) {
    const diff = cairoWallAsUtcMs(guess) - want;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess).toISOString();
}

module.exports = {
  egyptNowFormatted,
  egyptTodayDate,
  egyptNowDisplay,
  egyptDateTimeLocal,
  partsInCairo,
  cairoLocalToUtcIso,
};

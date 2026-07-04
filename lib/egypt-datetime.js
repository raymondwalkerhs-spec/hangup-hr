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

module.exports = {
  egyptNowFormatted,
  egyptTodayDate,
  egyptNowDisplay,
  partsInCairo,
};

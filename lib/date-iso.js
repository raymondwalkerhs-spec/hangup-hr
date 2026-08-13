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

module.exports = {
  parseIsoDate,
  compareIsoDates,
  isAfterIsoDate,
  isOnOrBeforeIsoDate,
};

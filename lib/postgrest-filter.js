/** Sanitize values embedded in PostgREST `.or()` / filter strings. */
function sanitizePostgrestFilterValue(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  if (!/^[a-zA-Z0-9._-]+$/.test(s)) {
    throw new Error("Invalid filter value");
  }
  return s;
}

module.exports = { sanitizePostgrestFilterValue };

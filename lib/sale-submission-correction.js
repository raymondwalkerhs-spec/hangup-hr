/**
 * Privileged correction of MLA/RPM submission timestamp.
 * Values are stored as Cairo-local date + time; APIs expose a combined submissionDate.
 */

const { normalizeRole } = require("./roles");

function canCorrectSubmissionDate(userRole) {
  const role = normalizeRole(userRole?.role);
  return role === "admin" || role === "ceo" || role === "rtm";
}

/** @deprecated Use canCorrectSubmissionDate */
function canCorrectRpmSubmissionDate(userRole) {
  return canCorrectSubmissionDate(userRole);
}

function normalizeSubmissionDateTime(value) {
  const raw = String(value || "").trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) {
    throw new Error("Submission date and time must use YYYY-MM-DD HH:mm");
  }

  const [, year, month, day, hour, minute, second = "00"] = m;
  const check = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  );
  if (
    check.getUTCFullYear() !== Number(year) ||
    check.getUTCMonth() !== Number(month) - 1 ||
    check.getUTCDate() !== Number(day) ||
    check.getUTCHours() !== Number(hour) ||
    check.getUTCMinutes() !== Number(minute) ||
    check.getUTCSeconds() !== Number(second)
  ) {
    throw new Error("Submission date and time is invalid");
  }

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

module.exports = {
  canCorrectSubmissionDate,
  canCorrectRpmSubmissionDate,
  normalizeSubmissionDateTime,
};

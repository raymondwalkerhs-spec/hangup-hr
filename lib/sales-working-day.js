/**
 * Sales working-day rules — shift ends midnight Cairo; grace until 1:00 AM counts as previous day.
 */
const egyptDatetime = require("./egypt-datetime");

function parseSubmissionParts(submissionDate) {
  const raw = String(submissionDate || "").trim();
  if (!raw) {
    const now = egyptDatetime.egyptNowFormatted();
    return splitDateTime(now);
  }
  if (raw.includes("T")) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      const fmt = egyptDatetime.egyptNowFormatted(d);
      return splitDateTime(fmt);
    }
  }
  return splitDateTime(raw);
}

function splitDateTime(fmt) {
  const m = String(fmt || "").match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) {
    const today = egyptDatetime.egyptTodayDate();
    return { date: today, hour: 12, minute: 0, second: 0, time: "12:00:00" };
  }
  const hour = m[2] != null ? parseInt(m[2], 10) : 12;
  const minute = m[3] != null ? parseInt(m[3], 10) : 0;
  const second = m[4] != null ? parseInt(m[4], 10) : 0;
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  return { date: m[1], hour, minute, second, time };
}

function addDays(isoDate, delta) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Working day for payroll/dashboards (Cairo). 00:00–00:59 → previous calendar day. */
function computeWorkingDay(submissionDate) {
  const parts = parseSubmissionParts(submissionDate);
  if (parts.hour < 1) return addDays(parts.date, -1);
  return parts.date;
}

function computeSubmissionTime(submissionDate) {
  return parseSubmissionParts(submissionDate).time;
}

function formatTimeAmPm(timeStr) {
  const m = String(timeStr || "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return timeStr || "";
  let h = parseInt(m[1], 10);
  const mi = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${mi} ${ampm}`;
}

function enrichSaleDates(sale, submissionOverride) {
  const submission = submissionOverride || sale?.submissionDate || egyptDatetime.egyptNowFormatted();
  const workingDay = computeWorkingDay(submission);
  const submissionTime = computeSubmissionTime(submission);
  return {
    submissionDate: submission,
    workingDay,
    submissionTime,
    effectiveDate: sale?.effectiveDate || workingDay,
  };
}

module.exports = {
  computeWorkingDay,
  computeSubmissionTime,
  parseSubmissionParts,
  formatTimeAmPm,
  enrichSaleDates,
};

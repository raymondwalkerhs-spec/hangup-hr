const { isWeekend } = require('./calendar');
const { TRANSPORT_OVERRIDE_STATUSES } = require('./transport');

/** Default transport override when HR has not set one yet. */
const TRANSPORT_DEFAULT_NONE_STATUSES = new Set([
  'Lateness B',
  'Half Day',
  'Quarter Day-Off',
]);

const VALID_ATTENDANCE_STATUSES = new Set([
  'Attended',
  'Day-OFF',
  'Half Day',
  'Quarter Day-Off',
  'WFH',
  'Lateness A',
  'Lateness B',
  'NSNC',
  'NSNC Half Day',
  'Not Approved day off',
  'paused',
  'OUT',
  'OUT BUT STILL GET PAID',
  '(--)',
]);

function normalizeAttendanceRecord(record, options = {}) {
  const normalized = { ...record };
  const date = String(normalized.date || '').slice(0, 10);
  const status = String(normalized.status || '').trim();
  const isWeekendDay = Boolean(date) && isWeekend(date);
  const allowBlankClear = options?.allowBlankClear === true;

  if (!status || status === '(--)') {
    normalized.status = allowBlankClear ? '' : 'Attended';
  } else if (!VALID_ATTENDANCE_STATUSES.has(status)) {
    normalized.status = 'Attended';
  }

  if (status === 'Day-OFF') {
    normalized.isWeekendDefault = isWeekendDay;
    normalized.transportOverride = '';
  } else if (status === 'OUT' || status === 'OUT BUT STILL GET PAID') {
    normalized.isWeekendDefault = false;
    normalized.transportOverride = '';
  } else if (!status && allowBlankClear) {
    normalized.isWeekendDefault = false;
  } else {
    normalized.isWeekendDefault = false;
  }

  if (!['Lateness A', 'Lateness B'].includes(status)) {
    normalized.fpLateness = null;
  }

  if (
    TRANSPORT_OVERRIDE_STATUSES.has(normalized.status) &&
    TRANSPORT_DEFAULT_NONE_STATUSES.has(normalized.status) &&
    !String(normalized.transportOverride || '').trim()
  ) {
    normalized.transportOverride = 'none';
  }

  return normalized;
}

/** True when the user explicitly chose a real attendance status (not blank / null marker). */
function hasExplicitManualStatus(status) {
  const s = String(status || '').trim();
  return Boolean(s && s !== '(--)');
}

/**
 * Manual grid edits must override FP-import metadata. Clears fpNotes / fpLateness
 * when the user sets a real status so missed FP days can be filled in and FP rows
 * can be corrected without stale fp_notes blocking persistence or protection.
 */
function applyManualAttendanceOverride(record, prior) {
  const status = String(record.status || '').trim();
  if (!hasExplicitManualStatus(status)) return { ...record };

  const next = {
    ...record,
    fpNotes: '',
    fpLateness:
      status === 'Lateness A' || status === 'Lateness B'
        ? record.fpLateness != null
          ? record.fpLateness
          : true
        : null,
  };

  // Drop leaveNote that was only echoing FP notes unless the edit carried a new note.
  const incomingLeave = String(record.leaveNote || '').trim();
  const priorLeave = String(prior?.leaveNote || '').trim();
  const priorFp = String(prior?.fpNotes || '').trim();
  if (!incomingLeave && priorLeave && priorLeave === priorFp) {
    next.leaveNote = '';
  }

  return next;
}

module.exports = {
  VALID_ATTENDANCE_STATUSES,
  TRANSPORT_DEFAULT_NONE_STATUSES,
  normalizeAttendanceRecord,
  hasExplicitManualStatus,
  applyManualAttendanceOverride,
};

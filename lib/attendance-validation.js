const { isWeekend } = require('./calendar');

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
]);

function normalizeAttendanceRecord(record, options = {}) {
  const normalized = { ...record };
  const date = String(normalized.date || '').slice(0, 10);
  const status = String(normalized.status || '').trim();
  const isWeekendDay = Boolean(date) && isWeekend(date);
  const allowBlankClear = options?.allowBlankClear === true;

  if (!status) {
    normalized.status = allowBlankClear ? '' : 'Attended';
  } else if (!VALID_ATTENDANCE_STATUSES.has(status)) {
    normalized.status = 'Attended';
  }

  if (status === 'Day-OFF') {
    normalized.isWeekendDefault = isWeekendDay;
    normalized.transportOverride = '';
  } else if (!status && allowBlankClear) {
    normalized.isWeekendDefault = false;
  } else {
    normalized.isWeekendDefault = false;
  }

  if (!['Lateness A', 'Lateness B'].includes(status)) {
    normalized.fpLateness = null;
  }

  return normalized;
}

module.exports = {
  VALID_ATTENDANCE_STATUSES,
  normalizeAttendanceRecord,
};

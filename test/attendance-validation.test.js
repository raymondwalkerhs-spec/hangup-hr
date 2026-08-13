const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAttendanceRecord } = require('../lib/attendance-validation');

test('weekday Day-OFF is preserved when explicitly selected', () => {
  const record = normalizeAttendanceRecord({ employeeId: 'HS1-05', date: '2026-07-03', status: 'Day-OFF' });
  assert.equal(record.status, 'Day-OFF');
  assert.equal(record.isWeekendDefault, false);
});

test('holiday Day-OFF is preserved for a weekday', () => {
  const record = normalizeAttendanceRecord({ employeeId: 'HS1-05', date: '2026-07-03', status: 'Day-OFF', isHoliday: true });
  assert.equal(record.status, 'Day-OFF');
  assert.equal(record.isWeekendDefault, false);
});

test('lateness records without lateness values are normalized', () => {
  const record = normalizeAttendanceRecord({ employeeId: 'HS1-05', date: '2026-06-25', status: 'Lateness A', fpLateness: null });
  assert.equal(record.status, 'Lateness A');
  assert.equal(record.fpLateness, null);
});

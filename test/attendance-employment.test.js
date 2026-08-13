const test = require('node:test');
const assert = require('node:assert/strict');
const { canEditAttendanceDate } = require('../lib/attendance-employment');

test('employment start date is editable when period row starts later than employment_date', () => {
  const employee = { id: 'HS3-18', employment_date: '2026-06-01', depart_date: null };
  const periods = [{ startDate: '2026-06-02', endDate: null, isCurrent: true }];
  const check = canEditAttendanceDate(employee, '2026-06-01', periods);
  assert.equal(check.ok, true);
});

test('days before employment date are blocked when no periods', () => {
  const employee = { id: 'HS3-18', employment_date: '2026-06-01', depart_date: null };
  const check = canEditAttendanceDate(employee, '2026-05-31', []);
  assert.equal(check.ok, false);
  assert.match(check.reason, /before employment date/i);
});

test('days inside an active employment period are allowed', () => {
  const employee = { id: 'HS3-18', employment_date: '2026-06-01', depart_date: null };
  const periods = [{ startDate: '2026-06-01', endDate: null, isCurrent: true }];
  const check = canEditAttendanceDate(employee, '2026-06-01', periods);
  assert.equal(check.ok, true);
});

test('employment date fallback works when no periods exist', () => {
  const employee = { id: 'HS3-18', employment_date: '2026-06-01', depart_date: null };
  const check = canEditAttendanceDate(employee, '2026-06-15', []);
  assert.equal(check.ok, true);
});

test('stale depart_date on Active employee does not block edits when no periods exist', () => {
  const employee = { id: 'HS3-18', employment_date: '2026-06-01', depart_date: '2026-07-15', status: 'Active' };
  const check = canEditAttendanceDate(employee, '2026-07-20', []);
  assert.equal(check.ok, true);
});

test('depart date blocks edits after departure when employee is Out and no periods exist', () => {
  const employee = { id: 'HS3-18', employment_date: '2026-06-01', depart_date: '2026-07-15', status: 'Out' };
  const check = canEditAttendanceDate(employee, '2026-07-20', []);
  assert.equal(check.ok, false);
  assert.match(check.reason, /locked as OUT/i);
});

test('depart day itself is editable even when period ended on that day', () => {
  const employee = { id: 'HS3-18', employment_date: '2026-06-01', depart_date: '2026-07-15', status: 'Out' };
  const periods = [{ startDate: '2026-06-01', endDate: '2026-07-15', isCurrent: false }];
  const check = canEditAttendanceDate(employee, '2026-07-15', periods);
  assert.equal(check.ok, true);
});

test('out status without depart date still allows attendance edits', () => {
  const employee = { id: 'HS3-18', employment_date: '2026-06-01', depart_date: null, status: 'Out' };
  const check = canEditAttendanceDate(employee, '2026-07-10', []);
  assert.equal(check.ok, true);
});

test('out status without depart date blocks before employment date', () => {
  const employee = { id: 'HS3-18', employment_date: '2026-06-01', depart_date: null, status: 'Out' };
  const check = canEditAttendanceDate(employee, '2026-05-31', []);
  assert.equal(check.ok, false);
});

test('missing employment_date allows edit when period covers the date', () => {
  const employee = { id: 'HS3-18', employment_date: null, depart_date: null };
  const periods = [{ startDate: '2025-01-01', endDate: null, isCurrent: true }];
  const check = canEditAttendanceDate(employee, '2026-07-10', periods);
  assert.equal(check.ok, true);
});

test('stale early depart_date does not block when period end is later', () => {
  const employee = { id: 'HS3-18', employment_date: '2026-06-01', depart_date: '2026-07-15', status: 'Out' };
  const periods = [{ startDate: '2026-06-01', endDate: '2026-07-31', isCurrent: false }];
  const check = canEditAttendanceDate(employee, '2026-07-20', periods);
  assert.equal(check.ok, true);
});

test('open current period allows edits even when depart_date is set earlier', () => {
  const employee = { id: 'HS3-18', employment_date: '2026-06-01', depart_date: '2026-07-15', status: 'Out' };
  const periods = [{ startDate: '2026-06-01', endDate: null, isCurrent: true }];
  const check = canEditAttendanceDate(employee, '2026-07-20', periods);
  assert.equal(check.ok, true);
});

test('no employment_date allows any date on or before depart_date regardless of period start', () => {
  const employee = { id: 'HS3-18', employment_date: null, depart_date: '2026-08-31', status: 'Out' };
  const periods = [{ startDate: '2026-08-01', endDate: null, isCurrent: true }];
  const check = canEditAttendanceDate(employee, '2026-07-15', periods);
  assert.equal(check.ok, true);
});

test('no employment_date blocks after depart_date', () => {
  const employee = { id: 'HS3-18', employment_date: null, depart_date: '2026-07-15', status: 'Out' };
  const periods = [{ startDate: '2026-06-01', endDate: null, isCurrent: true }];
  const check = canEditAttendanceDate(employee, '2026-07-20', periods);
  assert.equal(check.ok, false);
  assert.match(check.reason, /locked as OUT/i);
});

test('no employment_date and no depart_date allows any date', () => {
  const employee = { id: 'HS3-18', employment_date: null, depart_date: null };
  const periods = [{ startDate: '2026-08-01', endDate: null, isCurrent: true }];
  const check = canEditAttendanceDate(employee, '2026-01-15', periods);
  assert.equal(check.ok, true);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergePendingAttendanceRecords, pendingAttendanceKey, pruneConfirmedPendingAttendanceRecords } = require('../lib/attendance-sync');

test('pending attendance edits override stale records and preserve unseen rows', () => {
  const records = [
    { employeeId: 'E1', date: '2026-07-01', status: 'Attended', transportOverride: '' },
    { employeeId: 'E2', date: '2026-07-02', status: 'Attended', transportOverride: '' },
  ];

  const pending = [
    { employeeId: 'E1', date: '2026-07-01', status: 'Day-OFF', transportOverride: '' },
    { employeeId: 'E3', date: '2026-07-03', status: 'Half Day', transportOverride: 'full' },
  ];

  const merged = mergePendingAttendanceRecords(records, pending);

  assert.equal(merged.find((r) => r.employeeId === 'E1' && r.date === '2026-07-01').status, 'Day-OFF');
  assert.equal(merged.find((r) => r.employeeId === 'E3' && r.date === '2026-07-03').transportOverride, 'full');
  assert.equal(pendingAttendanceKey('E1', '2026-07-01'), 'E1|2026-07-01');
});

test('blank pending status updates do not erase an existing saved status', () => {
  const records = [
    { employeeId: 'HS1-05', date: '2026-07-01', status: 'Attended', transportOverride: '' },
  ];

  const merged = mergePendingAttendanceRecords(records, [
    { employeeId: 'HS1-05', date: '2026-07-01', status: '', transportOverride: '' },
  ]);

  assert.equal(merged[0].status, 'Attended');
});

test('pending edits remain active until the server payload confirms the same value', () => {
  const serverRecords = [
    { employeeId: 'HS1-05', date: '2026-07-01', status: 'Day-OFF', transportOverride: '' },
  ];

  const remaining = pruneConfirmedPendingAttendanceRecords(serverRecords, [
    { employeeId: 'HS1-05', date: '2026-07-01', status: 'Attended', transportOverride: '' },
  ]);

  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].status, 'Attended');
});

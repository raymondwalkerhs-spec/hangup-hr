const test = require('node:test');
const assert = require('node:assert/strict');
const { computeWorkingDay, currentWorkingDay } = require('../lib/sales-working-day');
const egyptDatetime = require('../lib/egypt-datetime');

test('working day grace extends through 2:00 AM', () => {
  assert.equal(computeWorkingDay('2026-07-09T01:59:00'), '2026-07-08');
  assert.equal(computeWorkingDay('2026-07-09T02:00:00'), '2026-07-09');
});

test('Cairo working day 01:59 vs 02:00', () => {
  assert.equal(computeWorkingDay('2026-08-17 01:59:00'), '2026-08-16');
  assert.equal(computeWorkingDay('2026-08-17 02:00:00'), '2026-08-17');
});

test('currentWorkingDay matches Cairo clock', () => {
  const now = new Date();
  assert.equal(currentWorkingDay(now), computeWorkingDay(egyptDatetime.egyptNowFormatted(now)));
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeWorkingDay } = require('../lib/sales-working-day');

test('working day grace extends through 2:00 AM', () => {
  assert.equal(computeWorkingDay('2026-07-09T01:59:00'), '2026-07-08');
  assert.equal(computeWorkingDay('2026-07-09T02:00:00'), '2026-07-09');
});

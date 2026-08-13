const test = require('node:test');
const assert = require('node:assert/strict');
const { processImport } = require('../lib/attendance-fp-import');

test('FP import skips rows that already have a real attendance status', () => {
  const result = processImport({
    buffer: Buffer.from('dummy'),
    employees: [{ id: 'HS1-05', fp_number: '60' }],
    rules: {},
    month: '2026-07',
    existingRecords: [{ employeeId: 'HS1-05', date: '2026-07-06', status: 'Attended' }],
    overwritePolicy: 'skip_manual',
  });

  assert.equal(result.rowsSkipped, 0);
  assert.equal(result.records.length, 0);
});

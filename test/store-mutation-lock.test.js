const test = require('node:test');
const assert = require('node:assert/strict');
const { withStoreMutationLock } = require('../lib/data-store');

test('withStoreMutationLock serializes overlapping tasks', async () => {
  const order = [];

  async function run(label, delay) {
    return withStoreMutationLock(async () => {
      order.push(`${label}:start`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      order.push(`${label}:end`);
    });
  }

  await Promise.all([run('first', 20), run('second', 0)]);

  assert.deepEqual(order, ['first:start', 'first:end', 'second:start', 'second:end']);
});

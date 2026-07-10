const test = require('node:test');
const assert = require('node:assert/strict');

const backend = require('../lib/backend');
const cache = require('../lib/cache');
const roles = require('../lib/roles');
const store = require('../lib/data-store');

const originalUseSupabase = backend.useSupabase;
const originalCanEditAttendance = roles.canEditAttendance;

backend.useSupabase = () => false;
roles.canEditAttendance = () => true;

delete require.cache[require.resolve('../routes/api')];
const api = require('../routes/api');

test('attendance import route uses live attendance rows for protection', async () => {
  // Stub both getConfig (to avoid SQLite native-module crash in plain Node) and
  // getAttendanceForMonth (the new cache-first read path) so we can verify that
  // readAttendanceEventsForMonth is called before processImport runs.
  const originalGetConfig = store.getConfig;
  const originalGetAttendanceForMonth = cache.getAttendanceForMonth;
  const originalGetEmployees = store.getEmployees;
  let called = false;
  try {
    store.getConfig = () => ({ attendanceFpRulesByMonth: {} });
    store.getEmployees = () => [];
    cache.getAttendanceForMonth = (ym) => {
      called = true;
      return [{ employeeId: 'HS1-05', date: '2026-07-01', status: 'Attended' }];
    };

    const layer = api.stack.find((entry) => entry.route && entry.route.path === '/attendance/import');
    assert.ok(layer, 'attendance import route should be registered');

    const handler = layer.route.stack[0].handle;
    const req = {
      body: { month: '2026-07', base64: Buffer.from('dummy').toString('base64'), dryRun: true },
      userRole: { role: 'hr' },
      username: 'tester',
    };
    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };

    await handler(req, res);
    assert.equal(called, true, 'cache.getAttendanceForMonth should be called (cache-first read)');
    assert.equal(res.statusCode, 200);
  } finally {
    store.getConfig = originalGetConfig;
    store.getEmployees = originalGetEmployees;
    cache.getAttendanceForMonth = originalGetAttendanceForMonth;
    backend.useSupabase = originalUseSupabase;
    roles.canEditAttendance = originalCanEditAttendance;
  }
});

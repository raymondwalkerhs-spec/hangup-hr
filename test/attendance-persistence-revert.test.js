const test = require('node:test');
const assert = require('node:assert/strict');
const backendMod = require('../lib/backend');
const cache = require('../lib/cache');
const store = require('../lib/data-store');
const supabaseRepo = require('../lib/supabase-repo');
const { buildMonthSkeleton } = require('../lib/attendance');

test('manual Attended on missed FP day survives save then month read', async () => {
  const originalUseSupabase = backendMod.useSupabase;
  const originalReadAttendanceEvents = supabaseRepo.readAttendanceEvents;
  const originalBatchUpsertAttendance = supabaseRepo.batchUpsertAttendance;
  const originalGetAttendanceForMonth = cache.getAttendanceForMonth;
  const originalSetAttendanceForMonth = cache.setAttendanceForMonth;
  const originalUpsertAttendanceRecord = cache.upsertAttendanceRecord;

  const month = '2026-07';
  const fpDay = {
    employeeId: 'HS1-05',
    date: '2026-07-07',
    status: 'Attended',
    fpNotes: '',
    updatedAt: '2026-07-07T08:00:00.000Z',
  };
  const staleBlank = {
    employeeId: 'HS1-05',
    date: '2026-07-08',
    status: '',
    fpNotes: 'FP in 09:05 out —',
    updatedAt: '2026-07-01T08:00:00.000Z',
  };

  const sqlite = new Map();
  backendMod.useSupabase = () => true;
  supabaseRepo.readAttendanceEvents = async () => [fpDay, staleBlank];
  supabaseRepo.batchUpsertAttendance = async (records) => {
    for (const r of records) {
      sqlite.set(`${r.employeeId}|${r.date}`, { ...r, updatedAt: new Date().toISOString() });
    }
    return records.length;
  };
  cache.getAttendanceForMonth = () => [...sqlite.values()].filter((r) => String(r.date).startsWith(month));
  cache.setAttendanceForMonth = (ym, rows) => {
    for (const key of [...sqlite.keys()]) {
      const d = key.split('|')[1];
      if (d && d.startsWith(ym)) sqlite.delete(key);
    }
    for (const r of rows) sqlite.set(`${r.employeeId}|${r.date}`, r);
  };
  cache.upsertAttendanceRecord = (record) => {
    sqlite.set(`${record.employeeId}|${record.date}`, record);
  };

  try {
    const saved = await store.saveAttendanceRow(
      { employeeId: 'HS1-05', date: '2026-07-08', status: 'Attended' },
      'tester'
    );
    assert.equal(saved.status, 'Attended');
    assert.equal(saved.fpNotes, '');

    const afterRead = await store.readAttendanceEventsForMonth(month);
    const found = afterRead.find((r) => r.employeeId === 'HS1-05' && r.date === '2026-07-08');
    assert.equal(found?.status, 'Attended', 'GET month read should include manual Attended');

    const employees = [{ id: 'HS1-05', american_name: 'Test Agent', unit: 'HS-1', team: 'A' }];
    const grid = buildMonthSkeleton(employees, month, afterRead);
    const cell = grid.find((r) => r.employeeId === 'HS1-05' && r.date === '2026-07-08');
    assert.equal(cell?.status, 'Attended', 'grid skeleton should surface manual Attended');
  } finally {
    backendMod.useSupabase = originalUseSupabase;
    supabaseRepo.readAttendanceEvents = originalReadAttendanceEvents;
    supabaseRepo.batchUpsertAttendance = originalBatchUpsertAttendance;
    cache.getAttendanceForMonth = originalGetAttendanceForMonth;
    cache.setAttendanceForMonth = originalSetAttendanceForMonth;
    cache.upsertAttendanceRecord = originalUpsertAttendanceRecord;
  }
});

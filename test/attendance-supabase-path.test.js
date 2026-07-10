const test = require('node:test');
const assert = require('node:assert/strict');

const backendMod = require('../lib/backend');
const cache = require('../lib/cache');
const store = require('../lib/data-store');
const supabaseRepo = require('../lib/supabase-repo');

test('readAttendanceEventsForMonth returns cache when populated', async () => {
  // The cache is now the authoritative source. When the cache has data for the
  // month, Supabase is not consulted — this eliminates the race between a fresh
  // write and the subsequent GET /attendance read.
  const originalUseSupabase = backendMod.useSupabase;
  const originalReadAttendanceEvents = supabaseRepo.readAttendanceEvents;
  const originalGetAttendanceForMonth = cache.getAttendanceForMonth;

  const cachedRow = { employeeId: 'HS3-34', date: '2026-07-01', status: 'Attended' };
  backendMod.useSupabase = () => true;
  let supabaseCalled = false;
  supabaseRepo.readAttendanceEvents = async () => {
    supabaseCalled = true;
    return [{ employeeId: 'HS3-34', date: '2026-07-01', status: 'Day-OFF' }]; // different — should not be used
  };
  cache.getAttendanceForMonth = () => [cachedRow];

  try {
    const results = await store.readAttendanceEventsForMonth('2026-07');
    assert.deepStrictEqual(results, [cachedRow]);
    assert.equal(supabaseCalled, false, 'Supabase should not be called when cache has data');
  } finally {
    backendMod.useSupabase = originalUseSupabase;
    supabaseRepo.readAttendanceEvents = originalReadAttendanceEvents;
    cache.getAttendanceForMonth = originalGetAttendanceForMonth;
  }
});

test('readAttendanceEventsForMonth falls back to Supabase when cache is empty', async () => {
  // On first load (before any sync), cache is empty — Supabase is the fallback.
  const originalUseSupabase = backendMod.useSupabase;
  const originalReadAttendanceEvents = supabaseRepo.readAttendanceEvents;
  const originalGetAttendanceForMonth = cache.getAttendanceForMonth;
  const originalSetAttendanceForMonth = cache.setAttendanceForMonth;

  const supabaseRow = { employeeId: 'HS3-34', date: '2026-07-01', status: 'Attended' };
  backendMod.useSupabase = () => true;
  supabaseRepo.readAttendanceEvents = async () => [supabaseRow];
  cache.getAttendanceForMonth = () => []; // empty cache
  let cacheWarmed = false;
  cache.setAttendanceForMonth = () => { cacheWarmed = true; };

  try {
    const results = await store.readAttendanceEventsForMonth('2026-07');
    assert.deepStrictEqual(results, [supabaseRow]);
    assert.equal(cacheWarmed, true, 'Cache should be warmed after Supabase fallback');
  } finally {
    backendMod.useSupabase = originalUseSupabase;
    supabaseRepo.readAttendanceEvents = originalReadAttendanceEvents;
    cache.getAttendanceForMonth = originalGetAttendanceForMonth;
    cache.setAttendanceForMonth = originalSetAttendanceForMonth;
  }
});

test('saveAttendanceBatch reads prior rows from Supabase when enabled', async () => {
  const originalUseSupabase = backendMod.useSupabase;
  const originalReadAttendanceEvents = supabaseRepo.readAttendanceEvents;
  const originalBatchUpsertAttendance = supabaseRepo.batchUpsertAttendance;
  const originalUpsertAttendanceRecord = cache.upsertAttendanceRecord;

  let readMonth = null;
  let savedRecords = null;
  backendMod.useSupabase = () => true;
  supabaseRepo.readAttendanceEvents = async (yearMonth) => {
    readMonth = yearMonth;
    return [{ employeeId: 'HS1-05', date: '2026-07-09', status: 'Day-OFF' }];
  };
  supabaseRepo.batchUpsertAttendance = async (records) => {
    savedRecords = records;
    return records.length;
  };
  cache.upsertAttendanceRecord = () => {};

  try {
    await store.saveAttendanceBatch([
      { employeeId: 'HS1-05', date: '2026-07-09', status: 'Attended' },
    ], 'tester');
    assert.equal(readMonth, '2026-07');
    assert.deepStrictEqual(savedRecords[0].status, 'Attended');
  } finally {
    backendMod.useSupabase = originalUseSupabase;
    supabaseRepo.readAttendanceEvents = originalReadAttendanceEvents;
    supabaseRepo.batchUpsertAttendance = originalBatchUpsertAttendance;
    cache.upsertAttendanceRecord = originalUpsertAttendanceRecord;
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');

const backendMod = require('../lib/backend');
const cache = require('../lib/cache');
const store = require('../lib/data-store');
const supabaseRepo = require('../lib/supabase-repo');

function isoWithMs(date) {
  return new Date(date).toISOString();
}

function isoNoMs(date) {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

test('readAttendanceEventsForMonth merges Supabase with newer local edits', async () => {
  const originalUseSupabase = backendMod.useSupabase;
  const originalReadAttendanceEvents = supabaseRepo.readAttendanceEvents;
  const originalGetAttendanceForMonth = cache.getAttendanceForMonth;
  const originalSetAttendanceForMonth = cache.setAttendanceForMonth;

  const cachedRow = {
    employeeId: 'HS3-34',
    date: '2026-07-01',
    status: 'Attended',
    updatedAt: '2026-07-11T12:00:00.500Z',
  };
  backendMod.useSupabase = () => true;
  supabaseRepo.readAttendanceEvents = async () => [
    { employeeId: 'HS3-34', date: '2026-07-01', status: 'Day-OFF', updatedAt: '2026-07-11T12:00:00Z' },
  ];
  cache.getAttendanceForMonth = () => [cachedRow];
  let stored = null;
  cache.setAttendanceForMonth = (_ym, rows) => {
    stored = rows;
  };

  try {
    const results = await store.readAttendanceEventsForMonth('2026-07');
    const found = results.find((r) => r.employeeId === 'HS3-34' && r.date === '2026-07-01');
    assert.equal(found?.status, 'Attended');
    assert.equal(stored?.find((r) => r.date === '2026-07-01')?.status, 'Attended');
  } finally {
    backendMod.useSupabase = originalUseSupabase;
    supabaseRepo.readAttendanceEvents = originalReadAttendanceEvents;
    cache.getAttendanceForMonth = originalGetAttendanceForMonth;
    cache.setAttendanceForMonth = originalSetAttendanceForMonth;
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

test('mergeAttendanceMonth keeps local Attended over newer remote blank row', () => {
  const remote = {
    employeeId: 'HS1-05',
    date: '2026-07-16',
    status: '',
    fpNotes: 'FP in 09:05',
    updatedAt: '2026-08-04T20:00:00.000Z',
  };
  const local = {
    employeeId: 'HS1-05',
    date: '2026-07-16',
    status: 'Attended',
    fpNotes: '',
    updatedAt: '2026-08-04T16:00:00.000Z',
  };

  const originalGetAttendanceForMonth = cache.getAttendanceForMonth;
  cache.getAttendanceForMonth = () => [local];

  try {
    const merged = store.mergeAttendanceMonth([remote], '2026-07');
    const found = merged.find((r) => r.employeeId === 'HS1-05' && r.date === '2026-07-16');
    assert.equal(found?.status, 'Attended', 'local Attended must beat newer remote blank row');
  } finally {
    cache.getAttendanceForMonth = originalGetAttendanceForMonth;
  }
});

test('mergeAttendanceMonth keeps newer local edit despite timestamp format differences', () => {
  // Supabase may return timestamps without milliseconds (e.g. 2026-07-11T12:00:00Z)
  // while the local cache stores ISO strings with milliseconds (e.g. 2026-07-11T12:00:00.123Z).
  // A naive string comparison would incorrectly treat the local edit as older and discard it.
  const baseTime = new Date('2026-07-11T12:00:00.000Z');
  const remoteRow = {
    employeeId: 'HS3-18',
    date: '2026-06-01',
    status: '',
    updatedAt: isoNoMs(baseTime),
  };
  const localRow = {
    employeeId: 'HS3-18',
    date: '2026-06-01',
    status: 'Attended',
    updatedAt: isoWithMs(new Date(baseTime.getTime() + 123)),
  };

  const originalGetAttendanceForMonth = cache.getAttendanceForMonth;
  cache.getAttendanceForMonth = () => [localRow];

  try {
    const merged = store.mergeAttendanceMonth([remoteRow], '2026-06');
    const found = merged.find((r) => r.employeeId === 'HS3-18' && r.date === '2026-06-01');
    assert.equal(found?.status, 'Attended', 'local Attended edit should win over stale remote blank row');
  } finally {
    cache.getAttendanceForMonth = originalGetAttendanceForMonth;
  }
});

test('refreshAttendanceFromSupabase merges remote with newer local edits', async () => {
  const originalUseSupabase = backendMod.useSupabase;
  const originalReadAttendanceEvents = supabaseRepo.readAttendanceEvents;
  const originalGetAttendanceForMonth = cache.getAttendanceForMonth;
  const originalSetAttendanceForMonth = cache.setAttendanceForMonth;

  const localRow = {
    employeeId: 'HS1-05',
    date: '2026-07-09',
    status: 'Attended',
    updatedAt: new Date('2026-07-11T12:00:00.123Z').toISOString(),
  };
  backendMod.useSupabase = () => true;
  supabaseRepo.readAttendanceEvents = async () => [
    { employeeId: 'HS1-05', date: '2026-07-09', status: 'Day-OFF', updatedAt: '2026-07-11T12:00:00Z' },
  ];
  cache.getAttendanceForMonth = () => [localRow];
  let stored = null;
  cache.setAttendanceForMonth = (_ym, rows) => {
    stored = rows;
  };

  try {
    const results = await store.refreshAttendanceFromSupabase('2026-07');
    const found = results.find((r) => r.employeeId === 'HS1-05' && r.date === '2026-07-09');
    assert.equal(found?.status, 'Attended');
    assert.equal(stored?.find((r) => r.date === '2026-07-09')?.status, 'Attended');
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

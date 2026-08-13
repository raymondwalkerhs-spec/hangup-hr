const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyManualAttendanceOverride,
  hasExplicitManualStatus,
} = require('../lib/attendance-validation');
const { shouldApplyLiveAttendanceChange } = require('../lib/attendance-sync');
const backendMod = require('../lib/backend');
const cache = require('../lib/cache');
const store = require('../lib/data-store');
const supabaseRepo = require('../lib/supabase-repo');

test('hasExplicitManualStatus rejects blank and null marker', () => {
  assert.equal(hasExplicitManualStatus(''), false);
  assert.equal(hasExplicitManualStatus('(--)'), false);
  assert.equal(hasExplicitManualStatus('Attended'), true);
});

test('applyManualAttendanceOverride clears FP metadata for Attended on missed FP day', () => {
  const prior = {
    employeeId: 'HS1-05',
    date: '2026-07-08',
    status: '',
    fpNotes: 'FP in 09:05 out —',
    fpLateness: null,
    leaveNote: 'FP in 09:05 out —',
  };
  const next = applyManualAttendanceOverride(
    { employeeId: 'HS1-05', date: '2026-07-08', status: 'Attended' },
    prior
  );
  assert.equal(next.status, 'Attended');
  assert.equal(next.fpNotes, '');
  assert.equal(next.fpLateness, null);
  assert.equal(next.leaveNote, '');
});

test('shouldApplyLiveAttendanceChange ignores stale blank realtime over Attended', () => {
  const existing = {
    employeeId: 'HS1-05',
    date: '2026-07-08',
    status: 'Attended',
    updatedAt: '2026-07-11T12:00:00.500Z',
  };
  const incoming = {
    employeeId: 'HS1-05',
    date: '2026-07-08',
    status: '',
    updatedAt: '2026-07-11T12:00:00Z',
  };
  assert.equal(shouldApplyLiveAttendanceChange(existing, incoming), false);
});

test('shouldApplyLiveAttendanceChange accepts newer Attended realtime update', () => {
  const existing = { status: '', updatedAt: '2026-07-11T12:00:00Z' };
  const incoming = { status: 'Attended', updatedAt: '2026-07-11T12:00:01Z' };
  assert.equal(shouldApplyLiveAttendanceChange(existing, incoming), true);
});

test('saveAttendanceBatch manual Attended overrides stale blank FP row from Supabase', async () => {
  const originalUseSupabase = backendMod.useSupabase;
  const originalReadAttendanceEvents = supabaseRepo.readAttendanceEvents;
  const originalBatchUpsertAttendance = supabaseRepo.batchUpsertAttendance;
  const originalGetAttendanceForMonth = cache.getAttendanceForMonth;
  const originalUpsertAttendanceRecord = cache.upsertAttendanceRecord;

  const staleRemote = {
    employeeId: 'HS1-05',
    date: '2026-07-08',
    status: '',
    fpNotes: 'FP in 09:05 out —',
    fpLateness: null,
    updatedAt: '2026-07-01T08:00:00.000Z',
  };
  const fpDay = {
    employeeId: 'HS1-05',
    date: '2026-07-07',
    status: 'Attended',
    fpNotes: '',
    updatedAt: '2026-07-07T08:00:00.000Z',
  };

  backendMod.useSupabase = () => true;
  supabaseRepo.readAttendanceEvents = async () => [staleRemote, fpDay];
  cache.getAttendanceForMonth = () => [staleRemote, fpDay];
  let savedRecords = null;
  supabaseRepo.batchUpsertAttendance = async (records) => {
    savedRecords = records;
    return records.length;
  };
  const cacheWrites = [];
  cache.upsertAttendanceRecord = (record) => {
    cacheWrites.push(record);
  };

  try {
    await store.saveAttendanceBatch(
      [{ employeeId: 'HS1-05', date: '2026-07-08', status: 'Attended' }],
      'tester'
    );
    const saved = savedRecords.find((r) => r.date === '2026-07-08');
    assert.equal(saved?.status, 'Attended');
    assert.equal(saved?.fpNotes, '');
    assert.equal(saved?.fpLateness, null);
    const cached = cacheWrites.find((r) => r.date === '2026-07-08');
    assert.equal(cached?.status, 'Attended');
    assert.equal(cached?.fpNotes, '');
  } finally {
    backendMod.useSupabase = originalUseSupabase;
    supabaseRepo.readAttendanceEvents = originalReadAttendanceEvents;
    supabaseRepo.batchUpsertAttendance = originalBatchUpsertAttendance;
    cache.getAttendanceForMonth = originalGetAttendanceForMonth;
    cache.upsertAttendanceRecord = originalUpsertAttendanceRecord;
  }
});

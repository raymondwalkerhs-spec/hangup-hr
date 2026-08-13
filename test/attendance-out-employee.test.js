const test = require('node:test');
const assert = require('node:assert/strict');

// Mock the dependencies we need
const mockCache = {
  getConfigRaw: () => ({ hideOutEmployees: true }),
  getEmployees: () => [
    {
      id: 'NW-18',
      status: 'OUT BUT STILL GET PAID',
      employment_date: '2026-05-31',
      depart_date: null,
      unit: 'HS-3',
      team: 'Jude',
      american_name: 'Rayan neil',
      arabic_name: 'Marwan Ashraf Radwan',
    },
  ],
  getAttendanceForMonth: (month) => {
    // Simulate STALE cache: empty for June (record hasn't been cached yet)
    if (month === '2026-06') return [];
    return [];
  },
};

const mockIdGen = {
  filterEmployees: (employees, opts = {}) => {
    const { month, attendanceRecords = [] } = opts;
    return employees.filter((emp) => {
      if (opts.hideOut === false) return true;
      // Simplified: just pass through for this mock
      return true;
    });
  },
  isOutEmployee: (emp) => {
    const status = String(emp?.status || '').toLowerCase();
    return status.includes('out');
  },
};

const mockEmployeeIds = {
  mergeEmployeesForMonth: (base) => base,
};

// We need to test the actual getEmployeesForMonth logic
// So let's require the module and override its internals
const dataStorePath = require('path').resolve(__dirname, '../lib/data-store.js');

// Since data-store.js has complex internals, let's test the core logic directly
// by simulating what getEmployeesForMonth does
function simulateGetEmployeesForMonth(month, opts = {}, cacheRecords) {
  const hideOut = opts.hideOut !== undefined ? opts.hideOut : true;
  const attendanceRecords =
    opts.attendanceRecords || cacheRecords || mockCache.getAttendanceForMonth(month) || [];
  
  const employees = mockCache.getEmployees();
  const base = mockIdGen.filterEmployees(employees, {
    hideOut: false,
    month,
    attendanceRecords,
  });
  let merged = mockEmployeeIds.mergeEmployeesForMonth(base, month);
  
  if (hideOut) {
    const { shouldShowInMonth } = require('../lib/depart-attendance');
    merged = merged.filter((emp) =>
      shouldShowInMonth(emp, month, attendanceRecords, { hideOut: true })
    );
  }
  return merged;
}

test('OUT BUT STILL GET PAID employee is hidden when cache is stale (no June records)', () => {
  const result = simulateGetEmployeesForMonth('2026-06', { hideOut: true });
  assert.equal(result.length, 0, 'Employee should be hidden when cache has no June records');
});

test('OUT BUT STILL GET PAID employee is shown when fresh Supabase records are provided', () => {
  const freshRecords = [
    { employeeId: 'NW-18', date: '2026-06-01', status: 'Attended' },
    { employeeId: 'NW-18', date: '2026-06-02', status: 'Attended' },
  ];
  const result = simulateGetEmployeesForMonth('2026-06', { hideOut: true, attendanceRecords: freshRecords });
  assert.equal(result.length, 1, 'Employee should be shown when fresh records show worked days');
  assert.equal(result[0].id, 'NW-18');
});

test('OUT BUT STILL GET PAID employee is shown when cache has June records', () => {
  const cachedRecords = [
    { employeeId: 'NW-18', date: '2026-06-01', status: 'Attended' },
  ];
  // Override cache to return these records
  mockCache.getAttendanceForMonth = (month) => {
    if (month === '2026-06') return cachedRecords;
    return [];
  };
  const result = simulateGetEmployeesForMonth('2026-06', { hideOut: true });
  assert.equal(result.length, 1, 'Employee should be shown when cache has June records');
  assert.equal(result[0].id, 'NW-18');
});

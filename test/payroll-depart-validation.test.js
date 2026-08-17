const test = require('node:test');
const assert = require('node:assert/strict');

const { applyDepartAutoOutForMonth } = require('../lib/attendance');
const { applyPayrollHybridDbCore } = require('../lib/payroll-hybrid');

test('payroll calculation respects depart auto-OUT', () => {
  const employees = [
    { id: 'HS1-12', american_name: 'Test Agent', depart_date: '2026-07-17', status: 'Out' },
  ];

  const rawRecords = [
    { employeeId: 'HS1-12', date: '2026-07-01', status: 'Attended' },
    { employeeId: 'HS1-12', date: '2026-07-02', status: 'Attended' },
    { employeeId: 'HS1-12', date: '2026-07-15', status: 'Attended' },
    { employeeId: 'HS1-12', date: '2026-07-16', status: 'Attended' },
    { employeeId: 'HS1-12', date: '2026-07-17', status: 'Attended' },
    { employeeId: 'HS1-12', date: '2026-07-18', status: 'Attended' },
    { employeeId: 'HS1-12', date: '2026-07-19', status: 'Attended' },
    { employeeId: 'HS1-12', date: '2026-07-20', status: 'Attended' },
    { employeeId: 'HS1-12', date: '2026-07-21', status: 'Attended' },
    { employeeId: 'HS1-12', date: '2026-07-22', status: 'Attended' },
  ];

  const records = applyDepartAutoOutForMonth(employees, rawRecords, '2026-07');
  const hs1Records = records.filter((r) => r.employeeId === 'HS1-12');

  const attended = hs1Records.filter((r) => r.status === 'Attended').length;
  const out = hs1Records.filter((r) => r.status === 'OUT').length;

  assert.equal(attended, 5, 'Should have 5 Attended days before depart date');
  assert.equal(out, 14, 'Should have 14 OUT days after depart date (days 18-31)');
});

test('DB override rejects inflated working_days from stale OUT data', () => {
  const appRow = {
    employeeId: 'HS3-13',
    totalWorkingDays: 5,
    workingDaysInMonth: 22,
    transportAllowance: 0,
    bonuses: { Transportation: 0 },
    totalBonuses: 0,
    basicSalary: 1500,
    totalDeductions: 0,
    bonusTransferPayroll: 0,
    netSalary: 1500,
    noPayroll: false,
  };

  const staleDbRow = {
    employee_id: 'HS3-13',
    working_days: 22,
    transport_allowance: 3000,
    basic_salary: 6000,
  };

  const result = applyPayrollHybridDbCore(appRow, staleDbRow);
  assert.equal(result.totalWorkingDays, 5, 'Should reject inflated DB working_days');
  assert.equal(result.transportAllowance, 0, 'Should not apply stale DB transport');
  assert.equal(result.netSalary, 1500, 'Net should stay on app-layer values');
  assert.equal(result._dbSource, false, 'Should mark as not from DB');
});

test('DB override accepts reasonable working_days', () => {
  const appRow = {
    employeeId: 'HS1-01',
    totalWorkingDays: 20,
    workingDaysInMonth: 22,
    transportAllowance: 2500,
    bonuses: { Transportation: 2500 },
    totalBonuses: 2500,
    basicSalary: 5000,
    dailyRate: 227.27,
    totalDeductions: 0,
    bonusTransferPayroll: 0,
    netSalary: 7500,
    noPayroll: false,
  };

  const validDbRow = {
    employee_id: 'HS1-01',
    working_days: 20,
    daily_rate: 227.27,
    transport_daily_rate: 136.36,
    transport_days: 18,
    transport_allowance: 2500,
    basic_salary: 5000,
  };

  const result = applyPayrollHybridDbCore(appRow, validDbRow);
  assert.equal(result.totalWorkingDays, 20, 'Should accept matching DB working_days');
  assert.equal(result.transportAllowance, 2500, 'Should accept matching DB transport');
  assert.equal(result.netSalary, 7500, 'Net includes transport in bonuses');
  assert.equal(result._dbSource, true, 'Should mark as from DB');
});

test('payroll calculation without depart date counts all days', () => {
  const employees = [
    { id: 'HS1-05', american_name: 'Test Agent 2', depart_date: null, status: 'Active' },
  ];

  const rawRecords = [
    { employeeId: 'HS1-05', date: '2026-07-01', status: 'Attended' },
    { employeeId: 'HS1-05', date: '2026-07-02', status: 'Attended' },
    { employeeId: 'HS1-05', date: '2026-07-03', status: 'Attended' },
    { employeeId: 'HS1-05', date: '2026-07-04', status: 'Attended' },
    { employeeId: 'HS1-05', date: '2026-07-05', status: 'Attended' },
  ];

  const records = applyDepartAutoOutForMonth(employees, rawRecords, '2026-07');
  const hs1Records = records.filter((r) => r.employeeId === 'HS1-05');

  const attended = hs1Records.filter((r) => r.status === 'Attended').length;
  const out = hs1Records.filter((r) => r.status === 'OUT').length;

  assert.equal(attended, 5, 'Should have 5 Attended days when no depart date');
  assert.equal(out, 0, 'Should have 0 OUT days when no depart date');
});

test('bulk attendance validation logic', () => {
  function validateBulkAttendanceAgainstDepartDate(employees, month, status, username) {
    const isRaymond = String(username || "").toLowerCase() === "raymond";
    if (isRaymond) return { allowed: true, raymondOverride: true };
    if (String(status || "").toLowerCase() !== "attended") return { allowed: true };

    const conflicts = [];
    for (const emp of employees) {
      const depart = String(emp?.depart_date || "").slice(0, 10);
      if (!depart) continue;
      if (!String(depart).startsWith(month)) continue;

      const [year, mo] = month.split("-").map(Number);
      const daysInMonth = new Date(year, mo, 0).getDate();
      const departDayNum = parseInt(depart.slice(8, 10), 10);
      const affectedDays = daysInMonth - departDayNum;

      if (affectedDays > 0) {
        conflicts.push({
          employeeId: emp.id,
          name: emp.american_name || emp.arabic_name || emp.id,
          depart_date: depart,
          affectedDays,
        });
      }
    }

    return {
      allowed: conflicts.length === 0,
      conflicts,
      message:
        conflicts.length > 0
          ? `${conflicts.length} employee(s) have Out Dates in ${month}.`
          : null,
    };
  }

  const employeesWithDepart = [
    { id: 'HS1-12', american_name: 'Test', depart_date: '2026-07-17' },
  ];

  const result = validateBulkAttendanceAgainstDepartDate(employeesWithDepart, '2026-07', 'Attended', 'admin');
  assert.equal(result.allowed, false, 'Should block non-Raymond user');
  assert.equal(result.conflicts.length, 1, 'Should have 1 conflict');

  const raymondResult = validateBulkAttendanceAgainstDepartDate(employeesWithDepart, '2026-07', 'Attended', 'Raymond');
  assert.equal(raymondResult.allowed, true, 'Should allow Raymond user');
  assert.equal(raymondResult.raymondOverride, true, 'Should have Raymond override');

  const dayOffResult = validateBulkAttendanceAgainstDepartDate(employeesWithDepart, '2026-07', 'Day-OFF', 'admin');
  assert.equal(dayOffResult.allowed, true, 'Should allow Day-OFF status');
});

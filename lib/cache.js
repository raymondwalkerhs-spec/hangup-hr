const path = require("path");
const fs = require("fs");

let Database = null;
let db = null;

function loadSqlite() {
  if (!Database) {
    try {
      Database = require("better-sqlite3");
    } catch (err) {
      throw new Error(
        `Local cache module failed to load (${err.message}). Reinstall Hangup HR or run the installer build with "npm run rebuild:native".`
      );
    }
  }
  return Database;
}

function getCacheDir() {
  const dir =
    process.env.HR_CACHE_DIR || path.join(__dirname, "..", ".cache");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDb() {
  if (db) return db;
  const dbPath = path.join(getCacheDir(), "hr-cache.db");
  db = new loadSqlite()(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  initSchema(db);
  return db;
}

function initSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attendance (
      employee_id TEXT NOT NULL,
      date TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (employee_id, date)
    );
    CREATE TABLE IF NOT EXISTS bonuses (
      employee_id TEXT NOT NULL,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (employee_id, date, type)
    );
    CREATE TABLE IF NOT EXISTS deductions (
      employee_id TEXT NOT NULL,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (employee_id, date, type)
    );
    CREATE TABLE IF NOT EXISTS position_rates (
      position TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS position_rate_monthly (
      year_month TEXT NOT NULL,
      position TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (year_month, position)
    );
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_attendance_month ON attendance(date);
    CREATE INDEX IF NOT EXISTS idx_bonuses_month ON bonuses(date);
    CREATE INDEX IF NOT EXISTS idx_deductions_month ON deductions(date);
    CREATE TABLE IF NOT EXISTS payroll_adjustments (
      employee_id TEXT NOT NULL,
      year_month TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (employee_id, year_month)
    );
    CREATE TABLE IF NOT EXISTS commission_types (
      name TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS employee_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_payroll_adj_month ON payroll_adjustments(year_month);
    CREATE INDEX IF NOT EXISTS idx_documents_emp ON employee_documents(employee_id);
    CREATE TABLE IF NOT EXISTS employee_warnings (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_warnings_emp ON employee_warnings(employee_id);
    CREATE TABLE IF NOT EXISTS commission_tiers (
      year_month TEXT NOT NULL,
      min_sales INTEGER NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (year_month, min_sales)
    );
    CREATE TABLE IF NOT EXISTS employee_loans (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_loans_emp ON employee_loans(employee_id);
    CREATE TABLE IF NOT EXISTS loan_payments (
      loan_id TEXT NOT NULL,
      year_month TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (loan_id, year_month)
    );
    CREATE INDEX IF NOT EXISTS idx_loan_payments_month ON loan_payments(year_month);
    CREATE TABLE IF NOT EXISTS payroll_splits (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      year_month TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_payroll_splits_month ON payroll_splits(year_month);
    CREATE INDEX IF NOT EXISTS idx_payroll_splits_emp ON payroll_splits(employee_id);
  `);
}

function setMeta(key, value) {
  getDb().prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
}

function getMeta(key) {
  const row = getDb().prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row?.value || null;
}

function getLastSync() {
  const v = getMeta("last_sync");
  return v ? new Date(v) : null;
}

function setEmployees(employees) {
  const database = getDb();
  const tx = database.transaction((rows) => {
    database.prepare("DELETE FROM employees").run();
    const stmt = database.prepare("INSERT INTO employees (id, data) VALUES (?, ?)");
    for (const e of rows) stmt.run(e.id, JSON.stringify(e));
  });
  tx(employees);
}

function getEmployees() {
  return getDb()
    .prepare("SELECT data FROM employees ORDER BY id")
    .all()
    .map((r) => JSON.parse(r.data));
}

function upsertEmployee(emp) {
  getDb()
    .prepare("INSERT OR REPLACE INTO employees (id, data) VALUES (?, ?)")
    .run(emp.id, JSON.stringify(emp));
}

function removeEmployee(id) {
  getDb().prepare("DELETE FROM employees WHERE id = ?").run(id);
}

function setAttendanceForMonth(yearMonth, records) {
  const database = getDb();
  const prefix = yearMonth + "-";
  const tx = database.transaction((rows) => {
    database.prepare("DELETE FROM attendance WHERE date LIKE ?").run(prefix + "%");
    const stmt = database.prepare(
      "INSERT OR REPLACE INTO attendance (employee_id, date, data) VALUES (?, ?, ?)"
    );
    for (const r of rows) stmt.run(r.employeeId, r.date, JSON.stringify(r));
  });
  tx(records);
}

function getAttendanceForMonth(yearMonth) {
  const prefix = yearMonth + "-";
  return getDb()
    .prepare("SELECT data FROM attendance WHERE date LIKE ? ORDER BY date, employee_id")
    .all(prefix + "%")
    .map((r) => JSON.parse(r.data));
}

function getAttendanceForEmployee(employeeId) {
  return getDb()
    .prepare("SELECT data FROM attendance WHERE employee_id = ? ORDER BY date")
    .all(employeeId)
    .map((r) => JSON.parse(r.data));
}

function upsertAttendanceRecord(record) {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO attendance (employee_id, date, data) VALUES (?, ?, ?)"
    )
    .run(record.employeeId, record.date, JSON.stringify(record));
}

function deleteAttendanceRecord(employeeId, date) {
  getDb()
    .prepare("DELETE FROM attendance WHERE employee_id = ? AND date = ?")
    .run(employeeId, date);
}

function setBonusesForMonth(yearMonth, records) {
  const database = getDb();
  const prefix = yearMonth + "-";
  const tx = database.transaction((rows) => {
    database.prepare("DELETE FROM bonuses WHERE date LIKE ?").run(prefix + "%");
    const stmt = database.prepare(
      "INSERT OR REPLACE INTO bonuses (employee_id, date, type, data) VALUES (?, ?, ?, ?)"
    );
    for (const r of rows)
      stmt.run(r.employeeId, r.date, r.type || "Other Bonus", JSON.stringify(r));
  });
  tx(records);
}

function getBonusesForMonth(yearMonth) {
  const prefix = yearMonth + "-";
  return getDb()
    .prepare("SELECT data FROM bonuses WHERE date LIKE ?")
    .all(prefix + "%")
    .map((r) => JSON.parse(r.data));
}

function upsertBonus(record) {
  const type = record.type || "Other Bonus";
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO bonuses (employee_id, date, type, data) VALUES (?, ?, ?, ?)"
    )
    .run(record.employeeId, record.date, type, JSON.stringify(record));
}

function deleteBonus(employeeId, date, type) {
  getDb()
    .prepare("DELETE FROM bonuses WHERE employee_id = ? AND date = ? AND type = ?")
    .run(employeeId, date, type);
}

function setDeductionsForMonth(yearMonth, records) {
  const database = getDb();
  const prefix = yearMonth + "-";
  const tx = database.transaction((rows) => {
    database.prepare("DELETE FROM deductions WHERE date LIKE ?").run(prefix + "%");
    const stmt = database.prepare(
      "INSERT OR REPLACE INTO deductions (employee_id, date, type, data) VALUES (?, ?, ?, ?)"
    );
    for (const r of rows)
      stmt.run(
        r.employeeId,
        r.date,
        r.type || "Other Deductions",
        JSON.stringify(r)
      );
  });
  tx(records);
}

function getDeductionsForMonth(yearMonth) {
  const prefix = yearMonth + "-";
  return getDb()
    .prepare("SELECT data FROM deductions WHERE date LIKE ?")
    .all(prefix + "%")
    .map((r) => JSON.parse(r.data));
}

function upsertDeduction(record) {
  const type = record.type || "Other Deductions";
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO deductions (employee_id, date, type, data) VALUES (?, ?, ?, ?)"
    )
    .run(record.employeeId, record.date, type, JSON.stringify(record));
}

function deleteDeduction(employeeId, date, type) {
  getDb()
    .prepare("DELETE FROM deductions WHERE employee_id = ? AND date = ? AND type = ?")
    .run(employeeId, date, type);
}

function setPositionRates(rates) {
  const database = getDb();
  const tx = database.transaction((rows) => {
    database.prepare("DELETE FROM position_rates").run();
    const stmt = database.prepare(
      "INSERT INTO position_rates (position, data) VALUES (?, ?)"
    );
    for (const r of rows) stmt.run(r.position, JSON.stringify(r));
  });
  tx(rates);
}

function getPositionRates() {
  return getDb()
    .prepare("SELECT data FROM position_rates ORDER BY position")
    .all()
    .map((r) => JSON.parse(r.data));
}

function setPositionRateMonthly(rows) {
  const database = getDb();
  const tx = database.transaction((list) => {
    database.prepare("DELETE FROM position_rate_monthly").run();
    const stmt = database.prepare(
      "INSERT INTO position_rate_monthly (year_month, position, data) VALUES (?, ?, ?)"
    );
    for (const r of list) stmt.run(r.yearMonth, r.position, JSON.stringify(r));
  });
  tx(rows);
}

function getPositionRatesForMonth(yearMonth) {
  const ym = String(yearMonth || "").slice(0, 7);
  const monthly = getDb()
    .prepare("SELECT data FROM position_rate_monthly WHERE year_month = ? ORDER BY position")
    .all(ym)
    .map((r) => JSON.parse(r.data));
  if (monthly.length) return monthly;
  return getPositionRates();
}

function upsertPositionRateMonthly(yearMonth, position, monthlySalary) {
  const ym = String(yearMonth || "").slice(0, 7);
  const row = { position, monthlySalary: Number(monthlySalary) || 0, yearMonth: ym };
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO position_rate_monthly (year_month, position, data) VALUES (?, ?, ?)"
    )
    .run(ym, position, JSON.stringify(row));
  return row;
}

function deletePositionRateMonthly(yearMonth, position) {
  getDb()
    .prepare("DELETE FROM position_rate_monthly WHERE year_month = ? AND position = ?")
    .run(String(yearMonth || "").slice(0, 7), position);
}

function hasPositionRatesForMonth(yearMonth) {
  const ym = String(yearMonth || "").slice(0, 7);
  const row = getDb()
    .prepare("SELECT COUNT(*) as c FROM position_rate_monthly WHERE year_month = ?")
    .get(ym);
  return (row?.c || 0) > 0;
}

function setConfig(config) {
  const database = getDb();
  const tx = database.transaction((cfg) => {
    database.prepare("DELETE FROM config").run();
    const stmt = database.prepare("INSERT INTO config (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries(cfg)) {
      stmt.run(
        key,
        typeof value === "string" ? value : JSON.stringify(value)
      );
    }
  });
  tx(config);
}

function getConfigRaw() {
  const rows = getDb().prepare("SELECT key, value FROM config").all();
  const out = {
    defaultWeekendDays: [6, 0],
    weekendDayNames: ["Saturday", "Sunday"],
    latenessRules: {
      tierA: { label: "Lateness A", beforeHour: 15, amount: 25 },
      tierB: { label: "Lateness B", afterHour: 15, amount: 50 },
    },
    workingDaysByMonth: {},
    hideOutEmployees: true,
    transportAllowanceMonthly: 3000,
  };
  for (const row of rows) {
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      out[row.key] = row.value;
    }
  }
  return {
    defaultWeekendDays: out.defaultWeekendDays || [6, 0],
    weekendDayNames: out.weekendDayNames || ["Saturday", "Sunday"],
    latenessRules: out.latenessRules,
    workingDaysByMonth: out.workingDaysByMonth || {},
    hideOutEmployees: out.hideOutEmployees !== false,
    transportAllowanceMonthly: Number(out.transportAllowanceMonthly) || 3000,
  };
}

function isCacheWarm() {
  return getMeta("last_sync") !== null && getEmployees().length > 0;
}

function setPayrollAdjustmentsForMonth(yearMonth, records) {
  const database = getDb();
  const tx = database.transaction((rows) => {
    database.prepare("DELETE FROM payroll_adjustments WHERE year_month = ?").run(yearMonth);
    const stmt = database.prepare(
      "INSERT OR REPLACE INTO payroll_adjustments (employee_id, year_month, data) VALUES (?, ?, ?)"
    );
    for (const r of rows) stmt.run(r.employeeId, r.yearMonth, JSON.stringify(r));
  });
  tx(records);
}

function getPayrollAdjustmentsForMonth(yearMonth) {
  return getDb()
    .prepare("SELECT data FROM payroll_adjustments WHERE year_month = ?")
    .all(yearMonth)
    .map((r) => JSON.parse(r.data));
}

function upsertPayrollAdjustment(record) {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO payroll_adjustments (employee_id, year_month, data) VALUES (?, ?, ?)"
    )
    .run(record.employeeId, record.yearMonth, JSON.stringify(record));
}

function setCommissionTypes(types) {
  const database = getDb();
  const tx = database.transaction((rows) => {
    database.prepare("DELETE FROM commission_types").run();
    const stmt = database.prepare("INSERT INTO commission_types (name, data) VALUES (?, ?)");
    for (const t of rows) stmt.run(t.name, JSON.stringify(t));
  });
  tx(types);
}

function getCommissionTypes() {
  return getDb()
    .prepare("SELECT data FROM commission_types ORDER BY name")
    .all()
    .map((r) => JSON.parse(r.data));
}

function setEmployeeDocuments(docs) {
  const database = getDb();
  const tx = database.transaction((rows) => {
    database.prepare("DELETE FROM employee_documents").run();
    const stmt = database.prepare(
      "INSERT INTO employee_documents (employee_id, data) VALUES (?, ?)"
    );
    for (const d of rows) stmt.run(d.employeeId, JSON.stringify(d));
  });
  tx(docs);
}

function getEmployeeDocuments(employeeId) {
  const rows = employeeId
    ? getDb()
        .prepare("SELECT data FROM employee_documents WHERE employee_id = ? ORDER BY rowid DESC")
        .all(employeeId)
    : getDb().prepare("SELECT data FROM employee_documents ORDER BY rowid DESC").all();
  return rows.map((r) => JSON.parse(r.data));
}

function appendEmployeeDocument(doc) {
  getDb()
    .prepare("INSERT INTO employee_documents (employee_id, data) VALUES (?, ?)")
    .run(doc.employeeId, JSON.stringify(doc));
}

function setEmployeeWarnings(warnings) {
  const database = getDb();
  const tx = database.transaction((rows) => {
    database.prepare("DELETE FROM employee_warnings").run();
    const stmt = database.prepare(
      "INSERT OR REPLACE INTO employee_warnings (id, employee_id, data) VALUES (?, ?, ?)"
    );
    for (const w of rows) stmt.run(w.id, w.employeeId, JSON.stringify(w));
  });
  tx(warnings);
}

function getEmployeeWarnings(employeeId) {
  const rows = employeeId
    ? getDb()
        .prepare("SELECT data FROM employee_warnings WHERE employee_id = ? ORDER BY rowid DESC")
        .all(employeeId)
    : getDb().prepare("SELECT data FROM employee_warnings ORDER BY rowid DESC").all();
  return rows.map((r) => JSON.parse(r.data));
}

function appendEmployeeWarning(warning) {
  getDb()
    .prepare("INSERT OR REPLACE INTO employee_warnings (id, employee_id, data) VALUES (?, ?, ?)")
    .run(warning.id, warning.employeeId, JSON.stringify(warning));
}

function setCommissionTiers(tiers) {
  const database = getDb();
  const tx = database.transaction((rows) => {
    database.prepare("DELETE FROM commission_tiers").run();
    const stmt = database.prepare(
      "INSERT INTO commission_tiers (year_month, min_sales, data) VALUES (?, ?, ?)"
    );
    for (const t of rows) stmt.run(t.yearMonth, t.minSales, JSON.stringify(t));
  });
  tx(tiers);
}

function getCommissionTiersForMonth(yearMonth) {
  return getDb()
    .prepare("SELECT data FROM commission_tiers WHERE year_month = ? ORDER BY min_sales")
    .all(yearMonth)
    .map((r) => JSON.parse(r.data));
}

function setEmployeeLoans(loans) {
  const database = getDb();
  const tx = database.transaction((rows) => {
    database.prepare("DELETE FROM employee_loans").run();
    const stmt = database.prepare(
      "INSERT INTO employee_loans (id, employee_id, data) VALUES (?, ?, ?)"
    );
    for (const l of rows) stmt.run(l.id, l.employeeId, JSON.stringify(l));
  });
  tx(loans);
}

function getEmployeeLoans(employeeId) {
  const rows = employeeId
    ? getDb()
        .prepare("SELECT data FROM employee_loans WHERE employee_id = ? ORDER BY rowid DESC")
        .all(employeeId)
    : getDb().prepare("SELECT data FROM employee_loans ORDER BY rowid DESC").all();
  return rows.map((r) => JSON.parse(r.data));
}

function upsertEmployeeLoan(loan) {
  getDb()
    .prepare("INSERT OR REPLACE INTO employee_loans (id, employee_id, data) VALUES (?, ?, ?)")
    .run(loan.id, loan.employeeId, JSON.stringify(loan));
}

function deleteEmployeeLoanCache(id) {
  getDb().prepare("DELETE FROM employee_loans WHERE id = ?").run(id);
}

function setLoanPayments(payments) {
  const database = getDb();
  const tx = database.transaction((rows) => {
    database.prepare("DELETE FROM loan_payments").run();
    const stmt = database.prepare(
      "INSERT INTO loan_payments (loan_id, year_month, data) VALUES (?, ?, ?)"
    );
    for (const p of rows) stmt.run(p.loanId, p.yearMonth, JSON.stringify(p));
  });
  tx(payments);
}

function getLoanPaymentsForMonth(yearMonth) {
  return getDb()
    .prepare("SELECT data FROM loan_payments WHERE year_month = ?")
    .all(yearMonth)
    .map((r) => JSON.parse(r.data));
}

function getAllLoanPayments() {
  return getDb()
    .prepare("SELECT data FROM loan_payments ORDER BY year_month DESC")
    .all()
    .map((r) => JSON.parse(r.data));
}

function appendLoanPayment(payment) {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO loan_payments (loan_id, year_month, data) VALUES (?, ?, ?)"
    )
    .run(payment.loanId, payment.yearMonth, JSON.stringify(payment));
}

function setPayrollSplits(splits) {
  const database = getDb();
  const tx = database.transaction((rows) => {
    database.prepare("DELETE FROM payroll_splits").run();
    const stmt = database.prepare(
      "INSERT INTO payroll_splits (id, employee_id, year_month, data) VALUES (?, ?, ?, ?)"
    );
    for (const s of rows) stmt.run(s.id, s.employeeId, s.yearMonth, JSON.stringify(s));
  });
  tx(splits);
}

function getAllPayrollSplits() {
  return getDb()
    .prepare("SELECT data FROM payroll_splits ORDER BY year_month DESC, rowid DESC")
    .all()
    .map((r) => JSON.parse(r.data));
}

function getPayrollSplitsForMonth(yearMonth, employeeId) {
  let sql = "SELECT data FROM payroll_splits WHERE year_month = ?";
  const params = [yearMonth];
  if (employeeId) {
    sql += " AND employee_id = ?";
    params.push(employeeId);
  }
  return getDb()
    .prepare(sql)
    .all(...params)
    .map((r) => JSON.parse(r.data));
}

function upsertPayrollSplit(split) {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO payroll_splits (id, employee_id, year_month, data) VALUES (?, ?, ?, ?)"
    )
    .run(split.id, split.employeeId, split.yearMonth, JSON.stringify(split));
}

function deletePayrollSplitCache(id) {
  getDb().prepare("DELETE FROM payroll_splits WHERE id = ?").run(id);
}

function setBusinessCache(table, items) {
  setMeta(`biz_${table}`, JSON.stringify(items || []));
}

function getBusinessCache(table) {
  const raw = getMeta(`biz_${table}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

module.exports = {
  getDb,
  getCacheDir,
  setMeta,
  getMeta,
  getLastSync,
  setEmployees,
  getEmployees,
  upsertEmployee,
  removeEmployee,
  setAttendanceForMonth,
  getAttendanceForMonth,
  getAttendanceForEmployee,
  upsertAttendanceRecord,
  deleteAttendanceRecord,
  setBonusesForMonth,
  getBonusesForMonth,
  upsertBonus,
  deleteBonus,
  setDeductionsForMonth,
  getDeductionsForMonth,
  upsertDeduction,
  deleteDeduction,
  setPositionRates,
  getPositionRates,
  setPositionRateMonthly,
  getPositionRatesForMonth,
  upsertPositionRateMonthly,
  deletePositionRateMonthly,
  hasPositionRatesForMonth,
  setConfig,
  getConfigRaw,
  isCacheWarm,
  setPayrollAdjustmentsForMonth,
  getPayrollAdjustmentsForMonth,
  upsertPayrollAdjustment,
  setCommissionTypes,
  getCommissionTypes,
  setEmployeeDocuments,
  getEmployeeDocuments,
  appendEmployeeDocument,
  setEmployeeWarnings,
  getEmployeeWarnings,
  appendEmployeeWarning,
  setCommissionTiers,
  getCommissionTiersForMonth,
  setEmployeeLoans,
  getEmployeeLoans,
  upsertEmployeeLoan,
  deleteEmployeeLoanCache,
  setLoanPayments,
  getLoanPaymentsForMonth,
  getAllLoanPayments,
  appendLoanPayment,
  setPayrollSplits,
  getAllPayrollSplits,
  getPayrollSplitsForMonth,
  upsertPayrollSplit,
  deletePayrollSplitCache,
  setBusinessCache,
  getBusinessCache,
};

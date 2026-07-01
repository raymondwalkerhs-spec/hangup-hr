const sheets = require("./sheets");
const cache = require("./cache");
const changelog = require("./changelog");
const idGen = require("./id-generator");
const { autoWorkingDays } = require("./calendar");
const { resolveTransportEligible, defaultTransportEligible } = require("./month-profile");
const { summarizeEmployeeMonth, isPayrollEligible } = require("./attendance");
const {
  getEmployeeLoanDeductions,
  installmentsRemaining,
} = require("./loans");

const SYNC_MONTHS_BACK = 6;
const SYNC_MONTHS_FORWARD = 2;

function monthsToSync() {
  const now = new Date();
  const list = [];
  for (let i = -SYNC_MONTHS_BACK; i <= SYNC_MONTHS_FORWARD; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    list.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    );
  }
  return list;
}

async function syncFromSheet() {
  const [
    employees,
    config,
    rates,
    allAttendance,
    allBonuses,
    allDeductions,
    allAdjustments,
    commissionTypes,
    allDocuments,
    allWarnings,
    allCommissionTiers,
    allLoans,
    allLoanPayments,
    allPayrollSplits,
  ] = await Promise.all([
    sheets.readEmployees(),
    sheets.readConfig(),
    sheets.readPositionRates(),
    sheets.readAllAttendanceEvents(),
    sheets.readAllBonusEvents(),
    sheets.readAllDeductionEvents(),
    sheets.readAllPayrollAdjustments(),
    sheets.readCommissionTypes(),
    sheets.readAllEmployeeDocuments(),
    sheets.readAllEmployeeWarnings(),
    sheets.readAllCommissionTiers(),
    sheets.readAllEmployeeLoans(),
    sheets.readAllLoanPayments(),
    sheets.readAllPayrollSplits(),
  ]);

  if (config.hideOutEmployees === undefined) config.hideOutEmployees = true;

  cache.setEmployees(employees);
  cache.setConfig(config);
  cache.setPositionRates(rates);
  cache.setCommissionTypes(commissionTypes);
  cache.setEmployeeDocuments(allDocuments);
  cache.setEmployeeWarnings(allWarnings);
  cache.setCommissionTiers(allCommissionTiers);
  cache.setEmployeeLoans(allLoans);
  cache.setLoanPayments(allLoanPayments);
  cache.setPayrollSplits(allPayrollSplits);

  const syncMonths = monthsToSync();
  const adjustmentMonths = new Set(allAdjustments.map((a) => a.yearMonth));
  for (const ym of syncMonths) {
    const prefix = ym + "-";
    cache.setAttendanceForMonth(
      ym,
      allAttendance.filter((r) => r.date.startsWith(prefix))
    );
    cache.setBonusesForMonth(
      ym,
      allBonuses.filter((r) => r.date.startsWith(prefix))
    );
    cache.setDeductionsForMonth(
      ym,
      allDeductions.filter((r) => r.date.startsWith(prefix))
    );
    cache.setPayrollAdjustmentsForMonth(
      ym,
      allAdjustments.filter((a) => a.yearMonth === ym)
    );
  }
  for (const ym of adjustmentMonths) {
    if (!syncMonths.includes(ym)) {
      cache.setPayrollAdjustmentsForMonth(
        ym,
        allAdjustments.filter((a) => a.yearMonth === ym)
      );
    }
  }

  cache.setMeta("last_sync", new Date().toISOString());
  return {
    employees: employees.length,
    syncedAt: cache.getMeta("last_sync"),
  };
}

async function ensureSynced() {
  if (!cache.isCacheWarm()) {
    await syncFromSheet();
  }
}

function getEmployees(opts = {}) {
  const config = cache.getConfigRaw();
  const hideOut =
    opts.hideOut !== undefined ? opts.hideOut : config.hideOutEmployees;
  return idGen.filterEmployees(cache.getEmployees(), { ...opts, hideOut });
}

function getEmployeeById(id) {
  return cache.getEmployees().find((e) => e.id === id) || null;
}

function getConfig() {
  return cache.getConfigRaw();
}

function getPositionRates() {
  return cache.getPositionRates();
}

function getAttendanceEvents(yearMonth) {
  return cache.getAttendanceForMonth(yearMonth);
}

function getBonusEvents(yearMonth, employeeId) {
  let rows = cache.getBonusesForMonth(yearMonth);
  if (employeeId) rows = rows.filter((r) => r.employeeId === employeeId);
  return rows;
}

function getDeductionEvents(yearMonth, employeeId) {
  let rows = cache.getDeductionsForMonth(yearMonth);
  if (employeeId) rows = rows.filter((r) => r.employeeId === employeeId);
  return rows;
}

function getPayrollAdjustments(yearMonth) {
  return cache.getPayrollAdjustmentsForMonth(yearMonth);
}

function getPayrollAdjustment(yearMonth, employeeId) {
  return (
    cache.getPayrollAdjustmentsForMonth(yearMonth).find((a) => a.employeeId === employeeId) ||
    null
  );
}

function getCommissionTypes() {
  return cache.getCommissionTypes();
}

function getCommissionTiers(yearMonth) {
  return cache.getCommissionTiersForMonth(yearMonth);
}

function getEmployeeLoans(employeeId) {
  return cache.getEmployeeLoans(employeeId);
}

function getLoanPayments(yearMonth) {
  return yearMonth ? cache.getLoanPaymentsForMonth(yearMonth) : cache.getAllLoanPayments();
}

function getAllPayrollSplits() {
  return cache.getAllPayrollSplits();
}

function getPayrollSplitsForMonth(yearMonth, employeeId) {
  if (employeeId) {
    return cache
      .getAllPayrollSplits()
      .filter(
        (s) =>
          s.employeeId === employeeId &&
          (s.yearMonth === yearMonth ||
            (s.status === "deferred" && s.deferToMonth === yearMonth))
      );
  }
  return cache.getAllPayrollSplits().filter(
    (s) => s.yearMonth === yearMonth || (s.status === "deferred" && s.deferToMonth === yearMonth)
  );
}

function getPayrollExtras(yearMonth) {
  return {
    commissionTiers: getCommissionTiers(yearMonth),
    loans: getEmployeeLoans(),
    loanPayments: getLoanPayments(yearMonth),
  };
}

function getEmployeeDocuments(employeeId) {
  return cache.getEmployeeDocuments(employeeId);
}

function getEmployeeWarnings(employeeId) {
  return cache.getEmployeeWarnings(employeeId);
}

function buildAttendanceMap(month) {
  const records = cache.getAttendanceForMonth(month);
  const map = new Map();
  for (const r of records) {
    if (!map.has(r.employeeId)) map.set(r.employeeId, []);
    map.get(r.employeeId).push(r);
  }
  return map;
}

async function initMonthProfiles(yearMonth, username) {
  const employees = cache.getEmployees().filter(isPayrollEligible);
  const existing = new Set(
    cache.getPayrollAdjustmentsForMonth(yearMonth).map((a) => a.employeeId)
  );
  let count = 0;
  for (const emp of employees) {
    if (existing.has(emp.id)) continue;
    const prevMonth = (() => {
      const [y, m] = yearMonth.split("-").map(Number);
      const d = new Date(y, m - 2, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    })();
    const prev = cache
      .getPayrollAdjustmentsForMonth(prevMonth)
      .find((a) => a.employeeId === emp.id);
    const profile = prev
      ? {
          ...prev,
          yearMonth,
          payrollStatus: "pending",
          transportEligible: defaultTransportEligible(yearMonth),
        }
      : buildDefaultProfile(emp, yearMonth);
    await upsertPayrollAdjustment(profile, username);
    count += 1;
  }
  return count;
}

async function bulkSetTransportEligible(yearMonth, eligible, username) {
  const count = await sheets.bulkSetTransportEligibleForMonth(yearMonth, eligible, username);
  await refreshCache();
  return count;
}

async function upsertPositionRate(position, monthlySalary, username) {
  const rate = await sheets.upsertPositionRate(position, monthlySalary);
  cache.setPositionRates(
    cache
      .getPositionRates()
      .filter((r) => r.position !== position)
      .concat([rate])
  );
  await changelog.logConfigChange(username, `positionRate.${position}`, null, monthlySalary);
  return rate;
}

async function refreshCache() {
  return syncFromSheet();
}

async function getWorkingDaysForMonth(yearMonth) {
  await ensureSynced();
  const config = getConfig();
  if (config.workingDaysByMonth?.[yearMonth] != null) {
    return config.workingDaysByMonth[yearMonth];
  }
  const auto = autoWorkingDays(yearMonth);
  config.workingDaysByMonth = config.workingDaysByMonth || {};
  config.workingDaysByMonth[yearMonth] = auto;
  await sheets.saveConfigKey("workingDaysByMonth", config.workingDaysByMonth);
  cache.setConfig(config);
  await changelog.logConfigChange("system", "workingDaysByMonth", null, config.workingDaysByMonth);
  return auto;
}

async function createEmployee(emp, username) {
  const mapped = sheets.mapEmployeeRow(emp);
  const created = await sheets.createEmployee(mapped, username);
  cache.upsertEmployee(created);
  await changelog.logEmployeeChange(username, "create", created, null, "id");
  return created;
}

async function updateEmployee(id, updates, username) {
  const old = getEmployeeById(id);
  const updated = await sheets.updateEmployee(id, updates, username);
  cache.upsertEmployee(updated);
  for (const key of Object.keys(updates)) {
    if (old?.[key] !== updated[key]) {
      await changelog.logEmployeeChange(username, "update", updated, old, key);
    }
  }
  return updated;
}

async function saveAttendanceBatch(records, username) {
  if (!records.length) return 0;
  const oldMap = new Map();
  const ym = records[0].date.slice(0, 7);
  for (const r of cache.getAttendanceForMonth(ym)) {
    oldMap.set(`${r.employeeId}|${r.date}`, r);
  }

  const merged = records.map((record) => {
    const key = `${record.employeeId}|${record.date}`;
    const prior = oldMap.get(key);
    const halfStatuses = new Set(["Half Day", "NSNC Half Day"]);
    let transportOverride =
      record.transportOverride !== undefined
        ? record.transportOverride
        : prior?.transportOverride || "";
    if (!halfStatuses.has(record.status || "")) transportOverride = "";
    return { ...record, transportOverride };
  });

  const oldStatusMap = new Map();
  for (const r of cache.getAttendanceForMonth(ym)) {
    oldStatusMap.set(`${r.employeeId}|${r.date}`, r.status);
  }

  await sheets.batchUpsertAttendance(merged, username);

  for (const record of merged) {
    cache.upsertAttendanceRecord(record);
    const key = `${record.employeeId}|${record.date}`;
    const oldStatus = oldStatusMap.get(key);
    if (oldStatus !== record.status) {
      await changelog.logAttendanceChange(
        username,
        oldStatus ? "update" : "create",
        record,
        oldStatus
      );
    }
  }
  return merged.length;
}

async function saveAttendanceRow(record, username) {
  return saveAttendanceBatch([record], username);
}

async function initMonthWeekends(records, username) {
  return saveAttendanceBatch(records, username);
}

async function saveConfigKey(key, value, username) {
  const config = getConfig();
  const oldVal = config[key];
  await sheets.saveConfigKey(key, value);
  config[key] = value;
  cache.setConfig(config);
  await changelog.logConfigChange(username, key, oldVal, value);
}

async function setWorkingDays(month, workingDays, username) {
  const config = getConfig();
  const old = config.workingDaysByMonth?.[month];
  config.workingDaysByMonth = config.workingDaysByMonth || {};
  config.workingDaysByMonth[month] = Number(workingDays);
  await sheets.saveConfigKey("workingDaysByMonth", config.workingDaysByMonth);
  cache.setConfig(config);
  await changelog.logConfigChange(username, `workingDays.${month}`, old, workingDays);
  return Number(workingDays);
}

async function setHideOutEmployees(hide, username) {
  return saveConfigKey("hideOutEmployees", hide, username);
}

async function upsertBonus(record, username) {
  await sheets.upsertBonusEvent(record, username);
  cache.upsertBonus(record);
  await changelog.logBonusChange(username, "upsert", record);
}

async function deleteBonus(employeeId, date, type, username) {
  await sheets.deleteBonusEvent(employeeId, date, type);
  cache.deleteBonus(employeeId, date, type);
  await changelog.logBonusChange(username, "delete", {
    employeeId,
    date,
    type,
    amount: 0,
  });
}

async function upsertDeduction(record, username) {
  await sheets.upsertDeductionEvent(record, username);
  cache.upsertDeduction(record);
  await changelog.logDeductionChange(username, "upsert", record);
}

async function deleteDeduction(employeeId, date, type, username) {
  await sheets.deleteDeductionEvent(employeeId, date, type);
  cache.deleteDeduction(employeeId, date, type);
  await changelog.logDeductionChange(username, "delete", {
    employeeId,
    date,
    type,
    amount: 0,
  });
}

async function upsertPayrollAdjustment(record, username) {
  const emp = getEmployeeById(record.employeeId);
  const merged = mergeProfile(
    getPayrollAdjustment(record.yearMonth, record.employeeId),
    record,
    emp || { id: record.employeeId }
  );
  const saved = await sheets.upsertPayrollAdjustment(merged, username);
  cache.upsertPayrollAdjustment(saved);
  await changelog.logMonthProfileChange(username, "upsert", saved);

  if (record.payrollStatus === "closed" || record.payrollStatus === "received") {
    await recordLoanPaymentsForEmployee(record.yearMonth, record.employeeId, username);
  }
  return saved;
}

async function createPayrollSplit(split, username) {
  const saved = await sheets.appendPayrollSplit(split, username);
  cache.upsertPayrollSplit(saved);
  await changelog.logMonthProfileChange(username, "payroll_split_create", saved);
  return saved;
}

async function updatePayrollSplitRecord(split, username) {
  const saved = await sheets.updatePayrollSplit(split, username);
  cache.upsertPayrollSplit(saved);
  await changelog.logMonthProfileChange(username, "payroll_split_update", saved);
  return saved;
}

async function removePayrollSplit(id, username) {
  await sheets.deletePayrollSplit(id);
  cache.deletePayrollSplitCache(id);
  await changelog.logMonthProfileChange(username, "payroll_split_delete", { id });
  return true;
}

async function setCommissionTiersForMonth(yearMonth, tiers, username) {
  const normalized = (tiers || [])
    .map((t) => ({
      yearMonth,
      minSales: parseInt(t.minSales, 10) || 0,
      bonusAmount: Number(t.bonusAmount) || 0,
      label: t.label || `${t.minSales}+ sales`,
    }))
    .filter((t) => t.minSales > 0)
    .sort((a, b) => a.minSales - b.minSales);
  await sheets.writeCommissionTiersForMonth(yearMonth, normalized);
  const all = await sheets.readAllCommissionTiers();
  cache.setCommissionTiers(all);
  await changelog.logConfigChange(username, `commissionTiers.${yearMonth}`, null, normalized);
  return normalized;
}

async function createEmployeeLoan(loan, username) {
  const createdYearMonth = loan.createdYearMonth || new Date().toISOString().slice(0, 7);
  const amounts = normalizeLoanAmounts(loan);
  const saved = await sheets.appendEmployeeLoan(
    {
      ...loan,
      ...amounts,
      createdYearMonth,
      skipCurrentMonth: loan.skipCurrentMonth === true,
    },
    username
  );
  cache.upsertEmployeeLoan(saved);
  await changelog.logEmployeeChange(username, "loan", { id: loan.employeeId }, null, saved.id);
  return saved;
}

function normalizeLoanAmounts(loan) {
  const totalAmount = Number(loan.totalAmount) || 0;
  let installmentAmount = Number(loan.installmentAmount) || 0;
  let installmentsCount = parseInt(loan.installmentsCount, 10) || 0;
  if (!installmentsCount && installmentAmount && totalAmount) {
    installmentsCount = Math.ceil(totalAmount / installmentAmount);
  } else if (installmentsCount && !installmentAmount && totalAmount) {
    installmentAmount = Math.round((totalAmount / installmentsCount) * 100) / 100;
  } else if (!installmentsCount) {
    installmentsCount = 1;
  }
  if (!installmentAmount) installmentAmount = totalAmount;
  return { totalAmount, installmentAmount, installmentsCount };
}

async function updateEmployeeLoanRecord(loanId, updates, username) {
  const existing = cache.getEmployeeLoans().find((l) => l.id === loanId);
  if (!existing) throw new Error("Loan not found");
  const hasPayments = cache.getAllLoanPayments().some((p) => p.loanId === loanId);
  const paid = existing.installmentsPaid || 0;

  if (paid > 0 || hasPayments) {
    const changingAmounts =
      (updates.totalAmount != null && Number(updates.totalAmount) !== existing.totalAmount) ||
      (updates.installmentAmount != null &&
        Number(updates.installmentAmount) !== existing.installmentAmount) ||
      (updates.installmentsCount != null &&
        parseInt(updates.installmentsCount, 10) !== existing.installmentsCount);
    if (changingAmounts) {
      throw new Error("Cannot change loan amounts after payments have been recorded");
    }
  }

  const { computeStartYearMonth } = require("./loans");
  let merged = { ...existing, ...updates, id: existing.id, employeeId: existing.employeeId };

  if (paid === 0 && !hasPayments) {
    const amounts = normalizeLoanAmounts(merged);
    merged = {
      ...merged,
      ...amounts,
      skipCurrentMonth: updates.skipCurrentMonth === true,
      startYearMonth: computeStartYearMonth(
        merged.createdYearMonth,
        updates.skipCurrentMonth === true
      ),
    };
  } else {
    merged = {
      ...merged,
      notes: updates.notes ?? existing.notes,
      status: updates.status ?? existing.status,
    };
  }

  const saved = await sheets.updateEmployeeLoan(merged);
  cache.upsertEmployeeLoan(saved);
  await changelog.logEmployeeChange(username, "loan_update", { id: existing.employeeId }, existing, saved.id);
  return saved;
}

async function removeEmployeeLoan(loanId, username) {
  const existing = cache.getEmployeeLoans().find((l) => l.id === loanId);
  if (!existing) throw new Error("Loan not found");
  const hasPayments = cache.getAllLoanPayments().some((p) => p.loanId === loanId);
  if ((existing.installmentsPaid || 0) > 0 || hasPayments) {
    throw new Error("Cannot delete a loan with recorded payments. Cancel it instead.");
  }
  await sheets.deleteEmployeeLoan(loanId);
  cache.deleteEmployeeLoanCache(loanId);
  await changelog.logEmployeeChange(username, "loan_delete", { id: existing.employeeId }, existing, loanId);
  return true;
}

async function cancelEmployeeLoan(loanId, username) {
  return updateEmployeeLoanRecord(loanId, { status: "cancelled" }, username);
}

async function recordLoanPayment(loanId, yearMonth, username) {
  const loans = cache.getEmployeeLoans();
  const loan = loans.find((l) => l.id === loanId);
  if (!loan) throw new Error("Loan not found");
  if (loan.status !== "active") return null;

  const existing = cache.getLoanPaymentsForMonth(yearMonth);
  if (existing.some((p) => p.loanId === loanId)) return null;

  const pending = getEmployeeLoanDeductions([loan], loan.employeeId, yearMonth, existing);
  const deduction = pending[0];
  if (!deduction) return null;

  const payment = await sheets.appendLoanPayment(
    {
      loanId: loan.id,
      employeeId: loan.employeeId,
      yearMonth,
      amount: deduction.amount,
      installmentNumber: deduction.installmentNumber,
    },
    username
  );
  cache.appendLoanPayment(payment);

  const newPaid = (loan.installmentsPaid || 0) + 1;
  const updated = {
    ...loan,
    installmentsPaid: newPaid,
    status: installmentsRemaining({ ...loan, installmentsPaid: newPaid }) <= 0 ? "completed" : "active",
  };
  await sheets.updateEmployeeLoan(updated);
  cache.upsertEmployeeLoan(updated);
  return payment;
}

async function recordLoanPaymentsForMonth(yearMonth, username) {
  const loans = cache.getEmployeeLoans().filter((l) => l.status === "active");
  const payments = [];
  for (const loan of loans) {
    const payment = await recordLoanPayment(loan.id, yearMonth, username);
    if (payment) payments.push(payment);
  }
  return payments;
}

async function recordLoanPaymentsForEmployee(yearMonth, employeeId, username) {
  const loans = cache.getEmployeeLoans(employeeId).filter((l) => l.status === "active");
  const payments = [];
  for (const loan of loans) {
    const payment = await recordLoanPayment(loan.id, yearMonth, username);
    if (payment) payments.push(payment);
  }
  return payments;
}

async function addEmployeeWarning(warning, username) {
  const saved = await sheets.appendEmployeeWarning(warning, username);
  cache.appendEmployeeWarning(saved);
  await changelog.logWarningChange(username, "create", saved);
  return saved;
}

async function uploadEmployeeDocument(doc, username) {
  const saved = await sheets.appendEmployeeDocument(doc, username);
  cache.appendEmployeeDocument(saved);
  await changelog.logEmployeeChange(username, "document", { id: doc.employeeId }, null, doc.docType);
  return saved;
}

async function uploadEmployeeProfilePhoto(employeeId, uploadResult, username) {
  const updated = await updateEmployee(
    employeeId,
    {
      profile_photo_file_id: uploadResult.fileId,
      profile_photo_link: uploadResult.link,
      profile_photo_updated: new Date().toISOString(),
    },
    username
  );
  return updated;
}

async function removeEmployeeProfilePhoto(employeeId, username) {
  const emp = getEmployeeById(employeeId);
  if (emp?.profile_photo_file_id) {
    const documents = require("./documents");
    await documents.deleteDriveFile(emp.profile_photo_file_id);
  }
  return updateEmployee(
    employeeId,
    {
      profile_photo_file_id: "",
      profile_photo_link: "",
      profile_photo_updated: "",
    },
    username
  );
}

function suggestNextId(unit, backendPool) {
  return idGen.suggestNextId(cache.getEmployees(), unit, backendPool);
}

function getTeams(unit) {
  return idGen.getTeamsForUnit(cache.getEmployees(), unit);
}

function getUnits() {
  return idGen.getUnits(cache.getEmployees());
}

module.exports = {
  syncFromSheet,
  ensureSynced,
  refreshCache,
  getEmployees,
  getEmployeeById,
  getConfig,
  getPositionRates,
  getAttendanceEvents,
  getBonusEvents,
  getDeductionEvents,
  getPayrollAdjustments,
  getPayrollAdjustment,
  getCommissionTypes,
  getCommissionTiers,
  getEmployeeLoans,
  getLoanPayments,
  getAllPayrollSplits,
  getPayrollSplitsForMonth,
  getPayrollExtras,
  getEmployeeDocuments,
  getEmployeeWarnings,
  buildAttendanceMap,
  initMonthProfiles,
  bulkSetTransportEligible,
  upsertPositionRate,
  getWorkingDaysForMonth,
  createEmployee,
  updateEmployee,
  saveAttendanceBatch,
  saveAttendanceRow,
  initMonthWeekends,
  saveConfigKey,
  setWorkingDays,
  setHideOutEmployees,
  upsertBonus,
  deleteBonus,
  upsertDeduction,
  deleteDeduction,
  upsertPayrollAdjustment,
  createPayrollSplit,
  updatePayrollSplitRecord,
  removePayrollSplit,
  setCommissionTiersForMonth,
  createEmployeeLoan,
  updateEmployeeLoanRecord,
  removeEmployeeLoan,
  cancelEmployeeLoan,
  recordLoanPayment,
  recordLoanPaymentsForMonth,
  recordLoanPaymentsForEmployee,
  addEmployeeWarning,
  uploadEmployeeDocument,
  uploadEmployeeProfilePhoto,
  removeEmployeeProfilePhoto,
  suggestNextId,
  getTeams,
  getUnits,
  getLastSync: cache.getLastSync,
  isCacheWarm: cache.isCacheWarm,
  readChangeLog: changelog.readChangeLog,
  SHEET_ID: sheets.SHEET_ID,
  EMPLOYEE_STATUSES: sheets.EMPLOYEE_STATUSES,
  BACKEND_POOLS: idGen.BACKEND_POOLS,
};

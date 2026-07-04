const backendMod = require("./backend");
const backend = backendMod.getBackend();
const cache = require("./cache");
const changelog = require("./changelog");
const { TRANSPORT_OVERRIDE_STATUSES } = require("./transport");
const idGen = require("./id-generator");
const employeeIds = require("./employee-ids");
const employeeIdentity = require("./employee-identity");
const { autoWorkingDays } = require("./calendar");
const { resolveTransportEligible, defaultTransportEligible } = require("./month-profile");
const { summarizeEmployeeMonth, isPayrollEligible, isPayrollEligibleForMonth } = require("./attendance");
const {
  getEmployeeLoanDeductions,
  installmentsRemaining,
} = require("./loans");

const monthLookupStore = {
  getEmployeeById,
  getAttendanceEvents,
  getBonusEvents,
  getDeductionEvents,
  getPayrollAdjustments,
};

function groupByYearMonth(items, field) {
  const map = new Map();
  for (const item of items) {
    const raw = item[field];
    if (!raw) continue;
    const ym = String(raw).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    if (!map.has(ym)) map.set(ym, []);
    map.get(ym).push(item);
  }
  return map;
}

function cacheMonthKeyedRecords(allAttendance, allBonuses, allDeductions, allAdjustments) {
  for (const [ym, rows] of groupByYearMonth(allAttendance, "date")) {
    cache.setAttendanceForMonth(ym, rows);
  }
  for (const [ym, rows] of groupByYearMonth(allBonuses, "date")) {
    cache.setBonusesForMonth(ym, rows);
  }
  for (const [ym, rows] of groupByYearMonth(allDeductions, "date")) {
    cache.setDeductionsForMonth(ym, rows);
  }
  for (const [ym, rows] of groupByYearMonth(allAdjustments, "yearMonth")) {
    cache.setPayrollAdjustmentsForMonth(ym, rows);
  }
}

let syncInFlight = null;

async function syncFromSheet() {
  if (syncInFlight) return syncInFlight;
  syncInFlight = syncFromSheetInner().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

async function syncFromSheetInner() {
  const syncWork = (async () => {
  const [
    employees,
    config,
    rates,
    monthlyRates,
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
    backend.readEmployees(),
    backend.readConfig(),
    backend.readPositionRates(),
    backend.readAllPositionRateMonthly ? backend.readAllPositionRateMonthly() : Promise.resolve([]),
    backend.readAllAttendanceEvents(),
    backend.readAllBonusEvents(),
    backend.readAllDeductionEvents(),
    backend.readAllPayrollAdjustments(),
    backend.readCommissionTypes(),
    backend.readAllEmployeeDocuments(),
    backend.readAllEmployeeWarnings(),
    backend.readAllCommissionTiers(),
    backend.readAllEmployeeLoans(),
    backend.readAllLoanPayments(),
    backend.readAllPayrollSplits(),
  ]);

  if (config.hideOutEmployees === undefined) config.hideOutEmployees = true;

  cache.setEmployees(employees);
  cache.setConfig(config);
  cache.setPositionRates(rates);
  if (monthlyRates?.length) cache.setPositionRateMonthly(monthlyRates);
  if (backendMod.useSupabase()) {
    try {
      const { getSupabaseAdmin } = require("./supabase-client");
      const { data: appUsers } = await getSupabaseAdmin().from("app_users").select("username, employee_id");
      const linkMap = {};
      for (const u of appUsers || []) {
        if (u.employee_id) linkMap[String(u.username || "").toLowerCase()] = u.employee_id;
      }
      cache.setMeta("app_user_employee_ids", JSON.stringify(linkMap));
    } catch {
      /* optional */
    }
  }
  cache.setCommissionTypes(commissionTypes);
  cache.setEmployeeDocuments(allDocuments);
  cache.setEmployeeWarnings(allWarnings);
  cache.setCommissionTiers(allCommissionTiers);
  cache.setEmployeeLoans(allLoans);
  cache.setLoanPayments(allLoanPayments);
  cache.setPayrollSplits(allPayrollSplits);

  cacheMonthKeyedRecords(allAttendance, allBonuses, allDeductions, allAdjustments);

  cache.setMeta("last_sync", new Date().toISOString());

  if (backendMod.useSupabase()) {
    try {
      const business = require("./business-repo");
      const [sales, expenses, bills, bonusReqs] = await Promise.all([
        business.readSales({}, { skipCache: true }),
        business.readExpenseRequests({ excludeArchived: false }, { skipCache: true }),
        business.readMonthlyBills({ skipCache: true }),
        business.readBonusRequests({}, { skipCache: true }),
      ]);
      cache.setBusinessCache("sales", sales);
      cache.setBusinessCache("expenses", expenses);
      cache.setBusinessCache("monthly_bills", bills);
      cache.setBusinessCache("bonus_requests", bonusReqs);
    } catch {
      /* business tables optional during rollout */
    }
  }

  return {
    employees: employees.length,
    syncedAt: cache.getMeta("last_sync"),
  };
  })();

  return Promise.race([
    syncWork,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Sync timed out after 90s. Check Supabase connection.")), 90000)
    ),
  ]);
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
  const month = opts.month || new Date().toISOString().slice(0, 7);
  return idGen.filterEmployees(cache.getEmployees(), { ...opts, hideOut, month });
}

function getEmployeesForMonth(month, opts = {}) {
  const config = cache.getConfigRaw();
  const hideOut =
    opts.hideOut !== undefined ? opts.hideOut : config.hideOutEmployees;
  const attendanceRecords = cache.getAttendanceForMonth(month) || [];
  const base = idGen.filterEmployees(cache.getEmployees(), {
    hideOut: false,
    month,
    attendanceRecords,
  });
  let merged = employeeIds.mergeEmployeesForMonth(base, monthLookupStore, month);
  if (hideOut) {
    merged = merged.filter((emp) =>
      require("./depart-attendance").shouldShowInMonth(emp, month, attendanceRecords, { hideOut: true })
    );
  }
  return merged;
}

function getEmployeeById(id) {
  if (!id) return null;
  const employees = cache.getEmployees();
  const direct = employees.find((e) => e.id === id);
  if (direct) return direct;
  const byArchived = employees.find((e) => e.archived_app_id === id);
  if (byArchived) return byArchived;
  const byInternal = employees.find((e) => e.internal_id === id);
  if (byInternal) return byInternal;
  return (
    employees.find((e) => employeeIds.parseFormerIds(e.former_ids).includes(id)) || null
  );
}

async function promoteEmployee(oldId, { newId, leadRole, effectiveFromMonth, position, team }, username) {
  const old = getEmployeeById(oldId);
  if (!old) throw new Error("Employee not found");
  if (old.promoted_to_id) throw new Error("This agent record was already superseded by promotion");
  if (getEmployeeById(newId)) throw new Error(`Employee ID ${newId} already exists`);

  const role = String(leadRole || "TL").toUpperCase();
  if (role === "AGENT") {
    const idGen = require("./id-generator");
    idGen.validateAppIdForUnit(newId, old.unit, null, getEmployees({ hideOut: false, includeDeleted: true }));
  }
  const backendRoles = employeeIds.BACKEND_TRANSFER_ROLES || [];
  if (
    role !== "AGENT" &&
    !employeeIds.LEAD_ID_PREFIXES.includes(role) &&
    !backendRoles.includes(role)
  ) {
    throw new Error(
      `Lead role must be one of: ${employeeIds.LEAD_ID_PREFIXES.join(", ")}, ${backendRoles.join(", ")}, Agent`
    );
  }

  const roles = require("./roles");
  const eff =
    effectiveFromMonth ||
    roles.localYearMonth();

  const isBackend = backendRoles.includes(role);
  const newEmp = {
    ...old,
    id: newId,
    promoted_from_id: oldId,
    promoted_to_id: null,
    former_ids: employeeIds.mergeFormerIds(old.former_ids, oldId),
    lead_role: role === "AGENT" ? null : role,
    position:
      position ||
      (role !== "AGENT" ? employeeIds.LEAD_POSITIONS[role] : old.position) ||
      old.position,
    team: team || (isBackend ? (role === "HR" ? "HR" : role === "RTM" ? "Quality" : "Back-End") : old.team),
    unit: isBackend ? "HS-Back-End" : old.unit,
    effective_from_month: eff,
    status: old.status === "Out" ? old.status : "Active",
  };

  await createEmployee(newEmp, username);
  await updateEmployee(
    oldId,
    {
      promoted_to_id: newId,
      status: old.status === "Out" ? "Out" : old.status || "Active",
    },
    username
  );
  if (backendMod.useSupabase()) {
    try {
      const created = getEmployeeById(newId);
      if (created?.internal_id) {
        await employeeIdentity.syncAllInternalIdsForAppId(newId, created.internal_id);
      }
    } catch (err) {
      console.warn(`internal_id sync after promote failed:`, err.message);
    }
    try {
      const usersAdmin = require("./users-admin");
      const existingLogin = await usersAdmin.getAppUser(oldId);
      if (existingLogin) {
        await usersAdmin.updateAppUser(oldId, { status: "inactive" }, username);
      }
      await usersAdmin.upsertEmployeeLogin(
        { employeeId: newId, role: usersAdmin.inferRoleFromEmployeeId(newId) },
        username
      );
    } catch (err) {
      console.warn(`login update after promote failed for ${oldId}→${newId}:`, err.message);
    }
  }
  return { oldId, newId, effectiveFromMonth: eff, employee: getEmployeeById(newId) };
}

async function revertPromotion(successorId, username) {
  const successor = getEmployeeById(successorId);
  if (!successor) throw new Error("Employee not found");
  const oldId = successor.promoted_from_id;
  if (!oldId) throw new Error("This employee was not created by promotion");

  const old = getEmployeeById(oldId);
  if (!old) throw new Error(`Original agent record ${oldId} not found`);

  await employeeIdentity.reassignAppIdReferences(successorId, oldId);

  await updateEmployee(
    oldId,
    {
      promoted_to_id: null,
      status: old.status === "Out" ? "Out" : "Active",
      team: successor.team || old.team,
      position: successor.position || old.position,
      unit: successor.unit || old.unit,
      lead_role: null,
    },
    username
  );

  if (backendMod.useSupabase()) {
    await backend.deleteEmployee(successorId);
    cache.removeEmployee(successorId);
    try {
      const usersAdmin = require("./users-admin");
      const succLogin = await usersAdmin.getAppUser(successorId);
      if (succLogin) await usersAdmin.deleteAppUser(successorId, username);
      const oldLogin = await usersAdmin.getAppUser(oldId);
      if (oldLogin) {
        await usersAdmin.updateAppUser(oldId, { status: "active" }, username);
      } else {
        await usersAdmin.upsertEmployeeLogin(
          { employeeId: oldId, role: usersAdmin.inferRoleFromEmployeeId(oldId) },
          username
        );
      }
    } catch (err) {
      console.warn(`login update after revert failed for ${successorId}→${oldId}:`, err.message);
    }
    if (old.internal_id) {
      await employeeIdentity.syncAllInternalIdsForAppId(oldId, old.internal_id);
    }
  }

  await changelog.logEmployeeChange(username, "revert_promotion", old, {
    promoted_to_id: null,
  }, successorId);

  return { oldId, revertedFromId: successorId, employee: getEmployeeById(oldId) };
}

async function changeEmployeeAppId(oldId, newId, username) {
  const emp = getEmployeeById(oldId);
  if (!emp) throw new Error("Employee not found");
  if (employeeIdentity.isDeletedEmployee(emp)) throw new Error("Cannot change app ID on deleted record");

  const idGen = require("./id-generator");
  const pool = emp.unit === "HS-Back-End" ? emp.backend_pool || emp.backendPool : null;
  idGen.validateAppIdForUnit(newId, emp.unit, pool, getEmployees({ hideOut: false, includeDeleted: true }));

  const result = await employeeIdentity.migrateEmployeeAppId(oldId, newId);
  const refreshed = await backend.getEmployeeById(newId);
  if (refreshed) cache.upsertEmployee(refreshed);
  else {
    cache.removeEmployee(oldId);
    cache.upsertEmployee({ ...emp, id: newId });
  }

  if (backendMod.useSupabase()) {
    try {
      const usersAdmin = require("./users-admin");
      const login = await usersAdmin.getAppUser(oldId);
      if (login) {
        await usersAdmin.deleteAppUser(oldId, username);
        await usersAdmin.upsertEmployeeLogin(
          { employeeId: newId, role: usersAdmin.inferRoleFromEmployeeId(newId) },
          username
        );
      }
    } catch (err) {
      console.warn(`login update after app id change failed:`, err.message);
    }
  }

  await changelog.logEmployeeChange(username, "app_id_change", emp, { id: newId }, oldId);
  return { ...result, employee: getEmployeeById(newId) };
}

async function releaseEmployeeAppId(appId, username) {
  const emp = getEmployeeById(appId);
  if (!emp) throw new Error("Employee not found");
  if (employeeIdentity.isUnassignedIdStub(emp)) {
    await backend.deleteEmployee(appId);
    cache.removeEmployee(appId);
    return { releasedAppId: appId, deleted: true, stub: true };
  }

  const result = await employeeIdentity.releaseEmployeeAppId(appId, username);
  cache.removeEmployee(appId);
  const updated = await backend.getEmployeeById(result.placeholderId);
  if (updated) cache.upsertEmployee(updated);

  await changelog.logEmployeeChange(
    username,
    "release_app_id",
    emp,
    { status: "Deleted", archived_app_id: result.archivedAppId },
    appId
  );
  return result;
}

function getConfig() {
  return cache.getConfigRaw();
}

function getPositionRates(yearMonth) {
  if (yearMonth) return cache.getPositionRatesForMonth(yearMonth);
  return cache.getPositionRates();
}

function getAppUserEmployeeId(username) {
  try {
    const map = JSON.parse(cache.getMeta("app_user_employee_ids") || "{}");
    return map[String(username || "").toLowerCase()] || null;
  } catch {
    return null;
  }
}

function getAttendanceEvents(yearMonth) {
  return cache.getAttendanceForMonth(yearMonth);
}

function getAttendanceForEmployee(employeeId) {
  return cache.getAttendanceForEmployee(employeeId);
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

async function upsertCommissionType(type, username) {
  if (!backend.upsertCommissionType) throw new Error("Commission type CRUD requires Supabase backend");
  const saved = await backend.upsertCommissionType(type);
  const types = cache.getCommissionTypes();
  const idx = types.findIndex((t) => t.name === saved.name);
  if (idx >= 0) types[idx] = saved;
  else types.push(saved);
  cache.setCommissionTypes(types);
  await changelog.logConfigChange(username, "commission_type", saved.name, null, saved);
  return saved;
}

async function deleteCommissionType(name, username) {
  if (!backend.deleteCommissionType) throw new Error("Commission type CRUD requires Supabase backend");
  await backend.deleteCommissionType(name);
  cache.setCommissionTypes(cache.getCommissionTypes().filter((t) => t.name !== name));
  await changelog.logConfigChange(username, "commission_type", name, "delete", null);
}

async function updateTaxRules(taxRules, username) {
  await backend.saveConfigKey("taxRules", taxRules);
  const config = cache.getConfig();
  config.taxRules = taxRules;
  cache.setConfig(config);
  await changelog.logConfigChange(username, "taxRules", null, null, taxRules);
  return taxRules;
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
  const records = cache.getAttendanceEvents(yearMonth);
  const recordsByEmployee = new Map();
  for (const r of records) {
    if (!recordsByEmployee.has(r.employeeId)) recordsByEmployee.set(r.employeeId, []);
    recordsByEmployee.get(r.employeeId).push(r);
  }
  const employees = cache.getEmployees().filter((emp) =>
    isPayrollEligibleForMonth(emp, yearMonth, recordsByEmployee.get(emp.id) || [])
  );
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
    try {
      await recalcSalesCountForEmployee(yearMonth, emp.id, username);
    } catch {
      /* optional */
    }
    count += 1;
  }
  if (backend.copyPositionRatesMonth && !cache.hasPositionRatesForMonth(yearMonth)) {
    const prevMonth = (() => {
      const [y, m] = yearMonth.split("-").map(Number);
      const d = new Date(y, m - 2, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    })();
    const copied = await backend.copyPositionRatesMonth(prevMonth, yearMonth);
    if (copied) {
      const monthly = await backend.readAllPositionRateMonthly();
      cache.setPositionRateMonthly(monthly);
    }
  }
  return count;
}

async function bulkSetTransportEligible(yearMonth, eligible, username) {
  const count = await backend.bulkSetTransportEligibleForMonth(yearMonth, eligible, username);
  await refreshCache();
  return count;
}

async function upsertPositionRate(position, monthlySalary, username, yearMonth) {
  const ym = yearMonth || new Date().toISOString().slice(0, 7);
  const rate = backend.upsertPositionRateForMonth
    ? await backend.upsertPositionRateForMonth(ym, position, monthlySalary)
    : await backend.upsertPositionRate(position, monthlySalary);
  cache.upsertPositionRateMonthly(ym, position, monthlySalary);
  cache.setPositionRates(
    cache
      .getPositionRates()
      .filter((r) => r.position !== position)
      .concat([{ position, monthlySalary: Number(monthlySalary) || 0 }])
  );
  await changelog.logConfigChange(username, `positionRate.${ym}.${position}`, null, monthlySalary);
  return rate;
}

async function deletePositionRate(position, username, yearMonth) {
  const ym = yearMonth || new Date().toISOString().slice(0, 7);
  const existing = cache.getPositionRatesForMonth(ym).find((r) => r.position === position);
  if (backend.deletePositionRateForMonth) {
    await backend.deletePositionRateForMonth(ym, position);
  } else {
    await backend.deletePositionRate(position);
  }
  cache.deletePositionRateMonthly(ym, position);
  await changelog.logConfigChange(
    username,
    `positionRate.${ym}.${position}`,
    existing?.monthlySalary ?? null,
    null
  );
}

async function recalcSalesCountForEmployee(yearMonth, employeeId, username) {
  const { countSalesForAgentMonth } = require("./sales-count");
  const business = require("./business-repo");
  const sales = await business.readSales({}, { skipCache: true });
  const count = countSalesForAgentMonth(sales, employeeId, yearMonth);
  const emp = getEmployeeById(employeeId);
  if (!emp) throw new Error("Employee not found");
  const existing = getPayrollAdjustment(yearMonth, employeeId);
  const { buildDefaultProfile } = require("./month-profile");
  const record = { ...(existing || buildDefaultProfile(emp, yearMonth)), salesCount: count };
  return upsertPayrollAdjustment(record, username);
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
  return autoWorkingDays(yearMonth);
}

async function createEmployee(emp, username) {
  const mapped = backend.mapEmployeeRow(emp);
  const { sanitizeEmployeeComplianceFields } = require("./employee-compliance");
  if (mapped.id && mapped.unit) {
    const idGen = require("./id-generator");
    const employees = await getEmployeesForIdAllocation();
    idGen.validateAppIdForUnit(
      mapped.id,
      mapped.unit,
      mapped.backend_pool || mapped.backendPool,
      employees
    );
  }
  if (!mapped.employment_date) {
    mapped.employment_date = new Date().toISOString().slice(0, 10);
  }
  if (!mapped.probation_end_date && mapped.employment_date) {
    const d = new Date(mapped.employment_date);
    d.setDate(d.getDate() + 90);
    mapped.probation_end_date = d.toISOString().slice(0, 10);
  }
  const created = await backend.createEmployee(sanitizeEmployeeComplianceFields(mapped), username);
  cache.upsertEmployee(created);
  await changelog.logEmployeeChange(username, "create", created, null, "id");
  if (backendMod.useSupabase()) {
    try {
      await require("./users-admin").upsertEmployeeLogin({ employeeId: created.id }, username);
    } catch (err) {
      console.warn(`upsertEmployeeLogin failed for ${created.id}:`, err.message);
    }
    try {
      await require("./hrms-repo").insertEmploymentPeriodRecord(
        created.id,
        { startDate: created.employment_date, endDate: null, notes: "Initial hire" },
        username
      );
    } catch (err) {
      console.warn(`employment period bootstrap failed for ${created.id}:`, err.message);
    }
  }
  return created;
}

async function updateEmployee(id, updates, username) {
  const old = getEmployeeById(id);
  const { sanitizeEmployeeComplianceFields } = require("./employee-compliance");
  const updated = await backend.updateEmployee(id, sanitizeEmployeeComplianceFields({ ...old, ...updates }), username);
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
    let transportOverride =
      record.transportOverride !== undefined
        ? record.transportOverride
        : prior?.transportOverride || "";
    if (!TRANSPORT_OVERRIDE_STATUSES.has(record.status || "")) transportOverride = "";
    return { ...record, transportOverride };
  });

  const oldStatusMap = new Map();
  for (const r of cache.getAttendanceForMonth(ym)) {
    oldStatusMap.set(`${r.employeeId}|${r.date}`, r.status);
  }

  await backend.batchUpsertAttendance(merged, username);

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
  await backend.saveConfigKey(key, value);
  config[key] = value;
  cache.setConfig(config);
  await changelog.logConfigChange(username, key, oldVal, value);
}

async function setWorkingDays(month, workingDays, username) {
  const config = getConfig();
  const { year, month: mo } = require("./calendar").parseYearMonth(month);
  const autoWd = require("./calendar").countWeekdaysInMonth(year, mo);
  const old = config.workingDaysByMonth?.[month];
  config.workingDaysByMonth = config.workingDaysByMonth || {};
  config.workingDaysByMonth[month] = Number(workingDays);
  await backend.saveConfigKey("workingDaysByMonth", config.workingDaysByMonth);
  cache.setConfig(config);
  const fromLabel = old != null ? old : autoWd;
  await changelog.logChange({
    username,
    entity: "config",
    entityId: `workingDays.${month}`,
    action: "update",
    field: "workingDaysByMonth",
    oldValue: String(fromLabel),
    newValue: String(workingDays),
    summary: `${username} changed working days for ${month} from ${fromLabel} to ${workingDays}`,
  });
  return Number(workingDays);
}

async function setHideOutEmployees(hide, username) {
  return saveConfigKey("hideOutEmployees", hide, username);
}

async function upsertBonus(record, username) {
  await backend.upsertBonusEvent(record, username);
  cache.upsertBonus(record);
  await changelog.logBonusChange(username, "upsert", record);
}

async function deleteBonus(employeeId, date, type, username) {
  await backend.deleteBonusEvent(employeeId, date, type);
  cache.deleteBonus(employeeId, date, type);
  await changelog.logBonusChange(username, "delete", {
    employeeId,
    date,
    type,
    amount: 0,
  });
}

async function upsertDeduction(record, username) {
  await backend.upsertDeductionEvent(record, username);
  cache.upsertDeduction(record);
  await changelog.logDeductionChange(username, "upsert", record);
}

async function deleteDeduction(employeeId, date, type, username) {
  await backend.deleteDeductionEvent(employeeId, date, type);
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
  const saved = await backend.upsertPayrollAdjustment(merged, username);
  cache.upsertPayrollAdjustment(saved);
  await changelog.logMonthProfileChange(username, "upsert", saved);

  if (record.payrollStatus === "closed" || record.payrollStatus === "received") {
    await recordLoanPaymentsForEmployee(record.yearMonth, record.employeeId, username);
  }
  return saved;
}

async function createPayrollSplit(split, username) {
  const saved = await backend.appendPayrollSplit(split, username);
  cache.upsertPayrollSplit(saved);
  await changelog.logMonthProfileChange(username, "payroll_split_create", saved);
  return saved;
}

async function updatePayrollSplitRecord(split, username) {
  const saved = await backend.updatePayrollSplit(split, username);
  cache.upsertPayrollSplit(saved);
  await changelog.logMonthProfileChange(username, "payroll_split_update", saved);
  return saved;
}

async function removePayrollSplit(id, username) {
  await backend.deletePayrollSplit(id);
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
  await backend.writeCommissionTiersForMonth(yearMonth, normalized);
  const all = await backend.readAllCommissionTiers();
  cache.setCommissionTiers(all);
  await changelog.logConfigChange(username, `commissionTiers.${yearMonth}`, null, normalized);
  return normalized;
}

async function createEmployeeLoan(loan, username) {
  const createdYearMonth = loan.createdYearMonth || new Date().toISOString().slice(0, 7);
  const amounts = normalizeLoanAmounts(loan);
  const saved = await backend.appendEmployeeLoan(
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

  const saved = await backend.updateEmployeeLoan(merged);
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
  await backend.deleteEmployeeLoan(loanId);
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

  const payment = await backend.appendLoanPayment(
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
  await backend.updateEmployeeLoan(updated);
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
  const saved = await backend.appendEmployeeWarning(warning, username);
  cache.appendEmployeeWarning(saved);
  await changelog.logWarningChange(username, "create", saved);
  return saved;
}

async function uploadEmployeeDocument(doc, username) {
  const saved = await backend.appendEmployeeDocument(doc, username);
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

function allocateNextAvailableId(unit, backendPool) {
  return idGen.allocateNextAvailableId(
    cache.getEmployees({ hideOut: false, includeDeleted: true }),
    unit,
    backendPool
  );
}

async function getEmployeesForIdAllocation() {
  const local = cache.getEmployees({ hideOut: false, includeDeleted: true });
  if (!backendMod.useSupabase()) return local;
  try {
    const remote = await backend.readEmployees();
    const byId = new Map(local.map((e) => [e.id, e]));
    for (const e of remote) {
      const prev = byId.get(e.id);
      byId.set(e.id, prev ? { ...prev, ...e } : e);
    }
    return [...byId.values()];
  } catch (err) {
    console.warn("getEmployeesForIdAllocation: Supabase read failed, using cache:", err.message);
    return local;
  }
}

async function allocateNextAvailableIdAsync(unit, backendPool, extraReservedIds = []) {
  let employees = await getEmployeesForIdAllocation();
  if (backendMod.useSupabase()) {
    employees = await augmentEmployeesWithAppUserIds(employees);
  }
  for (const id of extraReservedIds) {
    const key = String(id || "").trim();
    if (!key || employees.some((e) => String(e.id).toUpperCase() === key.toUpperCase())) continue;
    employees.push({ id: key, unit, status: "Active" });
  }
  return idGen.allocateNextAvailableId(employees, unit, backendPool);
}

async function augmentEmployeesWithAppUserIds(employees) {
  const byId = new Map(employees.map((e) => [e.id, e]));
  try {
    const { getSupabaseAdmin } = require("./supabase-client");
    const { data: users, error } = await getSupabaseAdmin()
      .from("app_users")
      .select("username, employee_id, status");
    if (error) throw error;
    for (const u of users || []) {
      if (String(u.status || "").toLowerCase() === "terminated") continue;
      for (const id of [u.username, u.employee_id]) {
        const key = String(id || "").trim();
        if (!key || byId.has(key)) continue;
        byId.set(key, { id: key, unit: "", status: "Active" });
      }
    }
  } catch (err) {
    console.warn("augmentEmployeesWithAppUserIds:", err.message);
  }
  return [...byId.values()];
}

function suggestNextLeadId(leadRole) {
  return employeeIds.suggestNextLeadId(cache.getEmployees(), leadRole);
}

function getTeams(unit) {
  return idGen.getTeamsForUnit(cache.getEmployees(), unit);
}

function getUnits() {
  return idGen.getUnits(cache.getEmployees());
}

function employeeHasLinkedData(employeeId) {
  if (cache.getAttendanceForEmployee(employeeId)?.length) return true;
  const db = cache.getDb();
  const bonus = db.prepare("SELECT 1 AS ok FROM bonuses WHERE employee_id = ? LIMIT 1").get(employeeId);
  if (bonus) return true;
  const deduction = db.prepare("SELECT 1 AS ok FROM deductions WHERE employee_id = ? LIMIT 1").get(employeeId);
  if (deduction) return true;
  const sales = cache.getBusinessCache("sales") || [];
  if (sales.some((s) => s.agentId === employeeId || s.closerId === employeeId)) return true;
  return false;
}

function findEmptyEmployeeStubs() {
  return cache.getEmployees().filter((e) => {
    if (e.american_name || e.arabic_name) return false;
    if (e.promoted_to_id || e.promoted_from_id) return false;
    if (employeeHasLinkedData(e.id)) return false;
    const status = String(e.status || "").trim();
    if (status && status !== "Active" && status !== "Out") return false;
    return true;
  });
}

async function deleteEmptyEmployeeStubs(username) {
  if (!backendMod.useSupabase()) {
    throw new Error("Empty ID cleanup requires DATA_BACKEND=supabase");
  }
  const stubs = findEmptyEmployeeStubs();
  for (const emp of stubs) {
    await backend.deleteEmployee(emp.id, username);
    cache.removeEmployee(emp.id);
  }
  return { deleted: stubs.map((e) => e.id), count: stubs.length };
}

module.exports = {
  syncFromSheet,
  ensureSynced,
  refreshCache,
  getEmployees,
  getEmployeesForMonth,
  getEmployeeById,
  getConfig,
  getPositionRates,
  getAppUserEmployeeId,
  getAttendanceEvents,
  getAttendanceForEmployee,
  getBonusEvents,
  getDeductionEvents,
  getPayrollAdjustments,
  getPayrollAdjustment,
  getCommissionTypes,
  upsertCommissionType,
  deleteCommissionType,
  updateTaxRules,
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
  recalcSalesCountForEmployee,
  bulkSetTransportEligible,
  upsertPositionRate,
  deletePositionRate,
  getWorkingDaysForMonth,
  createEmployee,
  updateEmployee,
  promoteEmployee,
  revertPromotion,
  changeEmployeeAppId,
  releaseEmployeeAppId,
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
  findEmptyEmployeeStubs,
  deleteEmptyEmployeeStubs,
  suggestNextId,
  allocateNextAvailableId,
  allocateNextAvailableIdAsync,
  getEmployeesForIdAllocation,
  suggestNextLeadId,
  getTeams,
  getUnits,
  getLastSync: cache.getLastSync,
  isCacheWarm: cache.isCacheWarm,
  readChangeLog: changelog.readChangeLog,
  SHEET_ID: backend.SHEET_ID,
  EMPLOYEE_STATUSES: backend.EMPLOYEE_STATUSES,
  BACKEND_POOLS: idGen.BACKEND_POOLS,
};

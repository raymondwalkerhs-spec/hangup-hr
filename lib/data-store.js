const backendMod = require("./backend");
const backend = backendMod.getBackend();
const cache = require("./cache");
const changelog = require("./changelog");
const { TRANSPORT_OVERRIDE_STATUSES } = require("./transport");
const idGen = require("./id-generator");
const employeeIds = require("./employee-ids");
const employeeIdentity = require("./employee-identity");
const { autoWorkingDays } = require("./calendar");
const {
  resolveTransportEligible,
  defaultTransportEligible,
  mergeProfile,
} = require("./month-profile");
const { summarizeEmployeeMonth, isPayrollEligible, isPayrollEligibleForMonth } = require("./attendance");
const {
  normalizeAttendanceRecord,
  applyManualAttendanceOverride,
  hasExplicitManualStatus,
} = require("./attendance-validation");
const {
  getEmployeeLoanDeductions,
  installmentsRemaining,
} = require("./loans");

const monthLookupStore = {
  getEmployeeById,
  getAttendanceEvents,
  readAttendanceEventsForMonth,
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
  for (const [ym, remoteRows] of groupByYearMonth(allAttendance, "date")) {
    cache.setAttendanceForMonth(ym, mergeAttendanceMonth(remoteRows, ym));
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

function parseTimestampMs(value) {
  if (value == null) return null;
  const str = String(value).trim();
  if (!str) return null;
  const ms = Date.parse(str);
  return Number.isFinite(ms) ? ms : null;
}

function hasRealAttendanceStatus(status) {
  const s = String(status || "").trim();
  return Boolean(s && s !== "(--)");
}

function isLocalAttendanceNewer(localRow, remoteRow) {
  const localStatus = String(localRow.status || "").trim();
  const remoteStatus = String(remoteRow.status || "").trim();

  // A real manual status must never lose to a blank remote row just because
  // fp_notes cleanup (or similar) bumped updated_at without setting status.
  if (hasRealAttendanceStatus(localStatus) && !hasRealAttendanceStatus(remoteStatus)) {
    return true;
  }
  if (!hasRealAttendanceStatus(localStatus) && hasRealAttendanceStatus(remoteStatus)) {
    return false;
  }

  const localUpdated = parseTimestampMs(localRow.updatedAt || localRow.updated_at);
  const remoteUpdated = parseTimestampMs(remoteRow.updatedAt || remoteRow.updated_at);
  if (localUpdated != null && remoteUpdated != null) {
    // Prefer the local row on ties. A background /sync/refresh can pull a stale
    // remote row during Supabase replication lag; if we let remote win on
    // equality it silently clobbers a just-saved local edit (the "reverts to --"
    // bug). The local optimistic write is authoritative unless the remote is
    // strictly newer.
    return localUpdated >= remoteUpdated;
  }
  if (localUpdated != null) return true;
  if (remoteUpdated != null) return false;
  // No timestamps available: prefer the local row only if it carries a real
  // status and the remote row is blank. This prevents a blank skeleton/sync
  // row from silently erasing an edit when timestamps are missing.
  return localStatus && !remoteStatus;
}

function mergeAttendanceMonth(remoteRows = [], yearMonth) {
  const localRows = cache.getAttendanceForMonth(yearMonth) || [];
  const byKey = new Map(
    (remoteRows || []).map((record) => [`${record.employeeId}|${record.date}`, { ...record }])
  );

  for (const localRow of localRows) {
    const key = `${localRow.employeeId}|${localRow.date}`;
    const remote = byKey.get(key);
    const localStatus = String(localRow.status || "").trim();
    if (!remote) {
      if (localStatus) byKey.set(key, { ...localRow });
      continue;
    }
    if (isLocalAttendanceNewer(localRow, remote)) {
      byKey.set(key, { ...remote, ...localRow });
    }
  }

  return [...byKey.values()];
}

let syncInFlight = null;
let mutationLock = Promise.resolve();

function withStoreMutationLock(task) {
  const run = mutationLock.then(() => task(), () => task());
  mutationLock = run.then(() => undefined, () => undefined);
  return run;
}

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
      const { data: appUsers } = await getSupabaseAdmin().from("app_users").select("username, employee_id, role");
      const linkMap = {};
      const roleMap = {};
      for (const u of appUsers || []) {
        const role = String(u.role || "").trim().toLowerCase();
        if (u.employee_id) {
          linkMap[String(u.username || "").toLowerCase()] = u.employee_id;
          if (role) roleMap[u.employee_id] = role;
        }
        if (u.username && role && !roleMap[u.username]) roleMap[u.username] = role;
      }
      cache.setMeta("app_user_employee_ids", JSON.stringify(linkMap));
      cache.setMeta("app_user_roles_by_employee_id", JSON.stringify(roleMap));
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
  const showLegacyEmployees =
    opts.showLegacyEmployees !== undefined
      ? opts.showLegacyEmployees
      : config.showLegacyEmployees === true;
  const attendanceRecords =
    opts.attendanceRecords || cache.getAttendanceForMonth(month) || [];
  const base = idGen.filterEmployees(cache.getEmployees(), {
    hideOut: false,
    month,
    attendanceRecords,
  });
  let merged = employeeIds.mergeEmployeesForMonth(base, monthLookupStore, month);
  merged = merged.filter((emp) =>
    require("./depart-attendance").shouldShowInMonth(emp, month, attendanceRecords, {
      hideOut,
      showLegacyEmployees,
    })
  );
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

async function promoteEmployee(
  oldId,
  { newId, leadRole, effectiveFromMonth, position, team, enforcePrefix = true },
  username
) {
  const old = getEmployeeById(oldId);
  if (!old) throw new Error("Employee not found");
  if (old.promoted_to_id) throw new Error("This agent record was already superseded by promotion");
  if (getEmployeeById(newId)) throw new Error(`Employee ID ${newId} already exists`);

  const role = String(leadRole || "TL").toUpperCase();
  const idGen = require("./id-generator");
  const allEmployees = getEmployees({ hideOut: false, includeDeleted: true });
  const prefixOpts = { enforcePrefix: enforcePrefix !== false };
  if (role === "AGENT") {
    idGen.validateAppIdForUnit(newId, old.unit, null, allEmployees, prefixOpts);
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
    backend_pool: isBackend ? role : null,
    backendPool: isBackend ? role : null,
    effective_from_month: eff,
    status: old.status === "Out" ? old.status : "Active",
  };

  await createEmployee(newEmp, username, { enforcePrefix: enforcePrefix !== false });
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
      const { normalizeRole } = require("./roles");
      const appRole =
        role === "AGENT" || role === "CL"
          ? "agent"
          : normalizeRole(role) || usersAdmin.inferRoleFromEmployeeId(newId);
      await usersAdmin.upsertEmployeeLogin({ employeeId: newId, role: appRole }, username);
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

async function changeEmployeeAppId(oldId, newId, username, { enforcePrefix = true } = {}) {
  const emp = getEmployeeById(oldId);
  if (!emp) throw new Error("Employee not found");
  if (employeeIdentity.isDeletedEmployee(emp)) throw new Error("Cannot change app ID on deleted record");

  const idGen = require("./id-generator");
  const pool = emp.unit === "HS-Back-End" ? emp.backend_pool || emp.backendPool : null;
  idGen.validateAppIdForUnit(newId, emp.unit, pool, getEmployees({ hideOut: false, includeDeleted: true }), {
    enforcePrefix: enforcePrefix !== false,
  });

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
        const keepRole = String(login.role || "").trim().toLowerCase() || usersAdmin.inferRoleFromEmployeeId(newId);
        await usersAdmin.deleteAppUser(oldId, username);
        await usersAdmin.upsertEmployeeLogin({ employeeId: newId, role: keepRole }, username);
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

function getAppUserRoleForEmployee(employeeId) {
  try {
    const map = JSON.parse(cache.getMeta("app_user_roles_by_employee_id") || "{}");
    return map[String(employeeId || "").trim()] || null;
  } catch {
    return null;
  }
}

function rememberAppUserRole({ employeeId, username, role }) {
  const nextRole = String(role || "").trim().toLowerCase();
  if (!nextRole) return;
  try {
    const map = JSON.parse(cache.getMeta("app_user_roles_by_employee_id") || "{}");
    if (employeeId) map[String(employeeId).trim()] = nextRole;
    if (username) map[String(username).trim()] = nextRole;
    cache.setMeta("app_user_roles_by_employee_id", JSON.stringify(map));
  } catch {
    /* optional */
  }
}

async function readAttendanceEventsForMonth(yearMonth) {
  const ym = String(yearMonth || "").slice(0, 7);
  const local = cache.getAttendanceForMonth(ym) || [];

  if (!backendMod.useSupabase()) return local;

  try {
    const remote = (await backend.readAttendanceEvents?.(ym)) || [];
    if (!Array.isArray(remote) || !remote.length) return local;
    const merged = mergeAttendanceMonth(remote, ym);
    cache.setAttendanceForMonth(ym, merged);
    return merged;
  } catch {
    return local;
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

// Live payroll read: refresh this month's payroll_adjustments from Supabase
// (single source of truth, pushed live via lib/live-sync) into the cache, then
// return them. Used by the /payroll handler so each load reflects current data
// without changing the many synchronous callers of getPayrollAdjustments().
async function refreshPayrollAdjustmentsFromSupabase(yearMonth) {
  if (!backendMod.useSupabase()) return getPayrollAdjustments(yearMonth);
  try {
    const monthRows = backend.readPayrollAdjustmentsForMonth
      ? await backend.readPayrollAdjustmentsForMonth(yearMonth)
      : ((await backend.readAllPayrollAdjustments?.()) || []).filter((a) => a.yearMonth === yearMonth);
    cache.setPayrollAdjustmentsForMonth(yearMonth, monthRows);
    return monthRows;
  } catch {
    return getPayrollAdjustments(yearMonth); // offline fallback
  }
}

// Live payroll read: refresh this month's attendance from Supabase
// (single source of truth, pushed live via lib/live-sync) into the cache, then
// return them. Used by buildEnrichedPayrollForMonth so each payroll load
// reflects current attendance data without changing the many synchronous
// callers of getAttendanceEvents().
async function refreshAttendanceFromSupabase(yearMonth) {
  if (!backendMod.useSupabase()) return getAttendanceEvents(yearMonth);
  try {
    const rows = await backend.readAttendanceEvents?.(yearMonth);
    if (Array.isArray(rows)) {
      const merged = mergeAttendanceMonth(rows, yearMonth);
      cache.setAttendanceForMonth(yearMonth, merged);
      return merged;
    }
  } catch {
    // fall through to offline cache on query error
  }
  return getAttendanceEvents(yearMonth);
}

/** Skip a blocking Supabase round-trip when this month is already in the local cache. */
const LIVE_MONTH_REFRESH_TTL_MS = 45_000;
const lastPayrollLiveRefresh = new Map();

function monthHasLocalPayrollCache(yearMonth) {
  const att = cache.getAttendanceForMonth(yearMonth) || [];
  const adj = cache.getPayrollAdjustmentsForMonth(yearMonth) || [];
  return att.length > 0 || adj.length > 0;
}

/**
 * Live attendance + adjustments for a payroll month.
 * If the SQLite cache already has that month (or a refresh ran recently), return
 * immediately and refresh in the background — same stale-while-revalidate pattern
 * as typical Supabase clients.
 */
async function refreshPayrollLiveInputs(yearMonth, { force = false } = {}) {
  if (!backendMod.useSupabase()) return;
  const key = String(yearMonth || "");
  if (!key) return;
  const last = lastPayrollLiveRefresh.get(key) || 0;
  const recentlyFresh = !force && Date.now() - last < LIVE_MONTH_REFRESH_TTL_MS;
  if (recentlyFresh) return;

  const run = Promise.all([
    refreshPayrollAdjustmentsFromSupabase(yearMonth),
    refreshAttendanceFromSupabase(yearMonth),
  ])
    .then(() => {
      lastPayrollLiveRefresh.set(key, Date.now());
    })
    .catch(() => {});

  if (force || !monthHasLocalPayrollCache(yearMonth)) {
    await run;
  }
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

async function updateTaxRules(taxRules, username, company = "hangup") {
  const scopedConfig = require("./company-scoped-config");
  const config = cache.getConfig();
  const next = scopedConfig.applyTaxRulesToConfig(config, company, taxRules);
  await backend.saveConfigKey("taxRulesByCompany", next.taxRulesByCompany);
  if (next.taxRules) await backend.saveConfigKey("taxRules", next.taxRules);
  cache.setConfig(next);
  await changelog.logConfigChange(username, `taxRules.${scopedConfig.normalizeCompany(company)}`, null, null, taxRules);
  return scopedConfig.getTaxRules(next, company);
}

async function updatePenaltyMultipliers(multipliers, username) {
  await backend.saveConfigKey("penaltyMultipliers", multipliers);
  const config = cache.getConfig();
  config.penaltyMultipliers = multipliers;
  cache.setConfig(config);
  await changelog.logConfigChange(username, "penaltyMultipliers", null, null, multipliers);
  return multipliers;
}

function getCommissionTiers(yearMonth, company = "hangup") {
  return cache.getCommissionTiersForMonth(yearMonth, company);
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

function getPayrollExtras(yearMonth, company = "hangup") {
  const companyContext = require("./company-context");
  const employees = cache.getEmployees({ hideOut: false });
  const scopedIds = new Set(
    companyContext.filterEmployeesByCompany(employees, company).map((e) => e.id)
  );
  return {
    commissionTiers: getCommissionTiers(yearMonth, company),
    loans: getEmployeeLoans().filter((l) => scopedIds.has(l.employeeId)),
    loanPayments: getLoanPayments(yearMonth),
  };
}

function getConfigForCompany(company = "hangup") {
  const scopedConfig = require("./company-scoped-config");
  return scopedConfig.configForCompany(getConfig(), company);
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

async function initMonthProfiles(yearMonth, username, { employeeIdFilter } = {}) {
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
    if (employeeIdFilter && !employeeIdFilter.has(emp.id)) continue;
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
          paymentMethod:
            require("./hr-constants").resolvePaymentMethod(emp, prev) || "",
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

async function bulkSetTransportEligible(yearMonth, eligible, username, { employeeIdFilter } = {}) {
  const count = await backend.bulkSetTransportEligibleForMonth(yearMonth, eligible, username, {
    employeeIdFilter,
  });
  await refreshCache();
  return count;
}

async function upsertPositionRateMonthlyOnly(position, monthlySalary, username, yearMonth, company) {
  const ym = String(yearMonth || "").slice(0, 7);
  const co = company || "hangup";
  const rate = backend.upsertPositionRateForMonth
    ? await backend.upsertPositionRateForMonth(ym, position, monthlySalary, co)
    : { position, monthlySalary: Number(monthlySalary) || 0, yearMonth: ym, company: co };
  cache.upsertPositionRateMonthly(ym, position, monthlySalary, co);
  const globals = cache.getPositionRates();
  if (!globals.some((r) => r.position === position)) {
    if (backend.upsertPositionRate) {
      await backend.upsertPositionRate(position, monthlySalary, co);
    }
    cache.setPositionRates(
      globals.concat([{ position, monthlySalary: Number(monthlySalary) || 0, company: co }])
    );
  }
  if (username) {
    await changelog.logConfigChange(username, `positionRate.${ym}.${position}`, null, monthlySalary);
  }
  return rate;
}

async function upsertPositionRate(position, monthlySalary, username, yearMonth, company) {
  const ym = yearMonth || new Date().toISOString().slice(0, 7);
  const co = company || "hangup";
  const rate = await upsertPositionRateMonthlyOnly(position, monthlySalary, username, ym, co);
  if (backend.upsertPositionRate) {
    await backend.upsertPositionRate(position, monthlySalary, co);
  }
  cache.setPositionRates(
    cache
      .getPositionRates()
      .filter((r) => r.position !== position)
      .concat([{ position, monthlySalary: Number(monthlySalary) || 0, company: co }])
  );
  return rate;
}

async function ensurePositionRatesForMonth(yearMonth, username) {
  const ym = String(yearMonth || "").slice(0, 7);
  if (cache.hasPositionRatesForMonth(ym)) {
    return { ok: true, initialized: false, count: cache.getPositionRatesForMonth(ym).length, source: null };
  }

  const { shiftMonth } = require("./payroll-splits");
  let source = null;
  let count = 0;

  if (backend.copyPositionRatesMonth) {
    const fromMonth = shiftMonth(ym, -1);
    count = await backend.copyPositionRatesMonth(fromMonth, ym);
    if (count > 0) {
      source = fromMonth;
      const monthly = await backend.readAllPositionRateMonthly();
      cache.setPositionRateMonthly(monthly);
    }
  }

  if (!count) {
    const globals = cache.getPositionRates();
    if (!globals.length) {
      return { ok: true, initialized: false, count: 0, source: null };
    }
    for (const r of globals) {
      await upsertPositionRateMonthlyOnly(
        r.position,
        r.monthlySalary,
        username,
        ym,
        r.company || "hangup"
      );
    }
    count = globals.length;
    source = "global";
  }

  if (username && count > 0) {
    await changelog.logConfigChange(username, `positionRates.${ym}`, null, `initialized ${count} from ${source}`);
  }
  return { ok: true, initialized: true, count, source };
}

async function copyPositionRatesFromPreviousMonth(yearMonth, username) {
  const ym = String(yearMonth || "").slice(0, 7);
  const { shiftMonth } = require("./payroll-splits");
  const fromMonth = shiftMonth(ym, -1);
  if (!backend.copyPositionRatesMonth) {
    return { ok: false, count: 0, source: fromMonth, error: "Monthly rates not available" };
  }
  const count = await backend.copyPositionRatesMonth(fromMonth, ym);
  if (count > 0) {
    const monthly = await backend.readAllPositionRateMonthly();
    cache.setPositionRateMonthly(monthly);
    if (username) {
      await changelog.logConfigChange(username, `positionRates.${ym}`, null, `copied ${count} from ${fromMonth}`);
    }
  }
  return { ok: true, count, source: fromMonth };
}

async function deletePositionRate(position, username, yearMonth, company = "hangup") {
  const ym = yearMonth || new Date().toISOString().slice(0, 7);
  const co = String(company || "hangup").toLowerCase() === "hs2" ? "hs2" : "hangup";
  const existing = cache
    .getPositionRatesForMonth(ym)
    .find((r) => r.position === position && (r.company || "hangup") === co);
  if (backend.deletePositionRateForMonth) {
    await backend.deletePositionRateForMonth(ym, position, co);
  } else if (backend.deletePositionRate) {
    await backend.deletePositionRate(position, co);
  }
  cache.deletePositionRateMonthly(ym, position, co);
  await changelog.logConfigChange(
    username,
    `positionRate.${ym}.${position}`,
    existing?.monthlySalary ?? null,
    null
  );
}

async function recalcSalesCountForEmployee(yearMonth, employeeId, username) {
  const {
    countMlaSalesForAgentMonth,
    countRpmSalesForAgentMonth,
    countCombinedSalesForAgentMonth,
  } = require("./sales-count");
  const business = require("./business-repo");
  const rpmRepo = require("./rpm-sales-repo");
  const mlaSales = await business.readSales({}, { skipCache: true });
  const rpmSales = await rpmRepo.readRpmSales({});
  const mlaCount = countMlaSalesForAgentMonth(mlaSales, employeeId, yearMonth);
  const rpmCount = countRpmSalesForAgentMonth(rpmSales, employeeId, yearMonth);
  const count = countCombinedSalesForAgentMonth(mlaSales, rpmSales, employeeId, yearMonth);
  const emp = getEmployeeById(employeeId);
  if (!emp) throw new Error("Employee not found");
  const existing = getPayrollAdjustment(yearMonth, employeeId);
  const { buildDefaultProfile } = require("./month-profile");
  const record = {
    ...(existing || buildDefaultProfile(emp, yearMonth)),
    salesCount: count,
    salesCountMla: mlaCount,
    salesCountRpm: rpmCount,
  };
  return upsertPayrollAdjustment(record, username);
}

async function refreshCache() {
  return withStoreMutationLock(() => syncFromSheet());
}

async function getWorkingDaysForMonth(yearMonth) {
  await ensureSynced();
  const config = getConfig();
  if (config.workingDaysByMonth?.[yearMonth] != null) {
    return config.workingDaysByMonth[yearMonth];
  }
  return autoWorkingDays(yearMonth);
}

async function createEmployee(emp, username, { enforcePrefix = true, skipLoginSync = false } = {}) {
  const mapped = backend.mapEmployeeRow(emp);
  const { sanitizeEmployeeComplianceFields } = require("./employee-compliance");
  const { normalizePaymentMethodValue } = require("./hr-constants");
  if (mapped.payment_method) {
    mapped.payment_method = normalizePaymentMethodValue(mapped.payment_method) || null;
  }
  if (mapped.id && mapped.unit) {
    const idGen = require("./id-generator");
    const employees = await getEmployeesForIdAllocation();
    const leadRole = String(mapped.lead_role || mapped.leadRole || "").toUpperCase();
    const prefixOpts = { enforcePrefix: enforcePrefix !== false };
    if (prefixOpts.enforcePrefix && leadRole && employeeIds.LEAD_ID_PREFIXES.includes(leadRole)) {
      if (!new RegExp(`^${leadRole}-?\\d`, "i").test(String(mapped.id).trim())) {
        throw new Error(`ID must match ${leadRole} prefix (e.g. ${leadRole}01)`);
      }
      idGen.validateAppIdForUnit(
        mapped.id,
        mapped.unit,
        mapped.backend_pool || mapped.backendPool,
        employees,
        { enforcePrefix: false }
      );
    } else {
      idGen.validateAppIdForUnit(
        mapped.id,
        mapped.unit,
        mapped.backend_pool || mapped.backendPool,
        employees,
        prefixOpts
      );
    }
  }
  if (!mapped.employment_date) {
    mapped.employment_date = new Date().toISOString().slice(0, 10);
  }
  if (!mapped.probation_end_date && mapped.employment_date) {
    const d = new Date(mapped.employment_date);
    d.setDate(d.getDate() + 90);
    mapped.probation_end_date = d.toISOString().slice(0, 10);
  }
  if (mapped.position) {
    const { resolveCanonicalPosition } = require("./position-canonical");
    mapped.position = resolveCanonicalPosition(mapped.position, getPositionRates());
  }
  const created = await backend.createEmployee(sanitizeEmployeeComplianceFields(mapped), username);
  cache.upsertEmployee(created);
  await changelog.logEmployeeChange(username, "create", created, null, "id");
  if (backendMod.useSupabase()) {
    if (!skipLoginSync) {
      try {
        await require("./users-admin").upsertEmployeeLogin({ employeeId: created.id }, username);
      } catch (err) {
        console.warn(`upsertEmployeeLogin failed for ${created.id}:`, err.message);
      }
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
  const patch = { ...updates };
  const { normalizePaymentMethodValue } = require("./hr-constants");
  if (patch.payment_method !== undefined) {
    patch.payment_method = normalizePaymentMethodValue(patch.payment_method) || null;
  }
  if (patch.paymentMethod !== undefined) {
    patch.payment_method = normalizePaymentMethodValue(patch.paymentMethod) || null;
    delete patch.paymentMethod;
  }
  if (patch.position != null && patch.position !== "") {
    const { resolveCanonicalPosition } = require("./position-canonical");
    patch.position = resolveCanonicalPosition(patch.position, getPositionRates());
  }
  const { sanitizeEmployeeComplianceFields } = require("./employee-compliance");
  const updated = await backend.updateEmployee(id, sanitizeEmployeeComplianceFields({ ...old, ...patch }), username);
  cache.upsertEmployee(updated);
  if (patch.payment_method !== undefined || patch.paymentMethod !== undefined) {
    const { applyUnifiedPaymentMethod } = require("./payment-method-sync");
    await applyUnifiedPaymentMethod({
      employeeId: id,
      method: updated.payment_method,
      backend,
      cache,
      username,
      getEmployeeById,
    });
  }
  for (const key of Object.keys(updates)) {
    if (old?.[key] !== updated[key]) {
      await changelog.logEmployeeChange(username, "update", updated, old, key);
    }
  }
  return updated;
}

async function saveAttendanceBatch(records, username) {
  return withStoreMutationLock(async () => {
    if (!records.length) return 0;
    const ym = records[0].date.slice(0, 7);
    let remoteRows = [];
    if (backendMod.useSupabase()) {
      remoteRows = (await backend.readAttendanceEvents?.(ym)) || [];
    }
    // Merge remote with local cache so manual edits win over stale Supabase rows
    // (e.g. blank status + fp_notes) and new local-only rows are not dropped.
    const existingRows = backendMod.useSupabase()
      ? mergeAttendanceMonth(remoteRows, ym)
      : cache.getAttendanceForMonth(ym) || [];

    const oldMap = new Map();
    for (const r of existingRows) {
      oldMap.set(`${r.employeeId}|${r.date}`, r);
    }

    const merged = records.map((record) => {
      const key = `${record.employeeId}|${record.date}`;
      const prior = oldMap.get(key);
      let normalized = normalizeAttendanceRecord(record);
      if (hasExplicitManualStatus(record.status)) {
        normalized = applyManualAttendanceOverride(normalized, prior);
      }
      let transportOverride =
        normalized.transportOverride !== undefined
          ? normalized.transportOverride
          : prior?.transportOverride || "";
      if (!TRANSPORT_OVERRIDE_STATUSES.has(normalized.status || "")) transportOverride = "";
      return { ...normalized, transportOverride };
    });

    const oldStatusMap = new Map();
    for (const r of existingRows) {
      oldStatusMap.set(`${r.employeeId}|${r.date}`, r.status);
    }

    const savedAt = new Date().toISOString();
    const stamped = merged.map((record) => ({ ...record, updatedAt: savedAt }));
    // Local cache first so GET /attendance cannot merge in a stale blank Supabase row
    // before the upsert completes.
    for (const record of stamped) {
      cache.upsertAttendanceRecord(record);
    }

    await backend.batchUpsertAttendance(merged, username);

    for (const record of merged) {
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
  });
}

async function saveAttendanceRow(record, username) {
  await saveAttendanceBatch([record], username);
  const ym = String(record.date || "").slice(0, 7);
  const saved =
    cache.getAttendanceForMonth(ym)?.find(
      (r) => r.employeeId === record.employeeId && r.date === record.date
    ) || null;
  return saved || record;
}

async function deleteAttendanceBatch(records, username) {
  return withStoreMutationLock(async () => {
    if (!records.length) return 0;
    const ym = records[0].date.slice(0, 7);

    const byEmployee = new Map();
    for (const r of records) {
      const key = r.employeeId;
      if (!byEmployee.has(key)) byEmployee.set(key, []);
      byEmployee.get(key).push(r);
    }

    let count = 0;
    for (const [employeeId, empRecords] of byEmployee) {
      if (backendMod.useSupabase() && backend.deleteAttendanceEventsForEmployeeMonth) {
        await backend.deleteAttendanceEventsForEmployeeMonth(employeeId, ym);
      }
      for (const record of empRecords) {
        cache.deleteAttendanceRecord(record.employeeId, record.date);
        await changelog.logAttendanceChange(username, "delete", record, record.status);
        count++;
      }
    }
    return count;
  });
}

async function initMonthWeekends(records, username) {
  return saveAttendanceBatch(records, username);
}

async function saveFpRulesForCompanyMonth(company, month, rules, username) {
  const scopedConfig = require("./company-scoped-config");
  const config = getConfig();
  const next = scopedConfig.setFpRulesForMonthInConfig(config, company, month, rules);
  await backend.saveConfigKey("attendanceFpRulesByCompany", next.attendanceFpRulesByCompany);
  if (scopedConfig.normalizeCompany(company) === "hangup") {
    await backend.saveConfigKey("attendanceFpRulesByMonth", next.attendanceFpRulesByMonth);
  }
  cache.setConfig(next);
  await changelog.logConfigChange(username, `fpRules.${scopedConfig.normalizeCompany(company)}.${month}`, null, rules);
  const byMonth = scopedConfig.getFpRulesByMonthForCompany(next, company);
  return byMonth[month] || rules;
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

async function setShowLegacyEmployees(show, username) {
  return saveConfigKey("showLegacyEmployees", show === true, username);
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
  const startTime = Date.now();
  const logPrefix = `[UPSERT ${record.employeeId} ${record.yearMonth}]`;
  console.log(`${logPrefix} START`);
  
  const emp = getEmployeeById(record.employeeId);
  console.log(`${logPrefix} [${Date.now() - startTime}ms] Employee fetched`);
  
  const merged = mergeProfile(
    getPayrollAdjustment(record.yearMonth, record.employeeId),
    record,
    emp || { id: record.employeeId }
  );
  const { normalizePaymentMethodValue } = require("./hr-constants");
  if (merged.paymentMethod !== undefined) {
    merged.paymentMethod = normalizePaymentMethodValue(merged.paymentMethod) || "";
  }
  console.log(`${logPrefix} [${Date.now() - startTime}ms] Profile merged`);
  
  const saved = await backend.upsertPayrollAdjustment(merged, username);
  console.log(`${logPrefix} [${Date.now() - startTime}ms] Backend upsert complete, saved:`, {
    monthlySalaryOverride: saved.monthlySalaryOverride,
    netSalaryOverride: saved.netSalaryOverride,
  });

  if (record.paymentMethod !== undefined) {
    const { applyUnifiedPaymentMethod } = require("./payment-method-sync");
    await applyUnifiedPaymentMethod({
      employeeId: record.employeeId,
      method: saved.paymentMethod,
      backend,
      cache,
      username,
      getEmployeeById,
    });
  }
  
  cache.upsertPayrollAdjustment(saved);
  console.log(`${logPrefix} [${Date.now() - startTime}ms] Cache updated`);
  
  await changelog.logMonthProfileChange(username, "upsert", saved);
  console.log(`${logPrefix} [${Date.now() - startTime}ms] Changelog logged`);

  if (record.payrollStatus === "closed" || record.payrollStatus === "received") {
    console.log(`${logPrefix} [${Date.now() - startTime}ms] Processing loan payments (status: ${record.payrollStatus})`);
    await recordLoanPaymentsForEmployee(record.yearMonth, record.employeeId, username);
    console.log(`${logPrefix} [${Date.now() - startTime}ms] Loan payments processed`);
  }
  
  console.log(`${logPrefix} [${Date.now() - startTime}ms] END`);
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

async function setCommissionTiersForMonth(yearMonth, tiers, username, company = "hangup") {
  const normalized = (tiers || [])
    .map((t) => ({
      company: company === "hs2" ? "hs2" : "hangup",
      yearMonth,
      minSales: parseInt(t.minSales, 10) || 0,
      bonusAmount: Number(t.bonusAmount) || 0,
      label: t.label || `${t.minSales}+ sales`,
    }))
    .filter((t) => t.minSales > 0)
    .sort((a, b) => a.minSales - b.minSales);
  await backend.writeCommissionTiersForMonth(yearMonth, normalized, company);
  const all = await backend.readAllCommissionTiers();
  cache.setCommissionTiers(all);
  await changelog.logConfigChange(
    username,
    `commissionTiers.${company === "hs2" ? "hs2" : "hangup"}.${yearMonth}`,
    null,
    normalized
  );
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

async function recordLoanPaymentsForMonth(yearMonth, username, { employeeIdFilter } = {}) {
  const loans = cache.getEmployeeLoans().filter((l) => l.status === "active");
  const payments = [];
  for (const loan of loans) {
    if (employeeIdFilter && !employeeIdFilter.has(loan.employeeId)) continue;
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

async function updateEmployeeWarning(id, patch, username) {
  const saved = await backend.updateEmployeeWarning(id, patch);
  cache.updateEmployeeWarningInCache(saved);
  await changelog.logWarningChange(username, "update", saved);
  return saved;
}

async function deleteEmployeeWarning(id, username) {
  await backend.deleteEmployeeWarning(id);
  cache.deleteEmployeeWarningFromCache(id);
  return { ok: true };
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

async function deleteEmptyEmployeeStubs(username, onlyIds = null) {
  if (!backendMod.useSupabase()) {
    throw new Error("Empty ID cleanup requires DATA_BACKEND=supabase");
  }
  let stubs = findEmptyEmployeeStubs();
  if (onlyIds) {
    const allowed = onlyIds instanceof Set ? onlyIds : new Set(onlyIds);
    stubs = stubs.filter((e) => allowed.has(e.id));
  }
  for (const emp of stubs) {
    await backend.deleteEmployee(emp.id, username);
    cache.removeEmployee(emp.id);
  }
  return { deleted: stubs.map((e) => e.id), count: stubs.length };
}

// Hybrid payroll: try DB function first, fallback to app layer
async function getPayrollCoreFromDb(month, employeeId = null) {
  if (!backendMod.useSupabase()) return null;
  try {
    const workingDaysInMonth = await getWorkingDaysForMonth(month);
    const result = await backend.calculatePayrollCoreFromDb?.(month, employeeId, workingDaysInMonth);
    if (Array.isArray(result) && result.length > 0) {
      return result;
    }
  } catch (err) {
    console.warn("[payroll-hybrid] DB core calc failed, will use app fallback:", err.message);
  }
  return null;
}

async function isPayrollCacheInvalidated(employeeId, month) {
  if (!backendMod.useSupabase()) return false;
  try {
    const ts = await backend.checkPayrollCacheInvalidation?.(employeeId, month);
    return ts != null;
  } catch {
    return false;
  }
}

module.exports = {
  syncFromSheet,
  ensureSynced,
  withStoreMutationLock,
  refreshCache,
  getEmployees,
  getEmployeesForMonth,
  getEmployeeById,
  getConfig,
  getConfigForCompany,
  getPositionRates,
  getAppUserEmployeeId,
  getAppUserRoleForEmployee,
  rememberAppUserRole,
  getAttendanceEvents,
  readAttendanceEventsForMonth,
  mergeAttendanceMonth,
  getAttendanceForEmployee,
  getBonusEvents,
  getDeductionEvents,
  getPayrollAdjustments,
  getPayrollAdjustment,
  refreshPayrollAdjustmentsFromSupabase,
  refreshAttendanceFromSupabase,
  refreshPayrollLiveInputs,
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
  upsertPositionRateMonthlyOnly,
  ensurePositionRatesForMonth,
  copyPositionRatesFromPreviousMonth,
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
  deleteAttendanceBatch,
  initMonthWeekends,
  saveConfigKey,
  saveFpRulesForCompanyMonth,
  setWorkingDays,
  setHideOutEmployees,
  setShowLegacyEmployees,
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
  updateEmployeeWarning,
  deleteEmployeeWarning,
  uploadEmployeeDocument,
  uploadEmployeeProfilePhoto,
  removeEmployeeProfilePhoto,
  findEmptyEmployeeStubs,
  deleteEmptyEmployeeStubs,
  getPayrollCoreFromDb,
  isPayrollCacheInvalidated,
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

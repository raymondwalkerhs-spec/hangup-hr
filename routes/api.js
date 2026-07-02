const express = require("express");
const {
  fetchAuthUsers,
  validateLogin,
  checkSession,
} = require("../lib/auth");
const { createSession, getSession, destroySession } = require("../lib/session-store");
const { requireOnline, isOnline, verifyGoogleSheetsAccess } = require("../lib/network");
const { resolveCredentialsPath } = require("../lib/google-auth");
const { getCacheDir } = require("../lib/cache");
const store = require("../lib/data-store");
const roles = require("../lib/roles");
const { getAppVersion, evaluateVersionCompatibility } = require("../lib/app-version");
const { fetchVersionPolicy } = require("../lib/version-sheet");
const {
  buildMonthSkeleton,
  summarizeEmployeeMonth,
  employeeDisplayName,
  ATTENDANCE_STATUSES,
  isPayrollEligible,
} = require("../lib/attendance");
const { buildPayroll, calcPayrollRow, BONUS_TYPES, DEDUCTION_TYPES } = require("../lib/payroll");
const { PAYROLL_STATUSES: PROFILE_STATUSES } = require("../lib/month-profile");
const { SPLIT_KINDS, SPLIT_STATUSES, validateSplit, applyPayrollSplits, buildSplitMaps } = require("../lib/payroll-splits");
const {
  getMonthCalendar,
  parseYearMonth,
  isWeekend,
} = require("../lib/calendar");
const idGen = require("../lib/id-generator");
const hrms = require("../lib/hrms-repo");
const payrollGates = require("../lib/payroll-gates");
const { dateInActivePeriod } = require("../lib/employment-periods");
const { useSupabase } = require("../lib/backend");
const companyContext = require("../lib/company-context");

const router = express.Router();

async function loadActionPlansSafe() {
  if (!useSupabase()) return [];
  try {
    return await hrms.readAllActionPlans();
  } catch {
    return [];
  }
}

async function assertCanEditAttendanceDate(employeeId, date) {
  if (!useSupabase()) return;
  const periods = await hrms.getEmploymentPeriods(employeeId);
  if (periods.length && !dateInActivePeriod(date, periods)) {
    throw new Error("Cannot edit attendance outside active employment period (after depart or before re-hire).");
  }
}

async function assertMonthNotLocked(month) {
  if (!useSupabase()) return;
  const lock = await hrms.getPayrollMonthLock(month);
  if (lock) throw new Error(`Payroll month ${month} is locked. Unlock in Payroll settings to edit.`);
}

function sessionFromRequest(req) {
  const id = req.headers["x-session-id"] || req.session?.appSessionId;
  if (!id) return null;
  return getSession(id);
}

function requireAuth(req, res, next) {
  const session = sessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: "Not logged in" });
  }
  req.appSession = session;
  req.username = session.username;
  req.userRole = roles.enrichUserRole(
    roles.resolveUserRole(session.username, session.role),
    store.getEmployees()
  );
  req.userRole.username = session.username;
  // Safety net: if the user's role was removed/changed to something without
  // access, drop the session so the client bounces back to the login screen.
  if (!roles.hasAppAccess(req.userRole)) {
    destroySession(session.id);
    return res.status(401).json({ error: "Access revoked. Contact Admin." });
  }
  next();
}

function parseHideOut(req) {
  if (req.query.showOut === "true") return false;
  if (req.query.hideOut === "true") return true;
  if (req.query.hideOut === "false") return false;
  return store.getConfig().hideOutEmployees !== false;
}

function parseCompany(req) {
  const fromBody = req.body?.company;
  return companyContext.parseCompanyContext(req.query.company || fromBody);
}

function filterEmployeesForRequest(employees, req) {
  const scoped = companyContext.filterEmployeesByCompany(employees, parseCompany(req));
  return roles.filterEmployeesForUser(scoped, req.userRole);
}

function assertEmployeeInCompanyContext(emp, req) {
  if (!emp) return false;
  if (!companyContext.employeeInCompanyContext(emp, parseCompany(req))) return false;
  return roles.canAccessEmployee(req.userRole, emp);
}

function listRecentMonths(count = 12) {
  const now = new Date();
  const months = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

async function loadEmployeePayslipBundle(emp, month) {
  const config = store.getConfig();
  const rates = store.getPositionRates();
  const records = store.getAttendanceEvents(month).filter((r) => r.employeeId === emp.id);
  const bonusEvents = store.getBonusEvents(month, emp.id);
  const deductionEvents = store.getDeductionEvents(month, emp.id);
  const adjustment = store.getPayrollAdjustment(month, emp.id);
  const actionPlans = await loadActionPlansSafe();
  const gate = await payrollGates.getPayrollBlockers(emp.id, month, emp).catch(() => ({ payslipNotes: [] }));
  const summary = summarizeEmployeeMonth(emp, records, config, actionPlans.filter((p) => p.employeeId === emp.id && p.status === "active"));
  const { commissionTiers, loans, loanPayments } = store.getPayrollExtras(month);
  const allPayrollSplits = store.getAllPayrollSplits();
  const splitMaps = buildSplitMaps(allPayrollSplits, month);
  const payslip = applyPayrollSplits(
    calcPayrollRow(
      emp,
      summary,
      month,
      config,
      rates,
      bonusEvents,
      deductionEvents,
      adjustment,
      records,
      commissionTiers,
      loans,
      loanPayments,
      actionPlans,
      gate.payslipNotes || []
    ),
    splitMaps.byEmployeeMonth.get(emp.id) || [],
    splitMaps.deferredIn.get(emp.id) || []
  );
  return {
    payslip,
    bonusEvents,
    deductionEvents,
    attendanceRecords: records,
    config,
    employees: store.getEmployees(),
    payslipGateNotes: gate.payslipNotes || [],
  };
}

async function upsertTlBonusPair(req, { employeeId, date, amount, reason, unit, deductFromEmployeeId }) {
  const emp = store.getEmployeeById(employeeId);
  const fromEmp = store.getEmployeeById(deductFromEmployeeId);
  await store.upsertBonus(
    {
      employeeId,
      date,
      amount: Number(amount),
      reason: `${reason || "TL bonus"} (deducted from ${deductFromEmployeeId})`,
      type: "Bonus from TL / OP",
      unit: unit || emp?.unit || "",
    },
    req.username
  );
  await store.upsertDeduction(
    {
      employeeId: deductFromEmployeeId,
      date,
      amount: Number(amount),
      reason: reason || `TL bonus paid to ${employeeId}`,
      type: "Bonus from TL / OP",
      unit: fromEmp?.unit || "",
    },
    req.username
  );
}

async function deleteTlBonusPair(req, { employeeId, date, type }) {
  await store.deleteBonus(employeeId, date, type, req.username);
  if (type !== "Bonus from TL / OP") return;
  const month = String(date).slice(0, 7);
  const deductions = store.getDeductionEvents(month).filter(
    (d) =>
      d.type === "Bonus from TL / OP" &&
      d.date === date &&
      String(d.reason || "").includes(employeeId)
  );
  for (const d of deductions) {
    await store.deleteDeduction(d.employeeId, d.date, d.type, req.username);
  }
}

function parseTlBonusRecipientFromReason(reason) {
  const m = String(reason || "").match(/paid to\s+(\S+)/i);
  return m ? m[1] : "";
}

function enrichDeductionForApi(d) {
  if (d.type !== "Bonus from TL / OP") return d;
  const bonusRecipientId = parseTlBonusRecipientFromReason(d.reason);
  if (!bonusRecipientId) return { ...d, bonusRecipientId: "" };
  const recipient = store.getEmployeeById(bonusRecipientId);
  return {
    ...d,
    bonusRecipientId,
    bonusRecipientAmericanName: recipient?.american_name || "",
    bonusRecipientArabicName: recipient?.arabic_name || "",
  };
}

async function loadVersionCheck(userRole = null) {
  const policy = await fetchVersionPolicy();
  return evaluateVersionCompatibility(getAppVersion(), policy, userRole);
}

function versionPayload(check) {
  if (!check || check.status === "ok") return null;
  return {
    status: check.status,
    message: check.message,
    appVersion: check.appVersion,
    currentVersion: check.currentVersion,
    minCompatibleVersion: check.minCompatibleVersion,
    forceUpdateMinVersion: check.forceUpdateMinVersion,
    blockedForRole: check.blockedForRole,
  };
}

router.get("/version-info", async (req, res) => {
  try {
    const appVersion = getAppVersion();
    let check = { status: "ok", appVersion };
    try {
      check = await loadVersionCheck();
    } catch {
      /* sheet unavailable — report app version only */
    }
    res.json({
      appVersion,
      versionCheck: versionPayload(check),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/health", async (req, res) => {
  const health = {
    ok: true,
    online: await isOnline(),
    cacheDir: null,
    credentials: null,
    sheets: null,
    errors: [],
  };

  try {
    health.cacheDir = getCacheDir();
  } catch (err) {
    health.ok = false;
    health.errors.push(`Cache: ${err.message}`);
  }

  try {
    const credPath = resolveCredentialsPath();
    const fs = require("fs");
    health.credentials = { path: credPath, exists: fs.existsSync(credPath) };
    if (!health.credentials.exists) {
      health.ok = false;
      health.errors.push("Service account credentials file is missing.");
    }
  } catch (err) {
    health.ok = false;
    health.errors.push(`Credentials: ${err.message}`);
  }

  try {
    health.sheets = await verifyGoogleSheetsAccess();
  } catch (err) {
    health.ok = false;
    health.errors.push(err.message);
  }

  res.status(health.ok ? 200 : 503).json(health);
});

router.post("/login", async (req, res) => {
  try {
    await requireOnline();
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }
    const users = await fetchAuthUsers();
    const result = await validateLogin(username, password, users);
    if (!result.ok) {
      if (result.terminated) {
        return res.status(403).json({ error: "terminated", terminated: true });
      }
      if (result.reason === "inactive") {
        return res.status(403).json({ error: "Account inactive. Contact Admin." });
      }
      return res.status(401).json({ error: "Invalid username or password" });
    }
    if (!roles.hasAppAccess(roles.resolveUserRole(result.user, result.role))) {
      return res.status(403).json({ error: "No access assigned. Contact Admin." });
    }
    const userRole = roles.resolveUserRole(result.user, result.role).role;
    const versionCheck = await loadVersionCheck(userRole);
    if (versionCheck.status === "blocked") {
      return res.status(403).json({
        error: versionCheck.message,
        versionBlocked: true,
        versionCheck: versionPayload(versionCheck),
      });
    }
    const { useSupabase } = require("../lib/backend");
    if (useSupabase()) {
      try {
        await require("../lib/users-admin").touchLastLogin(result.user);
      } catch {
        /* non-fatal */
      }
    }
    const session = createSession(result.user, result.password, result.role, {
      deviceLabel: req.body.deviceLabel || "Desktop",
      ip: req.ip,
    });
    req.session.appSessionId = session.id;
    const payload = {
      ok: true,
      sessionId: session.id,
      username: result.user,
      appVersion: getAppVersion(),
    };
    const notice = versionPayload(versionCheck);
    if (notice?.status === "update_recommended") {
      payload.versionNotice = notice;
    }
    res.json(payload);
  } catch (err) {
    const msg = err.message || "Connection failed";
    const offline =
      !msg.toLowerCase().includes("credentials") &&
      !msg.toLowerCase().includes("service account");
    res.status(503).json({ error: msg, offline });
  }
});

router.post("/logout", (req, res) => {
  const session = sessionFromRequest(req);
  if (session) destroySession(session.id);
  req.session.destroy(() => res.json({ ok: true }));
});

router.get("/session-check", async (req, res) => {
  const session = sessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: "Not logged in" });
  }
  try {
    await requireOnline();
    const users = await fetchAuthUsers();
    const check = await checkSession(session.username, session.password, users);
    if (check.action === "uninstall") {
      destroySession(session.id);
      return res.json({ action: "uninstall" });
    }
    if (check.action === "admin") {
      destroySession(session.id);
      return res.json({ action: "admin", message: check.message });
    }
    if (check.role !== undefined) session.role = check.role;
    if (!roles.hasAppAccess(roles.resolveUserRole(session.username, session.role))) {
      destroySession(session.id);
      return res.json({ action: "admin", message: "Access removed. Contact Admin." });
    }
    const userRole = roles.resolveUserRole(session.username, session.role).role;
    const versionCheck = await loadVersionCheck(userRole);
    if (versionCheck.status === "blocked") {
      destroySession(session.id);
      return res.json({
        action: "version_blocked",
        message: versionCheck.message,
        versionCheck: versionPayload(versionCheck),
      });
    }
    const payload = { action: "ok", username: session.username, appVersion: getAppVersion() };
    const notice = versionPayload(versionCheck);
    if (notice?.status === "update_recommended") {
      payload.versionNotice = notice;
    }
    res.json(payload);
  } catch (err) {
    res.status(503).json({ error: err.message, offline: true });
  }
});

router.use(requireAuth);

// Placed before the ensureSynced middleware so the username + online/offline
// badge still render even when the Google Sheets sync is failing.
router.get("/status", async (req, res) => {
  let online = await isOnline();
  let sheetsOk = false;
  try {
    await Promise.race([
      verifyGoogleSheetsAccess(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 6000)),
    ]);
    sheetsOk = true;
    online = true;
  } catch {
    /* keep online flag from probe */
  }
  const config = store.getConfig();
  res.json({
    online,
    sheetsOk,
    live: true,
    dataBackend: require("../lib/backend").getBackendName(),
    lastSync: store.getLastSync()?.toISOString() || null,
    hideOutEmployees: config.hideOutEmployees !== false,
    taxRules: config.taxRules || { incomeTaxRate: 0, socialInsuranceRate: 0 },
    canManageSessions: roles.canManageSessions(req.username),
    canApproveLeave: roles.canApproveLeave(req.username),
    user: {
      username: req.username,
      role: req.userRole.role,
      unit: req.userRole.unit,
      team: req.userRole.team,
      employeeId: req.userRole.employeeId,
      canManageUsers: roles.canManageAppUsers(req.username),
      canApproveLeave: roles.canApproveLeave(req.username),
      canManageSessions: roles.canManageSessions(req.username),
      canViewPayroll: roles.canViewPayroll(req.userRole),
      canViewBonuses: roles.canViewBonusesDeductions(req.userRole),
      canEditAttendance: roles.canEditAttendance(req.userRole),
      canTransferBonus: roles.canTransferBonus(req.userRole),
      canSubmitBonusRequest: roles.canSubmitBonusRequest(req.userRole),
      canApproveBonusRequest: roles.canApproveBonusRequest(req.userRole),
      canViewSales: roles.canViewSales(req.userRole),
      canEditSales: roles.canEditSale(req.userRole),
      canAccessCosts: roles.canAccessCostsFull(req.userRole, req.username),
      canSubmitExpense: roles.canSubmitExpense(req.userRole, req.username),
    },
    appVersion: getAppVersion(),
    sheetId: store.SHEET_ID,
    authSheetId: require("../lib/auth").AUTH_SHEET_ID,
    credentialsPath: resolveCredentialsPath(),
    cacheDir: getCacheDir(),
  });
});

router.use("/admin/users", require("./admin-users"));
router.use("/bonus-requests", (req, res, next) => {
  req.userRole = roles.enrichUserRole(
    roles.resolveUserRole(req.username, req.appSession?.role),
    store.getEmployees()
  );
  req.userRole.username = req.username;
  next();
}, require("./bonus-requests"));
router.use("/sales", (req, res, next) => {
  req.userRole = req.userRole || roles.enrichUserRole(
    roles.resolveUserRole(req.username, req.appSession?.role),
    store.getEmployees()
  );
  req.userRole.username = req.username;
  next();
}, require("./sales"));
router.use("/expenses", (req, res, next) => {
  req.userRole = req.userRole || roles.resolveUserRole(req.username, req.appSession?.role);
  next();
}, require("./expenses"));
router.use("/hrms", (req, res, next) => {
  req.userRole = req.userRole || roles.resolveUserRole(req.username, req.appSession?.role);
  next();
}, require("./hrms"));
router.use("/auth", require("./auth-routes"));

router.post("/sync/refresh", async (req, res) => {
  try {
    await requireOnline();
    const result = await store.refreshCache();
    res.json({ ok: true, ...result, lastSync: store.getLastSync()?.toISOString() });
  } catch (err) {
    res.status(503).json({
      error: err.message,
      offline: !String(err.message).toLowerCase().includes("credentials"),
    });
  }
});

router.get("/sync/status", async (req, res) => {
  res.json({
    warm: store.isCacheWarm(),
    lastSync: store.getLastSync()?.toISOString() || null,
  });
});

// Reads are served from the local SQLite cache for speed and stability.
// We only reach out to Google Sheets when the cache is still cold (first run),
// so there is no per-request online probe slowing things down.
router.use(async (req, res, next) => {
  if (/\/employees\/[^/]+\/avatar$/.test(req.path)) {
    return next();
  }
  try {
    await store.ensureSynced();
    next();
  } catch (err) {
    const msg = err.message || "Sync failed";
    res.status(503).json({
      error: msg,
      offline: !msg.toLowerCase().includes("credentials") && !msg.toLowerCase().includes("database"),
    });
  }
});

const { TEAM_OPTIONS, CASH_BRANCHES, PAYMENT_METHOD_OPTIONS, TL_BONUS_TYPE, normalizePaymentMethodValue } = require("../lib/hr-constants");

router.get("/meta/teams", (req, res) => {
  const unit = req.query.unit || "";
  const fromSheet = unit ? store.getTeams(unit) : [];
  const teams = [...new Set([...TEAM_OPTIONS, ...fromSheet])].sort();
  res.json({
    teams,
    units: store.getUnits(),
    cashBranches: CASH_BRANCHES,
    paymentMethods: PAYMENT_METHOD_OPTIONS,
  });
});

router.get("/employees/next-id", (req, res) => {
  const { unit, backendPool, leadRole } = req.query;
  if (leadRole) {
    const role = String(leadRole).toUpperCase();
    const backendRoles = require("../lib/employee-ids").BACKEND_TRANSFER_ROLES;
    if (backendRoles.includes(role)) {
      return res.json({ suggestedId: store.suggestNextId("HS-Back-End", role) });
    }
    try {
      return res.json({ suggestedId: store.suggestNextLeadId(leadRole) });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
  if (!unit) return res.status(400).json({ error: "unit required" });
  res.json({ suggestedId: store.suggestNextId(unit, backendPool) });
});

const {
  NATIONALITY_SUGGESTIONS,
  WORK_PERMIT_OPTIONS,
  INSURANCE_STATUS_OPTIONS,
  isEgyptianNationality,
  workPermitLabel,
  insuranceStatusLabel,
} = require("../lib/employee-compliance");

function nationalityOptionsFromEmployees(employees) {
  const set = new Set(NATIONALITY_SUGGESTIONS);
  const { normalizeNationality } = require("../lib/employee-compliance");
  for (const e of employees) {
    if (e.nationality) set.add(normalizeNationality(e.nationality));
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

router.get("/employees", (req, res) => {
  const hideOut = parseHideOut(req);
  const companyContext = require("../lib/company-context");
  const company = companyContext.parseCompanyContext(req.query.company);
  const scopedAll = roles.filterEmployeesForUser(
    companyContext.filterEmployeesByCompany(store.getEmployees({ hideOut: false }), company),
    req.userRole
  );
  let employees = store.getEmployees({ hideOut });
  employees = companyContext.filterEmployeesByCompany(employees, company);
  employees = roles.filterEmployeesForUser(employees, req.userRole);
  const units = store.getUnits();
  const positions = [
    ...new Set(employees.map((e) => e.position).filter(Boolean)),
  ].sort();
  res.json({
    employees,
    units,
    positions,
    positionRates: store.getPositionRates().map((r) => r.position).filter(Boolean),
    statuses: store.EMPLOYEE_STATUSES.filter(Boolean),
    nationalities: nationalityOptionsFromEmployees(scopedAll),
    workPermitOptions: WORK_PERMIT_OPTIONS,
    insuranceStatusOptions: INSURANCE_STATUS_OPTIONS,
    hideOutEmployees: hideOut,
    backendPools: Object.keys(store.BACKEND_POOLS),
  });
});

router.get("/employees/:employeeId/avatar", async (req, res) => {
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).end();
  if (!roles.canAccessEmployee(req.userRole, emp)) {
    return res.status(403).end();
  }
  if (!emp.profile_photo_file_id) return res.status(404).end();

  try {
    const documents = require("../lib/documents");
    const { stream, mimeType } = await documents.getDriveFileStream(emp.profile_photo_file_id);
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    stream.on("error", () => {
      if (!res.headersSent) res.status(404).end();
    });
    stream.pipe(res);
  } catch {
    res.status(404).end();
  }
});

router.post("/employees/:employeeId/profile-photo", async (req, res) => {
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!roles.canUploadProfilePhoto(req.userRole, emp, req.username)) {
    return res.status(403).json({ error: "No permission to upload profile photo" });
  }

  const { fileName, contentBase64 } = req.body;
  if (!contentBase64 || !fileName) {
    return res.status(400).json({ error: "fileName and contentBase64 required" });
  }

  const documents = require("../lib/documents");
  const mimeType = documents.guessImageMime(fileName);
  if (!mimeType.startsWith("image/")) {
    return res.status(400).json({ error: "Only image files are allowed (JPG, PNG, WebP, GIF)" });
  }

  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const tmpPath = path.join(os.tmpdir(), `hr-photo-${Date.now()}-${fileName}`);
  fs.writeFileSync(tmpPath, Buffer.from(contentBase64, "base64"));

  try {
    const uploaded = await documents.uploadProfilePhoto({
      employeeId: emp.id,
      filePath: tmpPath,
      fileName,
      oldFileId: emp.profile_photo_file_id,
    });
    const updated = await store.uploadEmployeeProfilePhoto(emp.id, uploaded, req.username);
    res.json({ ok: true, employee: updated });
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  }
});

router.delete("/employees/:employeeId/profile-photo", async (req, res) => {
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!roles.canUploadProfilePhoto(req.userRole, emp, req.username)) {
    return res.status(403).json({ error: "No permission" });
  }
  const updated = await store.removeEmployeeProfilePhoto(emp.id, req.username);
  res.json({ ok: true, employee: updated });
});

router.get("/employees/empty-stubs", (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const stubs = store.findEmptyEmployeeStubs();
  res.json({ stubs: stubs.map((e) => ({ id: e.id, unit: e.unit, team: e.team, status: e.status })) });
});

router.delete("/employees/empty-stubs", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  try {
    const result = await store.deleteEmptyEmployeeStubs(req.username);
    const auditNotify = require("../lib/notify-routing");
    await auditNotify.auditNotify({
      actor: req.username,
      action: "employee_stub_delete",
      title: "Empty employee stubs deleted",
      body: `${result.deleted || 0} removed`,
      entityType: "employee",
      entityId: "empty-stubs",
      includeHr: true,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/employees/:id", (req, res) => {
  if (req.params.id === "next-id") return res.status(404).json({ error: "Not found" });
  const emp = store.getEmployeeById(req.params.id);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!assertEmployeeInCompanyContext(emp, req)) {
    return res.status(404).json({ error: "Employee not found" });
  }
  res.json({ employee: emp });
});

router.post("/employees", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  try {
    const emp = await store.createEmployee(req.body, req.username);
    res.json({ ok: true, employee: emp });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/employees/:id", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  try {
    const emp = await store.updateEmployee(req.params.id, req.body, req.username);
    res.json({ ok: true, employee: emp });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch("/employees/:id/status", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: "Status required" });
  try {
    if (String(status).trim() === "Deleted") {
      const result = await store.releaseEmployeeAppId(req.params.id, req.username);
      await store.refreshCache();
      return res.json({ ok: true, ...result });
    }
    const emp = await store.updateEmployee(req.params.id, { status }, req.username);
    res.json({ ok: true, employee: emp });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/employees/:id/promote", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const { newId, leadRole, effectiveFromMonth, position, team } = req.body;
  if (!newId) return res.status(400).json({ error: "newId required (e.g. TL04, CL02, OP01)" });
  try {
    const result = await store.promoteEmployee(
      req.params.id,
      { newId, leadRole, effectiveFromMonth, position, team },
      req.username
    );
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/employees/:id/revert-promotion", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  try {
    const result = await store.revertPromotion(req.params.id, req.username);
    await store.refreshCache();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/employees/:id/change-app-id", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const newId = String(req.body?.newId || "").trim();
  if (!newId) return res.status(400).json({ error: "newId required" });
  try {
    const result = await store.changeEmployeeAppId(req.params.id, newId, req.username);
    await store.refreshCache();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/employees/:id/release-app-id", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  try {
    const result = await store.releaseEmployeeAppId(req.params.id, req.username);
    await store.refreshCache();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/employees/:id/payroll-months", (req, res) => {
  if (!roles.canViewBonusesDeductions(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  const emp = store.getEmployeeById(req.params.id);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!roles.canAccessEmployee(req.userRole, emp)) {
    return res.status(403).json({ error: "No access" });
  }
  const { listEmployeePayrollMonths } = require("../lib/employee-export");
  const months = listEmployeePayrollMonths(store, emp, Number(req.query.months) || 36);
  res.json({ employeeId: emp.id, name: employeeDisplayName(emp), months });
});

router.get("/employees/:id/attendance-summary", async (req, res) => {
  if (!roles.canViewBonusesDeductions(req.userRole) && !roles.canEditAttendance(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  const emp = store.getEmployeeById(req.params.id);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!roles.canAccessEmployee(req.userRole, emp)) {
    return res.status(403).json({ error: "No access" });
  }
  const {
    buildEmployeeAttendanceSummary,
    attendanceSummaryToCsv,
    buildAttendanceSummaryPdf,
  } = require("../lib/employee-export");
  const report = buildEmployeeAttendanceSummary(store, emp);
  const format = (req.query.format || "json").toLowerCase();
  if (format === "csv") {
    res
      .type("text/csv")
      .attachment(`attendance-summary-${emp.id}.csv`)
      .send(attendanceSummaryToCsv(report));
    return;
  }
  if (format === "pdf") {
    const pdf = await buildAttendanceSummaryPdf(report);
    res.type("application/pdf").attachment(`attendance-summary-${emp.id}.pdf`).send(pdf);
    return;
  }
  res.json({ report });
});

router.get("/attendance", async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const unit = req.query.unit || "";
  const team = req.query.team || "";
  const hideOut = parseHideOut(req);

  let employees = store.getEmployeesForMonth(month, { hideOut });
  employees = filterEmployeesForRequest(employees, req);
  if (unit) employees = employees.filter((e) => e.unit === unit);
  if (team) employees = employees.filter((e) => e.team === team);
  employees = employees.filter(
    (e) =>
      e.american_name ||
      e.arabic_name ||
      isPayrollEligible(e) ||
      !idGen.isOutEmployee(e)
  );

  const config = store.getConfig();
  let records = store.getAttendanceEvents(month);
  records = buildMonthSkeleton(employees, month, records);

  const empIds = new Set(employees.map((e) => e.id));
  const monthRecords = records.filter((r) => empIds.has(r.employeeId));
  const calendar = getMonthCalendar(month);
  const workingDays =
    config.workingDaysByMonth?.[month] ?? (await store.getWorkingDaysForMonth(month));
  const { year: calY, month: calM } = require("../lib/calendar").parseYearMonth(month);
  const autoWd = require("../lib/calendar").countWeekdaysInMonth(calY, calM);
  const workingDaysNote =
    config.workingDaysByMonth?.[month] != null
      ? `Working days for ${month} manually set to ${workingDays} (calendar default: ${autoWd}).`
      : null;

  let holidays = [];
  try {
    holidays = useSupabase() ? await hrms.readPublicHolidays() : [];
  } catch {
    holidays = [];
  }
  const monthHolidays = holidays.filter((h) => {
    const d = String(h.date || h.holidayDate || "").slice(0, 10);
    return h.active !== false && d.startsWith(month);
  });

  const actionPlans = await loadActionPlansSafe();

  const summaries = employees.map((emp) =>
    summarizeEmployeeMonth(
      emp,
      monthRecords.filter((r) => r.employeeId === emp.id),
      config,
      actionPlans.filter((p) => p.employeeId === emp.id && p.status === "active")
    )
  );

  const teams = [
    ...new Set(employees.map((e) => e.team).filter(Boolean)),
  ].sort();

  res.json({
    month,
    days: calendar.map((c) => c.date),
    calendar,
    records: monthRecords,
    summaries,
    employees: employees.map((e) => ({
      id: e.id,
      name: employeeDisplayName(e),
      american_name: e.american_name,
      unit: e.unit,
      team: e.team,
      position: e.position,
      email: e.email,
      status: e.status,
      profile_photo_file_id: e.profile_photo_file_id || "",
      profile_photo_updated: e.profile_photo_updated || "",
    })),
    workingDays,
    teams,
    units: store.getUnits(),
    statuses: ATTENDANCE_STATUSES,
    canEdit: roles.canEditAttendance(req.userRole),
    hideOutEmployees: hideOut,
    holidays: monthHolidays,
    workingDaysNote,
    payrollMonthLocked: useSupabase() ? Boolean(await hrms.getPayrollMonthLock(month)) : false,
  });
});

router.post("/attendance", async (req, res) => {
  if (!roles.canEditAttendance(req.userRole)) {
    return res.status(403).json({ error: "No permission to edit attendance" });
  }
  const { employeeId, date, status, fpLateness } = req.body;
  if (!employeeId || !date) {
    return res.status(400).json({ error: "Missing employeeId or date" });
  }

  const emp = store.getEmployeeById(employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!roles.canAccessEmployee(req.userRole, emp)) {
    return res.status(403).json({ error: "No access to this unit" });
  }

  try {
    await assertMonthNotLocked(String(date).slice(0, 7));
    await assertCanEditAttendanceDate(employeeId, date);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const record = {
    employeeId,
    date,
    status: status || "Attended",
    fpLateness: fpLateness || null,
    isWeekendDefault: isWeekend(date) && status === "Day-OFF",
    transportOverride: req.body.transportOverride || "",
  };

  await store.saveAttendanceRow(record, req.username);

  const config = store.getConfig();
  const monthRecords = store
    .getAttendanceEvents(date.slice(0, 7))
    .filter((r) => r.employeeId === employeeId);
  const summary = summarizeEmployeeMonth(emp, monthRecords, config);

  res.json({ ok: true, summary });
});

router.post("/attendance/batch", async (req, res) => {
  if (!roles.canEditAttendance(req.userRole)) {
    return res.status(403).json({ error: "No permission to edit attendance" });
  }
  const { records } = req.body;
  if (!Array.isArray(records) || !records.length) {
    return res.status(400).json({ error: "records array required" });
  }

  const normalized = [];
  for (const r of records) {
    const emp = store.getEmployeeById(r.employeeId);
    if (!emp) continue;
    if (!roles.canAccessEmployee(req.userRole, emp)) continue;
    try {
      await assertMonthNotLocked(String(r.date).slice(0, 7));
      await assertCanEditAttendanceDate(r.employeeId, r.date);
    } catch {
      continue;
    }
    normalized.push({
      employeeId: r.employeeId,
      date: r.date,
      status: r.status || "",
      fpLateness: r.fpLateness || null,
      isWeekendDefault: isWeekend(r.date) && r.status === "Day-OFF",
      transportOverride: r.transportOverride || "",
    });
  }

  const count = await store.saveAttendanceBatch(normalized, req.username);
  res.json({ ok: true, count });
});

router.put("/attendance/working-days", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const { month, workingDays } = req.body;
  const wd = await store.setWorkingDays(month, workingDays, req.username);
  res.json({ ok: true, workingDays: wd });
});

router.patch("/attendance/init-month", async (req, res) => {
  if (!roles.canEditAttendance(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  const { month, employeeId } = req.body;
  try {
    await assertMonthNotLocked(month);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const hideOut = store.getConfig().hideOutEmployees !== false;
  let employees = store.getEmployeesForMonth(month, { hideOut });
  employees = filterEmployeesForRequest(employees, req);
  if (employeeId) {
    const one = employees.find((e) => e.id === employeeId);
    employees = one ? [one] : [];
    if (!employees.length) {
      const emp = store.getEmployeeById(employeeId);
      if (emp && roles.canAccessEmployee(req.userRole, emp)) employees = [emp];
    }
  }
  const existing = store.getAttendanceEvents(month);
  const skeleton = buildMonthSkeleton(employees, month, existing);
  const weekendOnly = skeleton.filter((r) => r.isWeekendDefault);
  let count = await store.initMonthWeekends(weekendOnly, req.username);

  let holidays = [];
  try {
    holidays = useSupabase() ? await hrms.readPublicHolidays({ activeOnly: true }) : [];
  } catch {
    holidays = [];
  }
  const monthHolidays = holidays.filter((h) => String(h.date || "").startsWith(month));
  const existingMap = new Map();
  for (const r of store.getAttendanceEvents(month)) {
    existingMap.set(`${r.employeeId}|${r.date}`, r.status || "");
  }
  const holidayRecords = [];
  for (const emp of employees) {
    for (const h of monthHolidays) {
      const date = h.date;
      if (!date) continue;
      const key = `${emp.id}|${date}`;
      if (existingMap.get(key)) continue;
      holidayRecords.push({
        employeeId: emp.id,
        date,
        status: "Day-OFF",
        isWeekendDefault: false,
      });
    }
  }
  if (holidayRecords.length) {
    count += await store.saveAttendanceBatch(holidayRecords, req.username);
  }
  res.json({ ok: true, count });
});

router.patch("/attendance/bulk-agent-month", async (req, res) => {
  if (!roles.canEditAttendance(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  const { month, employeeId, status } = req.body;
  if (!month || !employeeId) {
    return res.status(400).json({ error: "month and employeeId required" });
  }
  try {
    await assertMonthNotLocked(month);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const emp = store.getEmployeeById(employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!roles.canAccessEmployee(req.userRole, emp)) {
    return res.status(403).json({ error: "No access to this employee" });
  }

  let holidays = [];
  try {
    holidays = useSupabase() ? await hrms.readPublicHolidays({ activeOnly: true }) : [];
  } catch {
    holidays = [];
  }
  const holidayDates = new Set(
    holidays.filter((h) => String(h.date || "").startsWith(month)).map((h) => h.date)
  );
  const calendar = getMonthCalendar(month);
  const existing = store.getAttendanceEvents(month).filter((r) => r.employeeId === employeeId);
  const existingMap = new Map(existing.map((r) => [r.date, r.status || ""]));
  const records = [];
  for (const day of calendar) {
    if (day.isWeekend) continue;
    if (holidayDates.has(day.date)) continue;
    records.push({
      employeeId,
      date: day.date,
      status: status || "Attended",
      isWeekendDefault: false,
    });
  }
  const count = await store.saveAttendanceBatch(records, req.username);
  res.json({ ok: true, count });
});

router.patch("/attendance/bulk-weekdays", async (req, res) => {
  if (!roles.canEditAttendance(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  const { month, status, unit, team } = req.body;
  const hideOut = store.getConfig().hideOutEmployees !== false;
  let employees = store.getEmployees({ hideOut, unit, team });
  employees = filterEmployeesForRequest(employees, req);
  const calendar = getMonthCalendar(month);
  const records = [];
  for (const emp of employees) {
    for (const day of calendar) {
      if (day.isWeekend) continue;
      records.push({
        employeeId: emp.id,
        date: day.date,
        status: status || "Attended",
        isWeekendDefault: false,
      });
    }
  }
  const count = await store.saveAttendanceBatch(records, req.username);
  res.json({ ok: true, count });
});

router.get("/payroll", async (req, res) => {
  if (!roles.canViewPayroll(req.userRole)) {
    return res.status(403).json({ error: "No permission to view payroll" });
  }
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const unit = req.query.unit || "";
  const hideOut = parseHideOut(req);

  let employees = store.getEmployeesForMonth(month, { hideOut });
  employees = filterEmployeesForRequest(employees, req);
  if (unit) employees = employees.filter((e) => e.unit === unit);

  const config = store.getConfig();
  const rates = store.getPositionRates();
  const records = store.getAttendanceEvents(month);
  const bonusEvents = store.getBonusEvents(month);
  const deductionEvents = store.getDeductionEvents(month);
  const adjustments = store.getPayrollAdjustments(month);
  const attendanceMap = store.buildAttendanceMap(month);
  const { commissionTiers, loans, loanPayments } = store.getPayrollExtras(month);
  const allPayrollSplits = store.getAllPayrollSplits();
  const workingDays =
    config.workingDaysByMonth?.[month] ?? (await store.getWorkingDaysForMonth(month));
  const actionPlans = await loadActionPlansSafe();

  const summaries = employees.map((emp) =>
    summarizeEmployeeMonth(
      emp,
      records.filter((r) => r.employeeId === emp.id),
      config,
      actionPlans.filter((p) => p.employeeId === emp.id && p.status === "active")
    )
  );

  const payroll = buildPayroll(
    employees,
    summaries,
    month,
    config,
    rates,
    bonusEvents,
    deductionEvents,
    adjustments,
    attendanceMap,
    commissionTiers,
    loans,
    loanPayments,
    allPayrollSplits,
    actionPlans
  );
  const monthLock = useSupabase() ? await hrms.getPayrollMonthLock(month) : null;
  res.json({
    month,
    payroll,
    workingDays,
    monthLock,
    bonusTypes: BONUS_TYPES,
    deductionTypes: DEDUCTION_TYPES,
    commissionTypes: store.getCommissionTypes(),
    commissionTiers,
    payrollStatuses: PROFILE_STATUSES,
    totals: {
      employees: payroll.length,
      totalBasic: payroll.reduce((s, p) => s + p.basicSalary, 0),
      totalBonuses: payroll.reduce((s, p) => s + p.totalBonuses, 0),
      totalLateness: payroll.reduce((s, p) => s + p.latenessDeduction, 0),
      totalDeductions: payroll.reduce((s, p) => s + p.totalDeductions, 0),
      totalNet: payroll.reduce((s, p) => s + p.netSalary, 0),
    },
  });
});

router.get("/payroll/pdf", async (req, res) => {
  if (!roles.canViewPayroll(req.userRole)) {
    return res.status(403).json({ error: "No permission to view payroll" });
  }
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const unit = req.query.unit || "";
  const hideOut = parseHideOut(req);

  let employees = store.getEmployeesForMonth(month, { hideOut });
  employees = filterEmployeesForRequest(employees, req);
  if (unit) employees = employees.filter((e) => e.unit === unit);

  const config = store.getConfig();
  const rates = store.getPositionRates();
  const records = store.getAttendanceEvents(month);
  const bonusEvents = store.getBonusEvents(month);
  const deductionEvents = store.getDeductionEvents(month);
  const adjustments = store.getPayrollAdjustments(month);
  const attendanceMap = store.buildAttendanceMap(month);
  const { commissionTiers, loans, loanPayments } = store.getPayrollExtras(month);
  const allPayrollSplits = store.getAllPayrollSplits();

  const summaries = employees.map((emp) =>
    summarizeEmployeeMonth(
      emp,
      records.filter((r) => r.employeeId === emp.id),
      config
    )
  );

  const payroll = buildPayroll(
    employees,
    summaries,
    month,
    config,
    rates,
    bonusEvents,
    deductionEvents,
    adjustments,
    attendanceMap,
    commissionTiers,
    loans,
    loanPayments,
    allPayrollSplits
  );
  const totals = {
    totalNet: payroll.reduce((s, p) => s + p.netSalary, 0),
  };
  const { buildPayrollTablePdf } = require("../lib/pdf-export");
  const pdf = await buildPayrollTablePdf(payroll, month, totals);
  res.type("application/pdf").attachment(`payroll-${month}.pdf`).send(pdf);
});

router.get("/payroll/:employeeId", async (req, res) => {
  if (!roles.canViewBonusesDeductions(req.userRole)) {
    return res.status(403).json({ error: "No permission to view payroll" });
  }
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!assertEmployeeInCompanyContext(emp, req)) {
    return res.status(404).json({ error: "Employee not found" });
  }

  const bundle = await loadEmployeePayslipBundle(emp, month);
  res.json({
    month,
    payslip: bundle.payslip,
    splits: bundle.payslip.splits || [],
    splitKinds: SPLIT_KINDS,
    splitStatuses: SPLIT_STATUSES.filter((s) => s !== "cancelled"),
    employee: emp,
    adjustment: store.getPayrollAdjustment(month, emp.id),
    bonuses: bundle.bonusEvents,
    deductions: bundle.deductionEvents,
    attendance: bundle.attendanceRecords,
    bonusTypes: BONUS_TYPES,
    deductionTypes: DEDUCTION_TYPES,
    commissionTypes: store.getCommissionTypes(),
    commissionTiers: store.getPayrollExtras(month).commissionTiers,
  });
});

router.get("/bonuses", (req, res) => {
  if (!roles.canViewBonusesDeductions(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const employeeId = req.query.employeeId || "";
  const employees = filterEmployeesForRequest(store.getEmployeesForMonth(month), req);
  const deductions = store.getDeductionEvents(month);
  let bonuses = store.getBonusEvents(month, employeeId || undefined);
  if (!employeeId) {
    bonuses = roles.filterBonusesForUser(bonuses, deductions, req.userRole, employees);
  } else if (!roles.scopedEmployeeIds(employees, req.userRole).has(employeeId)) {
    const allowed = roles.filterBonusesForUser(
      bonuses,
      deductions,
      req.userRole,
      employees
    );
    if (!allowed.some((b) => b.employeeId === employeeId)) {
      return res.status(403).json({ error: "No access" });
    }
  }
  res.json({
    bonuses,
    types: BONUS_TYPES,
  });
});

router.post("/bonuses", async (req, res) => {
  const { employeeId, date, amount, reason, type, unit, deductFromEmployeeId } = req.body;
  const bonusType = type || "Other Bonus";
  const isTlTransfer = bonusType === "Bonus from TL / OP" && deductFromEmployeeId;

  if (!roles.canManageAll(req.userRole)) {
    if (!isTlTransfer || !roles.canTransferBonus(req.userRole)) {
      return res.status(403).json({ error: "No permission" });
    }
  }

  if (!employeeId || !date || amount == null) {
    return res.status(400).json({ error: "employeeId, date, amount required" });
  }
  if (isTlTransfer && deductFromEmployeeId === employeeId) {
    return res.status(400).json({ error: "Cannot deduct from the same employee receiving the bonus" });
  }

  try {
    await assertMonthNotLocked(String(date).slice(0, 7));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const emp = store.getEmployeeById(employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });

  try {
    require("../lib/bonus-guards").assertBonusAllowedForEmployee(emp, date);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (!isTlTransfer && !roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only for direct bonuses" });
  }
  if (!isTlTransfer) {
    const { fetchAuthUsers } = require("../lib/auth");
    const authUsers = await fetchAuthUsers();
    if (!roles.canReceiveBonusViaRequest(employeeId, authUsers) && !roles.canManageAll(req.userRole)) {
      return res.status(400).json({
        error: "This employee can only receive bonuses via payslip (HR direct add)",
      });
    }
  }

  if (isTlTransfer) {
    const fromEmp = store.getEmployeeById(deductFromEmployeeId);
    if (!fromEmp) return res.status(404).json({ error: "Deduction employee not found" });
    if (!roles.canGrantTransferBonus(req.userRole, emp, fromEmp)) {
      return res.status(403).json({ error: "No access to one of the employees" });
    }
  } else if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }

  await store.upsertBonus(
    {
      employeeId,
      date,
      amount: Number(amount),
      reason: isTlTransfer
        ? `${reason || "TL bonus"} (deducted from ${deductFromEmployeeId})`
        : reason,
      type: bonusType,
      unit: unit || emp?.unit || "",
    },
    req.username
  );

  if (isTlTransfer) {
    const fromEmp = store.getEmployeeById(deductFromEmployeeId);
    await store.upsertDeduction(
      {
        employeeId: deductFromEmployeeId,
        date,
        amount: Number(amount),
        reason: reason || `TL bonus paid to ${employeeId}`,
        type: "Bonus from TL / OP",
        unit: fromEmp?.unit || "",
      },
      req.username
    );
  }

  res.json({ ok: true });
});

router.patch("/bonuses", async (req, res) => {
  const {
    originalEmployeeId,
    originalDate,
    originalType,
    employeeId,
    date,
    amount,
    reason,
    type,
    unit,
    deductFromEmployeeId,
  } = req.body;
  const bonusType = type || originalType || "Other Bonus";
  const isTlTransfer = bonusType === "Bonus from TL / OP" && deductFromEmployeeId;

  if (!roles.canManageAll(req.userRole)) {
    if (!isTlTransfer || !roles.canTransferBonus(req.userRole)) {
      return res.status(403).json({ error: "No permission" });
    }
  }
  if (!originalEmployeeId || !originalDate || !originalType) {
    return res.status(400).json({ error: "originalEmployeeId, originalDate, originalType required" });
  }
  if (!employeeId || !date || amount == null) {
    return res.status(400).json({ error: "employeeId, date, amount required" });
  }
  if (isTlTransfer && deductFromEmployeeId === employeeId) {
    return res.status(400).json({ error: "Cannot deduct from the same employee receiving the bonus" });
  }

  await deleteTlBonusPair(req, {
    employeeId: originalEmployeeId,
    date: originalDate,
    type: originalType,
  });

  if (isTlTransfer) {
    await upsertTlBonusPair(req, {
      employeeId,
      date,
      amount,
      reason,
      unit,
      deductFromEmployeeId,
    });
  } else {
    const emp = store.getEmployeeById(employeeId);
    await store.upsertBonus(
      {
        employeeId,
        date,
        amount: Number(amount),
        reason,
        type: bonusType,
        unit: unit || emp?.unit || "",
      },
      req.username
    );
  }
  res.json({ ok: true });
});

router.delete("/bonuses", async (req, res) => {
  if (!roles.canManageAll(req.userRole) && !roles.canTransferBonus(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  const { employeeId, date, type } = req.body;
  if (!employeeId || !date || !type) {
    return res.status(400).json({ error: "employeeId, date, type required" });
  }
  await deleteTlBonusPair(req, { employeeId, date, type });
  const auditNotify = require("../lib/notify-routing");
  await auditNotify.auditNotify({
    actor: req.username,
    action: "bonus_delete",
    title: "Bonus deleted",
    body: `${employeeId} ${date} ${type}`,
    entityType: "bonus",
    entityId: `${employeeId}|${date}|${type}`,
  });
  res.json({ ok: true });
});

router.get("/deductions", (req, res) => {
  if (!roles.canViewBonusesDeductions(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const employeeId = req.query.employeeId || "";
  const employees = filterEmployeesForRequest(store.getEmployeesForMonth(month), req);
  let deductions = store.getDeductionEvents(month, employeeId || undefined);
  if (!employeeId) {
    deductions = roles.filterDeductionsForUser(deductions, req.userRole, employees);
  } else if (!roles.scopedEmployeeIds(employees, req.userRole).has(employeeId)) {
    return res.status(403).json({ error: "No access" });
  }
  res.json({
    deductions: deductions.map(enrichDeductionForApi),
    types: DEDUCTION_TYPES,
  });
});

router.post("/deductions", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const { employeeId, date, amount, reason, type, unit } = req.body;
  if (!employeeId || !date || amount == null) {
    return res.status(400).json({ error: "employeeId, date, amount required" });
  }
  try {
    await assertMonthNotLocked(String(date).slice(0, 7));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const emp = store.getEmployeeById(employeeId);
  await store.upsertDeduction(
    {
      employeeId,
      date,
      amount: Number(amount),
      reason,
      type: type || "Other Deductions",
      unit: unit || emp?.unit || "",
    },
    req.username
  );
  res.json({ ok: true });
});

router.patch("/deductions", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const { originalEmployeeId, originalDate, originalType, employeeId, date, amount, reason, type, unit } =
    req.body;
  if (!originalEmployeeId || !originalDate || !originalType) {
    return res.status(400).json({ error: "originalEmployeeId, originalDate, originalType required" });
  }
  if (!employeeId || !date || amount == null) {
    return res.status(400).json({ error: "employeeId, date, amount required" });
  }
  await store.deleteDeduction(originalEmployeeId, originalDate, originalType, req.username);
  const emp = store.getEmployeeById(employeeId);
  await store.upsertDeduction(
    {
      employeeId,
      date,
      amount: Number(amount),
      reason,
      type: type || originalType || "Other Deductions",
      unit: unit || emp?.unit || "",
    },
    req.username
  );
  res.json({ ok: true });
});

router.delete("/deductions", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const { employeeId, date, type } = req.body;
  if (!employeeId || !date || !type) {
    return res.status(400).json({ error: "employeeId, date, type required" });
  }
  await store.deleteDeduction(employeeId, date, type, req.username);
  const auditNotify = require("../lib/notify-routing");
  await auditNotify.auditNotify({
    actor: req.username,
    action: "deduction_delete",
    title: "Deduction deleted",
    body: `${employeeId} ${date} ${type}`,
    entityType: "deduction",
    entityId: `${employeeId}|${date}|${type}`,
  });
  res.json({ ok: true });
});

router.get("/position-rates", (req, res) => {
  res.json({ rates: store.getPositionRates() });
});

router.get("/changelog", async (req, res) => {
  if (!roles.canViewLogs(req.userRole)) {
    return res.status(403).json({ error: "Logs access is restricted to Admin/CEO." });
  }
  const entries = await store.readChangeLog({
    limit: Number(req.query.limit) || 100,
    entity: req.query.entity,
    username: req.query.user,
    month: req.query.month,
  });
  res.json({ entries });
});

router.put("/settings/hide-out", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const { hide } = req.body;
  await store.setHideOutEmployees(hide !== false, req.username);
  res.json({ ok: true, hideOutEmployees: hide !== false });
});

router.put("/settings/tax-rules", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const taxRules = {
    incomeTaxRate: Number(req.body.incomeTaxRate) || 0,
    socialInsuranceRate: Number(req.body.socialInsuranceRate) || 0,
  };
  await store.updateTaxRules(taxRules, req.username);
  res.json({ ok: true, taxRules });
});

router.get("/payroll-adjustments", (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  res.json({ month, adjustments: store.getPayrollAdjustments(month) });
});

router.put("/payroll-adjustments/:employeeId", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const month = req.body.yearMonth || req.query.month || new Date().toISOString().slice(0, 7);
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (req.body.payrollStatus) {
    const gate = await payrollGates.canApprovePayrollStatus(
      req.params.employeeId,
      month,
      req.body.payrollStatus,
      emp
    );
    if (!gate.ok) return res.status(400).json({ error: gate.error, blockers: gate.blockers });
  }
  try {
    await assertMonthNotLocked(month);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const record = {
    employeeId: req.params.employeeId,
    yearMonth: month,
    extraDays: Number(req.body.extraDays) || 0,
    twoWeekHold: req.body.twoWeekHold === true,
    commissionType: req.body.commissionType || "",
    commissionAmount: Number(req.body.commissionAmount) || 0,
    commissionComments: req.body.commissionComments || "",
    position: req.body.position ?? emp.position,
    salaryRaise: Number(req.body.salaryRaise) || 0,
    monthlySalaryOverride:
      req.body.monthlySalaryOverride != null && req.body.monthlySalaryOverride !== ""
        ? Number(req.body.monthlySalaryOverride)
        : null,
    paymentMethod: req.body.paymentMethod ?? emp.payment_method,
    bankReference: req.body.bankReference ?? emp.bank_refrence_number,
    bankName: req.body.bankName ?? emp.bank_name_as_bank_sheet,
    payrollStatus: req.body.payrollStatus || "pending",
    transportEligible: req.body.transportEligible === true,
    monthNotes: req.body.monthNotes || "",
    salesCount: Number(req.body.salesCount) || 0,
  };
  const saved = await store.upsertPayrollAdjustment(record, req.username);
  res.json({ ok: true, adjustment: saved });
});

router.post("/payroll-adjustments/init-month", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const month = req.body.month || new Date().toISOString().slice(0, 7);
  const count = await store.initMonthProfiles(month, req.username);
  res.json({ ok: true, count, month });
});

router.post("/payroll-adjustments/bulk-transport", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const month = req.body.month;
  if (!month) return res.status(400).json({ error: "month required (YYYY-MM)" });
  const eligible = req.body.eligible !== false;
  const count = await store.bulkSetTransportEligible(month, eligible, req.username);
  res.json({ ok: true, count, month, eligible });
});

router.get("/payroll-splits", (req, res) => {
  if (!roles.canViewPayroll(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  const month = req.query.month || "";
  const employeeId = req.query.employeeId || "";
  const splits = month
    ? store.getPayrollSplitsForMonth(month, employeeId || undefined)
    : store.getAllPayrollSplits().filter((s) => !employeeId || s.employeeId === employeeId);
  res.json({ splits, splitKinds: SPLIT_KINDS, splitStatuses: SPLIT_STATUSES.filter((s) => s !== "cancelled") });
});

router.post("/payroll-splits", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const { employeeId, yearMonth, amount, splitKind, status, deferToMonth, notes } = req.body;
  if (!employeeId || !yearMonth || amount == null) {
    return res.status(400).json({ error: "employeeId, yearMonth, amount required" });
  }
  const split = {
    employeeId,
    yearMonth,
    amount: Number(amount),
    splitKind: splitKind || "payment",
    status: status || "pending",
    deferToMonth: deferToMonth || "",
    notes: notes || "",
  };
  const err = validateSplit(split);
  if (err) return res.status(400).json({ error: err });
  const saved = await store.createPayrollSplit(split, req.username);
  res.json({ ok: true, split: saved });
});

router.patch("/payroll-splits/:id", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const existing = store.getAllPayrollSplits().find((s) => s.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "Split not found" });
  const merged = {
    ...existing,
    ...req.body,
    id: existing.id,
    employeeId: existing.employeeId,
    yearMonth: existing.yearMonth,
    amount: req.body.amount != null ? Number(req.body.amount) : existing.amount,
  };
  const err = validateSplit(merged);
  if (err) return res.status(400).json({ error: err });
  const saved = await store.updatePayrollSplitRecord(merged, req.username);
  res.json({ ok: true, split: saved });
});

router.delete("/payroll-splits/:id", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const existing = store.getAllPayrollSplits().find((s) => s.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "Split not found" });
  await store.removePayrollSplit(req.params.id, req.username);
  res.json({ ok: true });
});

router.get("/payroll/history/:employeeId", async (req, res) => {
  if (!roles.canViewPayroll(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!assertEmployeeInCompanyContext(emp, req)) {
    return res.status(404).json({ error: "Employee not found" });
  }
  const months = listRecentMonths(Number(req.query.months) || 12);
  const config = store.getConfig();
  const rates = store.getPositionRates();
  const history = [];

  for (const ym of months) {
    const records = store.getAttendanceEvents(ym).filter((r) => r.employeeId === emp.id);
    if (!records.length) continue;
    const summary = summarizeEmployeeMonth(emp, records, config);
    const adjustment = store.getPayrollAdjustment(ym, emp.id);
    const { commissionTiers, loans, loanPayments } = store.getPayrollExtras(ym);
    const allPayrollSplits = store.getAllPayrollSplits();
    const payslip = calcPayrollRow(
      emp,
      summary,
      ym,
      config,
      rates,
      store.getBonusEvents(ym, emp.id),
      store.getDeductionEvents(ym, emp.id),
      adjustment,
      records,
      commissionTiers,
      loans,
      loanPayments
    );
    history.push(payslip);
  }
  res.json({ employeeId: emp.id, history });
});

router.get("/warnings/:employeeId", (req, res) => {
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  res.json({ warnings: store.getEmployeeWarnings(req.params.employeeId) });
});

router.post("/warnings", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const { employeeId, date, type, title, content, severity, warningLevel } = req.body;
  if (!employeeId || !content) {
    return res.status(400).json({ error: "employeeId and content required" });
  }
  const saved = await store.addEmployeeWarning(
    { employeeId, date, type, title, content, severity, warningLevel },
    req.username
  );
  res.json({ ok: true, warning: saved });
});

router.put("/position-rates", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const { position, monthlySalary } = req.body;
  if (!position || monthlySalary == null) {
    return res.status(400).json({ error: "position and monthlySalary required" });
  }
  const rate = await store.upsertPositionRate(position, Number(monthlySalary), req.username);
  res.json({ ok: true, rate });
});

router.delete("/position-rates/:position", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const position = decodeURIComponent(req.params.position);
  const inUse = store.getEmployees().some((e) => e.position === position);
  if (inUse) {
    return res.status(400).json({ error: `Position "${position}" is assigned to employees` });
  }
  try {
    await store.deletePositionRate(position, req.username);
    const auditNotify = require("../lib/notify-routing");
    await auditNotify.auditNotify({
      actor: req.username,
      action: "position_delete",
      title: "Position rate deleted",
      body: position,
      entityType: "position_rate",
      entityId: position,
      includeHr: true,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/commission-types", (req, res) => {
  res.json({ types: store.getCommissionTypes() });
});

router.put("/commission-types", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const { name, rateEgp, description, active } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const saved = await store.upsertCommissionType(
    { name, rateEgp: Number(rateEgp) || 0, description: description || "", active: active !== false },
    req.username
  );
  res.json({ ok: true, type: saved });
});

router.delete("/commission-types/:name", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  await store.deleteCommissionType(decodeURIComponent(req.params.name), req.username);
  res.json({ ok: true });
});

router.get("/commission-tiers", (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  res.json({ month, tiers: store.getCommissionTiers(month) });
});

router.put("/commission-tiers", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const month = req.body.month || req.query.month || new Date().toISOString().slice(0, 7);
  const tiers = await store.setCommissionTiersForMonth(month, req.body.tiers || [], req.username);
  res.json({ ok: true, month, tiers });
});

router.get("/loans", (req, res) => {
  const employeeId = req.query.employeeId || "";
  const loans = store.getEmployeeLoans(employeeId || undefined);
  res.json({ loans });
});

router.post("/loans", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const { employeeId, totalAmount, installmentAmount, installmentsCount, skipCurrentMonth, notes, createdYearMonth } =
    req.body;
  if (!employeeId || !totalAmount) {
    return res.status(400).json({ error: "employeeId and totalAmount required" });
  }
  const emp = store.getEmployeeById(employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  const saved = await store.createEmployeeLoan(
    {
      employeeId,
      totalAmount: Number(totalAmount),
      installmentAmount: installmentAmount != null ? Number(installmentAmount) : 0,
      installmentsCount: installmentsCount != null ? parseInt(installmentsCount, 10) : 0,
      skipCurrentMonth: skipCurrentMonth === true,
      notes: notes || "",
      createdYearMonth: createdYearMonth || new Date().toISOString().slice(0, 7),
    },
    req.username
  );
  res.json({ ok: true, loan: saved });
});

router.patch("/loans/:id", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const saved = await store.updateEmployeeLoanRecord(req.params.id, req.body, req.username);
  res.json({ ok: true, loan: saved });
});

router.post("/loans/:id/cancel", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const saved = await store.cancelEmployeeLoan(req.params.id, req.username);
  res.json({ ok: true, loan: saved });
});

router.delete("/loans/:id", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  await store.removeEmployeeLoan(req.params.id, req.username);
  res.json({ ok: true });
});

router.post("/payroll/record-loan-payments", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const month = req.body.month || req.query.month || new Date().toISOString().slice(0, 7);
  const payments = await store.recordLoanPaymentsForMonth(month, req.username);
  res.json({ ok: true, month, count: payments.length, payments });
});

router.get("/documents/expiring", (req, res) => {
  const now = new Date();
  const docs = store.getEmployeeDocuments();
  const expiring = (docs || []).filter((d) => {
    if (d.noExpiry || !d.expiry) return false;
    const days = (new Date(d.expiry) - now) / 86400000;
    return days >= 0 && days <= 60;
  });
  res.json({ expiring });
});

router.get("/documents/:employeeId", (req, res) => {
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!roles.canAccessEmployee(req.userRole, emp)) {
    return res.status(403).json({ error: "No access" });
  }
  res.json({
    documents: store.getEmployeeDocuments(req.params.employeeId),
    docTypes: require("../lib/documents").DOC_TYPES,
  });
});

router.post("/documents", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const { employeeId, docType, fileName, contentBase64, notes, expiry, noExpiry } = req.body;
  if (!employeeId || !contentBase64 || !fileName) {
    return res.status(400).json({ error: "employeeId, fileName, contentBase64 required" });
  }
  const emp = store.getEmployeeById(employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });

  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const documents = require("../lib/documents");
  const tmpPath = path.join(os.tmpdir(), `hr-doc-${Date.now()}-${fileName}`);
  fs.writeFileSync(tmpPath, Buffer.from(contentBase64, "base64"));
  try {
    const uploaded = await documents.uploadEmployeeFile({
      employeeId,
      docType,
      filePath: tmpPath,
      fileName,
      notes,
      expiry,
    });
    const saved = await store.uploadEmployeeDocument({ ...uploaded, noExpiry: noExpiry === true }, req.username);
    res.json({ ok: true, document: saved });
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  }
});

router.get("/reports/monthly", async (req, res) => {
  if (!roles.canViewPayroll(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const hideOut = parseHideOut(req);
  let employees = store.getEmployeesForMonth(month, { hideOut });
  employees = filterEmployeesForRequest(employees, req);

  const config = store.getConfig();
  const rates = store.getPositionRates();
  const records = store.getAttendanceEvents(month);
  const adjustments = store.getPayrollAdjustments(month);
  const attendanceMap = store.buildAttendanceMap(month);
  const { commissionTiers, loans, loanPayments } = store.getPayrollExtras(month);
  const allPayrollSplits = store.getAllPayrollSplits();
  const summaries = employees.map((emp) =>
    summarizeEmployeeMonth(
      emp,
      records.filter((r) => r.employeeId === emp.id),
      config
    )
  );
  const payroll = buildPayroll(
    employees.filter(isPayrollEligible),
    summaries,
    month,
    config,
    rates,
    store.getBonusEvents(month),
    store.getDeductionEvents(month),
    adjustments,
    attendanceMap,
    commissionTiers,
    loans,
    loanPayments,
    allPayrollSplits
  );
  const { buildMonthlyReport, reportToMarkdown } = require("../lib/reports");
  const report = buildMonthlyReport({ employees, payroll, summaries, month, adjustments });
  const format = req.query.format || "json";
  if (format === "markdown") {
    res.type("text/markdown").send(reportToMarkdown(report));
  } else {
    res.json({ report, markdown: reportToMarkdown(report) });
  }
});

router.get("/reports/monthly/pdf", async (req, res) => {
  if (!roles.canViewPayroll(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const hideOut = parseHideOut(req);
  let employees = store.getEmployeesForMonth(month, { hideOut });
  employees = filterEmployeesForRequest(employees, req);

  const config = store.getConfig();
  const rates = store.getPositionRates();
  const records = store.getAttendanceEvents(month);
  const adjustments = store.getPayrollAdjustments(month);
  const attendanceMap = store.buildAttendanceMap(month);
  const { commissionTiers, loans, loanPayments } = store.getPayrollExtras(month);
  const allPayrollSplits = store.getAllPayrollSplits();
  const summaries = employees.map((emp) =>
    summarizeEmployeeMonth(
      emp,
      records.filter((r) => r.employeeId === emp.id),
      config
    )
  );
  const payroll = buildPayroll(
    employees.filter(isPayrollEligible),
    summaries,
    month,
    config,
    rates,
    store.getBonusEvents(month),
    store.getDeductionEvents(month),
    adjustments,
    attendanceMap,
    commissionTiers,
    loans,
    loanPayments,
    allPayrollSplits
  );
  const { buildMonthlyReport } = require("../lib/reports");
  const { buildMonthlyReportPdf } = require("../lib/pdf-export");
  const report = buildMonthlyReport({ employees, payroll, summaries, month, adjustments });
  const pdf = await buildMonthlyReportPdf(report, month);
  res.type("application/pdf").attachment(`hr-report-${month}.pdf`).send(pdf);
});

router.get("/exports/payments", async (req, res) => {
  if (!roles.canViewLogs(req.userRole)) {
    return res.status(403).json({ error: "Payroll export sheets are restricted to Admin/CEO." });
  }
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const method = (req.query.method || "all").toLowerCase();
  const format = req.query.format || "json";
  const hideOut = parseHideOut(req);

  let employees = store.getEmployeesForMonth(month, { hideOut });
  employees = filterEmployeesForRequest(employees, req);
  const config = store.getConfig();
  const rates = store.getPositionRates();
  const records = store.getAttendanceEvents(month);
  const adjustments = store.getPayrollAdjustments(month);
  const attendanceMap = store.buildAttendanceMap(month);
  const { commissionTiers, loans, loanPayments } = store.getPayrollExtras(month);
  const allPayrollSplits = store.getAllPayrollSplits();
  const summaries = employees.map((emp) =>
    summarizeEmployeeMonth(
      emp,
      records.filter((r) => r.employeeId === emp.id),
      config
    )
  );
  const payroll = buildPayroll(
    employees.filter(isPayrollEligible),
    summaries,
    month,
    config,
    rates,
    store.getBonusEvents(month),
    store.getDeductionEvents(month),
    adjustments,
    attendanceMap,
    commissionTiers,
    loans,
    loanPayments,
    allPayrollSplits
  );
  const {
    buildPaymentExports,
    toCsvWithTotal,
    getPaymentExportColumns,
    sumPaymentExport,
    PAYMENT_EXPORT_META,
  } = require("../lib/bank-export");
  const exports = buildPaymentExports(payroll, employees);
  let data = exports;
  if (method === "cash") data = { cash: exports.cash };
  else if (method === "bank") data = { bank: exports.bank };
  else if (method === "insta") data = { insta: exports.insta };

  if ((format === "csv" || format === "pdf") && method !== "all") {
    const key = method === "cash" ? "cash" : method === "bank" ? "bank" : "insta";
    const rows = exports[key];
    const cols = getPaymentExportColumns(key);
    const total = sumPaymentExport(rows, key);
    const meta = PAYMENT_EXPORT_META[key];

    if (format === "csv") {
      res
        .type("text/csv")
        .attachment(`${meta.filename}-${month}.csv`)
        .send(toCsvWithTotal(rows, cols, total));
      return;
    }

    const { buildPaymentSheetPdf } = require("../lib/pdf-export");
    const pdf = await buildPaymentSheetPdf({
      title: meta.title,
      month,
      columns: cols,
      rows,
      total,
    });
    res.type("application/pdf").attachment(`${meta.filename}-${month}.pdf`).send(pdf);
    return;
  }
  res.json({ month, ...data });
});

router.get("/payslip/:employeeId/pdf", async (req, res) => {
  if (!roles.canViewBonusesDeductions(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!roles.canAccessEmployee(req.userRole, emp)) {
    return res.status(403).json({ error: "No access" });
  }

  const bundle = await loadEmployeePayslipBundle(emp, month);
  const { buildPayslipPdf } = require("../lib/payslip-pdf");
  const pdf = await buildPayslipPdf(bundle.payslip, month, {
    bonusEvents: bundle.bonusEvents,
    deductionEvents: bundle.deductionEvents,
    attendanceRecords: bundle.attendanceRecords,
    config: bundle.config,
    employees: bundle.employees,
  });
  const safeName = (bundle.payslip.name || emp.id).replace(/[^\w\s-]+/g, "").trim().replace(/\s+/g, "-");
  res
    .type("application/pdf")
    .attachment(`payslip-${emp.id}-${safeName}-${month}.pdf`)
    .send(pdf);
});

router.get("/exports/documents-zip", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const { employeeId, unit } = req.query;
  if (!employeeId && !unit) {
    return res.status(400).json({ error: "employeeId or unit required" });
  }
  try {
    const { buildDocumentsZip } = require("../lib/export-zip");
    const zip = await buildDocumentsZip({ employeeId, unit });
    const label = employeeId || unit;
    res.type("application/zip").attachment(`documents-${label}.zip`).send(zip);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;

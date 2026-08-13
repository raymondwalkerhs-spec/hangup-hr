const express = require("express");
const {
  fetchAuthUsers,
  validateLogin,
  checkSession,
} = require("../lib/auth");
const { createSession, getSession, destroySession, validateSession, updateSession } = require("../lib/session-store");
const { requireOnline, isOnline, verifyBackendAccess } = require("../lib/network");
const { authDebug, authDebugError, isAuthDebug, maskSessionId } = require("../lib/auth-debug");
const { getCacheDir } = require("../lib/cache");
const cache = require("../lib/cache");
const store = require("../lib/data-store");
const liveSync = require("../lib/live-sync");
const roles = require("../lib/roles");
const rolePermissions = require("../lib/role-permissions");
const permissionCatalog = require("../lib/permission-catalog");
const registration = require("../lib/registration");
const { getAppVersion, evaluateVersionCompatibility } = require("../lib/app-version");
const { fetchVersionPolicy } = require("../lib/version-sheet");
const {
  buildMonthSkeleton,
  summarizeEmployeeMonth,
  employeeDisplayName,
  ATTENDANCE_STATUSES,
  isPayrollEligible,
  applyDepartAutoOutForMonth,
  isLockedDepartDay,
  isDepartDay,
  departLockEnd,
  attendanceLockEnd,
  normalizeEmployeeDepart,
} = require("../lib/attendance");
const { buildPayroll, calcPayrollRow, BONUS_TYPES, DEDUCTION_TYPES, bonusTypesForCompany } = require("../lib/payroll");
const {
  normalizeAttendanceRecord,
  applyManualAttendanceOverride,
  hasExplicitManualStatus,
} = require("../lib/attendance-validation");
const { PAYROLL_STATUSES: PROFILE_STATUSES } = require("../lib/month-profile");
const { SPLIT_KINDS, SPLIT_STATUSES, validateSplit, applyPayrollSplits, buildSplitMaps, buildValidationContext, shiftMonth } = require("../lib/payroll-splits");
const {
  getMonthCalendar,
  parseYearMonth,
  isWeekend,
} = require("../lib/calendar");
const idGen = require("../lib/id-generator");
const hrms = require("../lib/hrms-repo");
const payrollGates = require("../lib/payroll-gates");
const { useSupabase } = require("../lib/backend");
const companyContext = require("../lib/company-context");
const {
  parseCompany,
  assertEmployeeInCompanyContext,
  requireEmployeeInContext,
  unitInCompanyContext,
  teamInCompanyContext,
  assertRegistrationInContext,
} = require("../lib/request-company-guard");
const companiesRepo = require("../lib/companies-repo");
const rulesRepo = require("../lib/rules-repo");
const teamTlsRepo = require("../lib/team-tls-repo");
const teamClosersRepo = require("../lib/team-closers-repo");
const {
  formatTlDeductionReason,
  parseTlBonusRecipientFromReason,
  findPairedBonusForDeduction,
} = require("../lib/tl-bonus-link");
const { applyTlBonusTransfer } = require("../lib/tl-bonus-transfer");
const analyticsAggregates = require("../lib/analytics-aggregates");

const router = express.Router();

router.param("employeeId", (req, res, next, employeeId) => {
  if (!requireEmployeeInContext(req, res, employeeId)) return;
  next();
});

async function loadActionPlansSafe() {
  if (!useSupabase()) return [];
  try {
    return await hrms.readAllActionPlans();
  } catch {
    return [];
  }
}

async function loadExtraPayrollEntriesForMonth(employees, month) {
  const supabaseRepo = require("../lib/supabase-repo");
  const entries = await Promise.all(
    (employees || []).map((emp) =>
      supabaseRepo.readExtraPayrollEntries(emp.id, month).catch(() => [])
    )
  );
  return entries.flat();
}

/** Merge month working days from store (after sync) so daily rate matches Attendance/Salaries. */
async function resolvePayrollConfig(month) {
  const workingDays = await store.getWorkingDaysForMonth(month);
  const base = store.getConfig();
  const config = {
    ...base,
    workingDaysByMonth: {
      ...(base.workingDaysByMonth || {}),
      [month]: workingDays,
    },
  };
  return { config, workingDays };
}

async function assertCanEditAttendanceDate(employeeId, date) {
  if (!useSupabase()) return;
  const emp = store.getEmployeeById(employeeId);
  const periods = await hrms.getEmploymentPeriods(employeeId);
  const { canEditAttendanceDate } = require("../lib/attendance-employment");
  const check = canEditAttendanceDate(emp, date, periods);
  if (!check.ok) throw new Error(check.reason);
}

async function assertMonthNotLocked(month, req) {
  if (!useSupabase()) return;
  const company = parseCompany(req);
  const lock = await hrms.getPayrollMonthLock(month, company);
  if (lock) throw new Error(`Payroll month ${month} is locked. Unlock in Payroll settings to edit.`);
}

function sessionFromRequest(req) {
  const headerId = req.headers["x-session-id"];
  const cookieId = req.session?.appSessionId;
  const id = headerId || cookieId;
  if (!id) {
    authDebug("sessionFromRequest.miss", {
      path: req.path,
      hasHeader: Boolean(headerId),
      hasCookie: Boolean(cookieId),
    });
    return null;
  }
  const session = getSession(id);
  if (!session) {
    authDebug("sessionFromRequest.not_in_memory", {
      path: req.path,
      sessionId: id,
      source: headerId ? "header" : "cookie",
    });
  }
  return session;
}

function requireAuth(req, res, next) {
  const run = async () => {
    const session = sessionFromRequest(req);
    if (!session) {
      authDebug("requireAuth.denied", { path: req.path, reason: "no_session" });
      return res.status(401).json({ error: "Not logged in" });
    }
    const valid = await validateSession(session.id);
    if (!valid) {
      authDebug("requireAuth.denied", {
        path: req.path,
        sessionId: session.id,
        reason: "validateSession_failed",
      });
      return res.status(401).json({ error: "Session expired or revoked", sessionRevoked: true });
    }
    req.appSession = valid;
    const realUsername = valid.username;
    let effectiveUsername = realUsername;
    let impersonatingAs = valid.impersonatingAs || null;
    let impersonatedUser = null;

    if (impersonatingAs) {
      if (!roles.canImpersonateUsers(realUsername)) {
        impersonatingAs = null;
        updateSession(valid.id, { impersonatingAs: null });
      } else {
        const usersAdmin = require("../lib/users-admin");
        impersonatedUser = await usersAdmin.getAppUser(impersonatingAs).catch(() => null);
        if (!impersonatedUser) {
          impersonatingAs = null;
          updateSession(valid.id, { impersonatingAs: null });
        } else {
          effectiveUsername = impersonatedUser.username || impersonatingAs;
          valid.role = impersonatedUser.role || valid.role;
        }
      }
    }

    req.realUsername = realUsername;
    req.impersonatingAs = impersonatingAs;
    req.username = effectiveUsername;
    const empLinkId =
      impersonatedUser?.employee_id || store.getAppUserEmployeeId(effectiveUsername) || null;
    const usersAdmin = require("../lib/users-admin");
    const appUser = await usersAdmin.getAppUser(effectiveUsername).catch(() => null);
    const orgTeams = await roles.loadOrgTeamsForScope();
    const liveRole = impersonatingAs
      ? (impersonatedUser?.role || valid.role)
      : roles.effectiveLoginRole(valid.role, appUser);
    if (!impersonatingAs && liveRole && liveRole !== roles.normalizeRole(valid.role)) {
      valid.role = liveRole;
      updateSession(valid.id, { role: liveRole });
    }
    req.userRole = roles.enrichUserRole(
      roles.resolveUserRole(effectiveUsername, liveRole),
      store.getEmployees(),
      appUser || (empLinkId ? { employee_id: empLinkId } : null),
      orgTeams
    );
    req.userRole.username = effectiveUsername;
    req.userRole.company = companyContext.resolveCompanyContextForRequest(req);
    if (!roles.hasAppAccess(req.userRole)) {
      authDebug("requireAuth.denied", { path: req.path, username: valid.username, reason: "no_app_access" });
      destroySession(valid.id);
      return res.status(401).json({ error: "Access revoked. Contact Admin." });
    }
    authDebug("requireAuth.ok", { path: req.path, username: req.username });
    next();
  };
  run().catch(next);
}

function parseHideOut(req) {
  if (req.query.showOut === "true") return false;
  if (req.query.hideOut === "true") return true;
  if (req.query.hideOut === "false") return false;
  return store.getConfig().hideOutEmployees !== false;
}

function parseShowLegacy(req) {
  if (req.query.showLegacy === "true") return true;
  if (req.query.showLegacy === "false") return false;
  return store.getConfig().showLegacyEmployees === true;
}

function filterEmployeesForRequest(employees, req) {
  const scoped = companyContext.filterEmployeesByCompany(employees, parseCompany(req));
  return roles.filterEmployeesForUser(scoped, req.userRole);
}

function assertCompanyAccess(req, res) {
  const requested = companyContext.parseCompanyContext(req.query.company || req.body?.company);
  if (requested === "hs2" && !roles.canAccessHs2CompanyContext(req.userRole)) {
    res.status(403).json({ error: "No access to HS-2 company context" });
    return false;
  }
  return true;
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

async function loadEmployeePayslipBundle(emp, month, req = null) {
  const reqCtx = req || { userRole: { role: "admin" }, query: {} };
  await store.refreshPayrollAdjustmentsFromSupabase(month);
  if (useSupabase()) {
    try {
      const trainingPhases = require("../lib/training-phases");
      const { buildProgramPayrollDataForEmployees, resolveTrainingPayrollAnchorMonth } = require("../lib/training-payroll");
      const programs = await trainingPhases.loadProgramsForEmployees([emp.id], { withSales: false });
      const program = programs.get(emp.id);
      if (program) {
        const programPayrollByEmployee = buildProgramPayrollDataForEmployees(programs, {
          getAttendance: (ym, empId) => store.getAttendanceEvents(ym).filter((r) => r.employeeId === empId),
          getBonuses: (ym, empId) => store.getBonusEvents(ym, empId),
          getDeductions: (ym, empId) => store.getDeductionEvents(ym, empId),
        });
        const programPayroll = programPayrollByEmployee.get(emp.id);
        const anchorMonth = resolveTrainingPayrollAnchorMonth(program, programPayroll?.attendanceRecords || []);
        if (anchorMonth && anchorMonth !== month) {
          await store.refreshPayrollAdjustmentsFromSupabase(anchorMonth);
        }
      }
    } catch (err) {
      console.warn("payslip anchor-month adjustment preload failed:", err.message);
    }
  }
  const enriched = await buildEnrichedPayrollForMonth(month, reqCtx, {});

  const gate = await payrollGates.getPayrollBlockers(emp.id, month, emp).catch(() => ({ payslipNotes: [] }));
  const bonusEvents = store.getBonusEvents(month, emp.id);
  const deductionEvents = store.getDeductionEvents(month, emp.id);
  const records = store.getAttendanceEvents(month).filter((r) => r.employeeId === emp.id);
  const supabaseRepo = require("../lib/supabase-repo");
  const extraPayrollEntries = useSupabase()
    ? await supabaseRepo.readExtraPayrollEntries(emp.id, month).catch(() => [])
    : [];

  let payslip = enriched.payroll.find((p) => p.employeeId === emp.id);
  if (!payslip) {
    const { config } = enriched;
    const rates = enriched.rates || store.getPositionRates(month);
    const actionPlans = enriched.actionPlans || [];
    const summary = summarizeEmployeeMonth(
      emp,
      records,
      config,
      actionPlans.filter((p) => p.employeeId === emp.id && p.status === "active")
    );
    const co = reqCtx ? parseCompany(reqCtx) : companyContext.getCompanyForUnit(emp.unit);
    const { commissionTiers, loans, loanPayments } = store.getPayrollExtras(month, co);
    const allPayrollSplits = store.getAllPayrollSplits();
    const splitMaps = buildSplitMaps(allPayrollSplits, month);
    payslip = applyPayrollSplits(
      calcPayrollRow(
        emp,
        summary,
        month,
        config,
        rates,
        bonusEvents,
        deductionEvents,
        store.getPayrollAdjustment(month, emp.id),
        records,
        commissionTiers,
        loans,
        loanPayments,
        actionPlans,
        gate.payslipNotes || [],
        {},
        extraPayrollEntries
      ),
      splitMaps.byEmployeeMonth.get(emp.id) || [],
      splitMaps.deferredIn.get(emp.id) || []
    );
  }

  return {
    payslip,
    bonusEvents,
    deductionEvents,
    attendanceRecords: records,
    config: enriched.config,
    employees: store.getEmployees(),
    payslipGateNotes: gate.payslipNotes || [],
    extraPayrollEntries,
  };
}

function payrollRowNet(p) {
  if (p?.payrollKind === "dual") return p.combinedNet ?? p.netSalary ?? 0;
  return p?.netSalary ?? 0;
}

function payrollRowBasic(p) {
  if (p?.payrollKind === "dual") return p.combinedBasic ?? p.basicSalary ?? 0;
  return p?.basicSalary ?? 0;
}

async function enrichPayrollWithTraining(payroll, employees, month, ctx) {
  return require("../lib/enriched-payroll").enrichPayrollWithTraining(payroll, employees, month, ctx);
}

async function loadProgramsForEmployees(employees) {
  return require("../lib/enriched-payroll").loadProgramsForEmployees(employees);
}

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
        name: employeeDisplayName(emp),
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
        ? `${conflicts.length} employee(s) have Out Dates in ${month}. Bulk marking as Attended will overwrite ${conflicts.reduce((s, c) => s + c.affectedDays, 0)} days after Out Dates.`
        : null,
  };
}

async function buildEnrichedPayrollForMonth(month, req, { unit = "", hideOut, skipAttendanceRefresh } = {}) {
  const enrichedPayroll = require("../lib/enriched-payroll");
  const hide = hideOut ?? parseHideOut(req);
  let employees = store.getEmployeesForMonth(month, { hideOut: hide });
  employees = filterEmployeesForRequest(employees, req);
  if (unit) employees = employees.filter((e) => e.unit === unit);
  const company = parseCompany(req);
  return enrichedPayroll.buildForEmployees(month, employees, company, { skipAttendanceRefresh });
}

async function upsertTlBonusPair(req, { employeeId, date, amount, reason, unit, deductFromEmployeeId }) {
  await applyTlBonusTransfer(
    { employeeId, deductFromEmployeeId, date, amount, reason, unit },
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

function enrichDeductionForApi(d, monthBonuses) {
  if (d.type !== "Bonus from TL / OP") return d;
  let bonusRecipientId = parseTlBonusRecipientFromReason(d.reason);
  if (!bonusRecipientId && monthBonuses) {
    const paired = findPairedBonusForDeduction(d, monthBonuses);
    if (paired) bonusRecipientId = paired.employeeId;
  }
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
    let githubUpdate = null;
    try {
      const githubUpdater = require("../lib/github-updater");
      githubUpdate = await githubUpdater.checkForGitHubUpdate();
    } catch {
      /* non-fatal */
    }
    let installHealth = { ok: true };
    try {
      const githubUpdater = require("../lib/github-updater");
      installHealth = githubUpdater.getInstallHealth();
    } catch {
      /* non-fatal */
    }
    res.json({
      appVersion,
      versionCheck: versionPayload(check),
      githubUpdate,
      installHealth,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/github-update", async (req, res) => {
  try {
    const githubUpdater = require("../lib/github-updater");
    const info = await githubUpdater.checkForGitHubUpdate();
    res.json(info);
  } catch (err) {
    res.status(500).json({ enabled: false, error: err.message });
  }
});

router.get("/health", async (req, res) => {
  const health = {
    ok: true,
    online: await isOnline(),
    backend: "supabase",
    cacheDir: null,
    backendCheck: null,
    errors: [],
  };

  try {
    health.cacheDir = getCacheDir();
  } catch (err) {
    health.ok = false;
    health.errors.push(`Cache: ${err.message}`);
  }

  try {
    health.backendCheck = await verifyBackendAccess();
  } catch (err) {
    health.ok = false;
    health.errors.push(err.message);
  }

  res.status(health.ok ? 200 : 503).json(health);
});

const rateLimiter = require("../lib/rate-limiter");

router.get("/auth-debug/status", async (_req, res) => {
  const { isSupabaseConfigured } = require("../lib/supabase-client");
  let online = false;
  try {
    online = await isOnline();
  } catch {
    /* ignore */
  }
  res.json({
    debugEnabled: isAuthDebug(),
    appVersion: getAppVersion(),
    supabaseConfigured: isSupabaseConfigured(),
    online,
  });
});

router.post("/auth-debug/client-log", (req, res) => {
  const { step, detail } = req.body || {};
  authDebug(`client:${step || "log"}`, detail || {});
  res.json({ ok: true });
});

router.post("/login", async (req, res) => {
  const loginUser = String(req.body?.username || "").trim();
  authDebug("login.start", { username: loginUser, ip: req.ip });
  try {
    const rateLimit = rateLimiter.checkLogin(req);
    if (rateLimit.limited) {
      authDebug("login.rate_limited", { username: loginUser });
      return res.status(429).json({ error: "Too many attempts. Try again later.", limited: true });
    }
    res.set("X-RateLimit-Remaining", String(rateLimit.remaining));
    await requireOnline();
    authDebug("login.online_ok", { username: loginUser });
    const { username, password } = req.body;
    if (!username || !password) {
      authDebug("login.fail", { username: loginUser, reason: "missing_credentials" });
      return res.status(400).json({ error: "Username and password required" });
    }
    const users = await fetchAuthUsers();
    const result = await validateLogin(username, password, users);
    if (!result.ok) {
      if (result.terminated) {
        authDebug("login.fail", { username: loginUser, reason: "terminated" });
        return res.status(403).json({ error: "terminated", terminated: true });
      }
      if (result.reason === "inactive") {
        authDebug("login.fail", { username: loginUser, reason: "inactive" });
        return res.status(403).json({ error: "Account inactive. Contact Admin." });
      }
      authDebug("login.fail", { username: loginUser, reason: result.reason || "invalid" });
      return res.status(401).json({ error: "Invalid username or password" });
    }
    if (!roles.hasAppAccess(roles.resolveUserRole(result.user, result.role))) {
      authDebug("login.fail", { username: result.user, reason: "no_app_access", role: result.role });
      return res.status(403).json({ error: "No access assigned. Contact Admin." });
    }
    const normalizedRole = roles.normalizeRole(result.role);
    const userRole = normalizedRole;
    const versionCheck = await loadVersionCheck(userRole);
    if (versionCheck.status === "blocked") {
      authDebug("login.fail", {
        username: result.user,
        reason: "version_blocked",
        versionCheck: versionCheck.status,
      });
      return res.status(403).json({
        error: versionCheck.message,
        versionBlocked: true,
        versionCheck: versionPayload(versionCheck),
      });
    }
    if (useSupabase()) {
      try {
        await require("../lib/users-admin").touchLastLogin(result.user);
      } catch (err) {
        authDebugError("login.touchLastLogin", err, { username: result.user });
      }
    }
    const authRecord = users.find((u) => u.user.toLowerCase() === result.user.toLowerCase());
    try {
      await new Promise((resolve, reject) => {
        if (!req.session) return resolve();
        req.session.regenerate((err) => (err ? reject(err) : resolve()));
      });
      authDebug("login.session_regenerated", { username: result.user });
    } catch (err) {
      // M1 failsafe: regenerate is hardening only — never block login
      authDebugError("login.session_regenerate", err, { username: result.user });
      console.warn("[login] session regenerate failed:", err?.message || err);
    }
    const session = createSession(result.user, normalizedRole, {
      deviceLabel: req.body.deviceLabel || "Desktop",
      ip: req.ip,
      passwordChangedAtSnapshot: authRecord?.passwordChangedAt || result.passwordChangedAt || null,
    });
    if (useSupabase()) {
      try {
        await hrms.upsertAppSession(session);
        authDebug("login.upsertAppSession.ok", { sessionId: session.id, username: result.user });
        await hrms.revokeOtherSessionsForUser(result.user, session.id);
        authDebug("login.revokeOtherSessions.ok", { username: result.user, keepSessionId: session.id });
      } catch (err) {
        authDebugError("login.supabase_session", err, { sessionId: session.id, username: result.user });
      }
    }
    const payload = {
      ok: true,
      sessionId: session.id,
      username: result.user,
      appVersion: getAppVersion(),
      authDebug: isAuthDebug(),
    };
    const notice = versionPayload(versionCheck);
    if (notice?.status === "update_recommended") {
      payload.versionNotice = notice;
    }
    req.session.appSessionId = session.id;
    try {
      await new Promise((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });
      authDebug("login.session_saved", { sessionId: session.id, cookieSessionId: maskSessionId(session.id) });
    } catch (err) {
      authDebugError("login.session_save", err, { sessionId: session.id });
      throw err;
    }
    authDebug("login.success", { username: result.user, sessionId: session.id, role: normalizedRole });
    res.json(payload);
  } catch (err) {
    authDebugError("login.exception", err, { username: loginUser });
    const msg = err.message || "Connection failed";
    const offline =
      !msg.toLowerCase().includes("credentials") &&
      !msg.toLowerCase().includes("service account");
    res.status(503).json({ error: msg, offline, authDebug: isAuthDebug() });
  }
});

router.post("/logout", (req, res) => {
  const session = sessionFromRequest(req);
  if (session) destroySession(session.id);
  req.session.destroy(() => res.json({ ok: true }));
});

router.use("/registration", require("./registration"));

router.get("/session-check", async (req, res) => {
  const headerId = req.headers["x-session-id"];
  authDebug("session-check.start", { sessionId: headerId || req.session?.appSessionId });
  const session = sessionFromRequest(req);
  if (!session) {
    authDebug("session-check.fail", { reason: "no_session" });
    return res.status(401).json({ error: "Not logged in" });
  }
  try {
    const valid = await validateSession(session.id);
    if (!valid) {
      authDebug("session-check.fail", { sessionId: session.id, reason: "validateSession_failed" });
      return res.json({ action: "session_revoked", message: "Session expired or signed in elsewhere." });
    }
    await requireOnline();
    const users = await fetchAuthUsers();
    const check = require("../lib/auth-supabase").checkSessionByUserRecord(
      valid.username,
      users,
      valid.passwordChangedAtSnapshot
    );
    if (check.action === "uninstall") {
      authDebug("session-check.uninstall", { username: valid.username });
      destroySession(valid.id);
      return res.json({ action: "uninstall" });
    }
    if (check.action === "admin") {
      authDebug("session-check.admin", { username: valid.username, message: check.message });
      destroySession(valid.id);
      return res.json({ action: "admin", message: check.message });
    }
    if (check.role !== undefined) valid.role = check.role;
    if (!roles.hasAppAccess(roles.resolveUserRole(valid.username, valid.role))) {
      authDebug("session-check.fail", { username: valid.username, reason: "no_app_access" });
      destroySession(valid.id);
      return res.json({ action: "admin", message: "Access removed. Contact Admin." });
    }
    const userRole = roles.resolveUserRole(valid.username, valid.role).role;
    const versionCheck = await loadVersionCheck(userRole);
    if (versionCheck.status === "blocked") {
      authDebug("session-check.version_blocked", { username: valid.username });
      destroySession(valid.id);
      return res.json({
        action: "version_blocked",
        message: versionCheck.message,
        versionCheck: versionPayload(versionCheck),
      });
    }
    const payload = {
      action: "ok",
      username: valid.username,
      sessionId: valid.id,
      appVersion: getAppVersion(),
    };
    const notice = versionPayload(versionCheck);
    if (notice?.status === "update_recommended") {
      payload.versionNotice = notice;
    }
    try {
      const { getRevision } = require("../lib/settings-revision");
      const breaksRepo = require("../lib/break-schedules-repo");
      payload.settingsRevision = await getRevision();
      const empLink = store.getAppUserEmployeeId(valid.username);
      const enriched = roles.enrichUserRole(
        roles.resolveUserRole(valid.username, valid.role),
        store.getEmployees(),
        empLink ? { employee_id: empLink } : null
      );
      const breaks = await breaksRepo.readBreakSchedules();
      const activeBreak = breaksRepo.activeBreakForUser(breaks, enriched);
      if (activeBreak) payload.activeBreak = activeBreak;
    } catch {
      /* optional */
    }
    authDebug("session-check.ok", { username: valid.username, sessionId: valid.id });
    res.json(payload);
  } catch (err) {
    authDebugError("session-check.exception", err);
    res.status(503).json({ error: err.message, offline: true });
  }
});

router.use(requireAuth);

const BACKEND_HEALTH_TTL_MS = 30_000;
let backendHealthCache = { at: 0, ok: false };

async function probeBackendHealth() {
  const now = Date.now();
  if (now - backendHealthCache.at < BACKEND_HEALTH_TTL_MS) {
    return backendHealthCache;
  }
  try {
    await Promise.race([
      verifyBackendAccess(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2500)),
    ]);
    backendHealthCache = { at: now, ok: true };
  } catch {
    backendHealthCache = { at: now, ok: false };
  }
  return backendHealthCache;
}

// Badge still renders when sync is failing.
router.get("/status", async (req, res) => {
  let online = await isOnline();
  const health = await probeBackendHealth();
  const backendOk = health.ok;
  if (backendOk) online = true;
  const config = store.getConfig();
  let dropboxHealth = { configured: false };
  try {
    const dropbox = require("../lib/dropbox");
    dropboxHealth.configured = dropbox.isConfigured();
    if (
      req.query.health === "full" &&
      dropbox.isConfigured() &&
      roles.canManageAppUsers(req.realUsername || req.username)
    ) {
      const check = await dropbox.verifyAccess();
      dropboxHealth = { configured: true, ...check };
    }
  } catch (err) {
    dropboxHealth = { configured: false, error: err.message };
  }
  let agentPayslipAvailable = false;
  if (["agent", "office_assistant"].includes(req.userRole?.role) && req.userRole?.employeeId) {
    const emp = store.getEmployeeById(req.userRole.employeeId);
    const adj = store.getPayrollAdjustment(roles.localYearMonth(), req.userRole.employeeId);
    agentPayslipAvailable = roles.canViewAgentPayslip(req.userRole, emp, adj);
  }
  const company = parseCompany(req);
  const scopedConfig = store.getConfigForCompany(company);
  res.json({
    online,
    backendOk,
    live: true,
    dataBackend: "supabase",
    lastSync: store.getLastSync()?.toISOString() || null,
    hideOutEmployees: config.hideOutEmployees !== false,
    showLegacyEmployees: config.showLegacyEmployees === true,
    taxRules: scopedConfig.taxRules || { incomeTaxRate: 0, socialInsuranceRate: 0 },
    company,
    canManageHs2Company: roles.canManageHs2Company(req.userRole),
    canAccessHs2Company: roles.canAccessHs2CompanyContext(req.userRole),
    canManageSessions: roles.canManageSessions(req.realUsername || req.username),
    canApproveLeave: roles.canApproveLeave(req.realUsername || req.username, req.userRole),
    user: {
      username: req.username,
      role: req.userRole.role,
      unit: req.userRole.unit,
      team: req.userRole.team,
      employeeId: req.userRole.employeeId,
      leadTeams: req.userRole.leadTeams || [],
      closerTeams: req.userRole.closerTeams || [],
      canManageUsers: roles.canManageAppUsersPerm(req.userRole, req.realUsername || req.username),
      canImpersonate: roles.canImpersonateUsers(req.realUsername || req.username),
      canApproveLeave: roles.canApproveLeave(req.realUsername || req.username, req.userRole),
      canManageSessions: roles.canManageSessions(req.realUsername || req.username),
      canViewPayroll: roles.canViewPayroll(req.userRole),
      canViewBonuses: roles.canViewBonusesDeductions(req.userRole),
      canEditAttendance: roles.canEditAttendance(req.userRole),
      canUseNullAttendanceStatus: roles.canUseNullAttendanceStatus(req.userRole),
      canViewTransportControls: roles.canViewTransportControls(req.userRole),
      canTransferBonus: roles.canTransferBonus(req.userRole),
      canSubmitBonusRequest: roles.canSubmitBonusRequest(req.userRole),
      canApproveBonusRequest: roles.canApproveBonusRequest(req.userRole),
      canViewSales: roles.canViewSales(req.userRole),
      canSubmitSales: roles.canSubmitSales(req.userRole),
      canEditSales: roles.canEditSale(req.userRole),
      canViewSale: roles.canViewSale(req.userRole),
      canApproveSales: roles.canApproveSales(req.userRole),
      canWorkQualityTicket: roles.canWorkQualityTicket(req.userRole),
      canDeleteSales: roles.canDeleteSales(req.userRole),
      canReassignSaleLead: roles.canReassignSaleLead(req.userRole),
      canApproveRegistration: registration.canApproveRegistration(req.userRole?.role),
      canAccessCosts: roles.canAccessCostsFull(req.userRole, req.username),
      canSubmitExpense: roles.canSubmitExpense(req.userRole, req.username),
      canApproveLoan: roles.canApproveLoanRequest(req.realUsername || req.username),
      canManageOrg: roles.canManageOrgStructure(req.userRole),
      canManageEmployees: roles.canManageEmployees(req.userRole),
      canViewEmployeeNotes: roles.canViewEmployeeNotes(req.userRole),
      canWriteEmployeeNotes: roles.canWriteEmployeeNotes(req.userRole),
      canViewQualityNotes: roles.canViewQualityNotes(req.userRole),
      canWriteQualityNotes: roles.canWriteQualityNotes(req.userRole),
      canExportSales: roles.canExportSales(req.userRole),
      canViewDashboardUnits: roles.canViewDashboardUnits(req.userRole),
      canViewTeamDashboard: roles.canViewTeamDashboard(req.userRole),
      canIssueEquipment: roles.canIssueEquipment(req.userRole),
      canViewEquipment: roles.canViewEquipment(req.userRole),
      canViewEquipmentAll: roles.canViewEquipmentAll(req.userRole),
      canViewEquipmentUnit: roles.canViewEquipmentUnit(req.userRole),
      canViewEquipmentInventory: roles.canViewEquipmentInventory(req.userRole),
      canViewReports: roles.canViewReports(req.userRole),
      canViewBonusTransferSource: roles.canViewBonusTransferSource(req.userRole),
      canViewTlOpBonusTransfers: roles.canViewTlOpBonusTransfers(req.userRole),
      canViewEmployeeNationality: roles.canViewEmployeeNationalityGlobal(req.userRole),
      canViewEmployeeCompliance: roles.canViewEmployeeComplianceFilters(req.userRole),
      canViewEmployeeComplianceFilters: roles.canViewEmployeeComplianceFilters(req.userRole),
      canViewDashboardPayroll: roles.canViewDashboardPayroll(req.userRole),
      canViewDashboardFull: roles.canViewDashboardFull(req.userRole),
      canUseEmployeeFilters: roles.canUseEmployeeFilters(req.userRole),
      canAddEmployee: roles.canAddEmployee(req.userRole),
      canViewSettingsHolidays: roles.canViewSettingsSection(req.userRole, "holidays"),
      canViewSettingsSession: roles.canViewSettingsSection(req.userRole, "session"),
      canViewSettingsHideOut: roles.canViewSettingsSection(req.userRole, "hideOut"),
      canViewSettingsSync: roles.canViewSettingsSection(req.userRole, "sync"),
      canViewSettingsTheme: roles.canViewSettingsSection(req.userRole, "theme"),
      canViewSettingsProfilePhoto: roles.canViewSettingsSection(req.userRole, "profilePhoto"),
      canViewSettingsManagingUnits: roles.canViewSettingsSection(req.userRole, "managingUnits"),
      canGrantSalesVisibility: roles.canGrantSalesVisibility(req.userRole),
      canManageSalesFieldPermissions: roles.canManageSalesFieldPermissions(req.userRole),
      canViewSalesAdmin: roles.canViewSalesAdmin(req.userRole),
      canManageHs2Company: roles.canManageHs2Company(req.userRole),
      canAccessHs2Company: roles.canAccessHs2CompanyContext(req.userRole),
      canSeeHs2InSales: roles.canSeeHs2InSales(req.userRole),
      canManageAccessControl: roles.canManageAccessControl(req.userRole),
      canViewAgentPayslipNav: agentPayslipAvailable,
      canViewRules: roles.canViewRules(req.userRole),
      canEditRules: roles.canEditRules(req.userRole),
      canViewAnnouncements: roles.canViewAnnouncements(req.userRole),
      canEditAnnouncements: roles.canEditAnnouncements(req.userRole),
      canViewCoaching: roles.canViewCoaching(req.userRole),
      canSubmitCoaching: roles.canSubmitCoaching(req.userRole),
      canViewCoachingSecret: roles.canViewCoachingSecret(req.userRole),
      canDeleteCoaching: roles.canDeleteCoaching(req.userRole),
      canEditCoachingDateTime: roles.canEditCoachingDateTime(req.userRole),
      canViewItRequests: roles.canViewItRequests(req.userRole),
      canSubmitItRequest: roles.canSubmitItRequest(req.userRole),
      canAssignItRequest: roles.canAssignItRequest(req.userRole),
      canApproveItRequest: roles.canAssignItRequest(req.userRole),  // approve/deny uses same gate
      canResolveItRequest: roles.canResolveItRequest(req.userRole),
      canDeleteItRequest: roles.canDeleteItRequest(req.userRole),
      canViewMeetingRequests: roles.canViewMeetingRequests(req.userRole),
      canSubmitMeetingRequest: roles.canSubmitMeetingRequest(req.userRole),
      canReviewMeetingRequest: roles.canReviewMeetingRequest(req.userRole),
      canViewRequestFilters: roles.canViewRequestFilters(req.userRole),
      canViewItRequestFilters: roles.canViewItRequestFilters(req.userRole),
      canViewInterviews: roles.canViewInterviews(req.userRole),
      canEditInterview: roles.canEditInterview(req.userRole),
      canDeleteInterview: roles.canDeleteInterview(req.userRole),
      canManageCompanies: roles.canManageCompanies(req.userRole),
      // Leave approval — routes through Access Control so HR roles can be granted/revoked
      canApproveLeave: roles.canApproveLeave(req.realUsername || req.username, req.userRole),
      // Annual leave eligibility for the linked employee (used by frontend to show/hide annual option)
      annualLeaveEligible: (() => {
        const requestRulesLib = require("../lib/request-rules");
        if (["hr", "admin", "ceo"].includes(req.userRole?.role)) return true;
        const emp = req.userRole?.employeeId ? store.getEmployeeById(req.userRole.employeeId) : null;
        return requestRulesLib.isAnnualLeaveEligible(emp);
      })(),
    },
    impersonation: {
      active: Boolean(req.impersonatingAs),
      as: req.impersonatingAs || null,
      realUsername: req.realUsername || req.username,
    },
    appVersion: getAppVersion(),
    dropbox: dropboxHealth,
    supabaseUrl: process.env.SUPABASE_URL || null,
    cacheDir: getCacheDir(),
  });
});

function assertAccessControlAdmin(req, res) {
  if (!roles.canManageAccessControl(req.userRole)) {
    res.status(403).json({ error: "Admin or CEO only" });
    return false;
  }
  return true;
}

router.get("/rbac/catalog", async (req, res) => {
  if (!assertAccessControlAdmin(req, res)) return;
  try {
    const defaults = permissionCatalog.getDefaultMatrix();
    res.json({
      roles: permissionCatalog.MANAGEABLE_ROLES,
      categories: permissionCatalog.listCategories(),
      permissions: permissionCatalog.listPermissions(),
      defaults,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

router.get("/rbac/overrides", async (req, res) => {
  if (!assertAccessControlAdmin(req, res)) return;
  try {
    const company = parseCompany(req);
    const overrides = await rolePermissions.listOverrides(company);
    const effective = await rolePermissions.getEffectiveMatrix(company);
    res.json({ overrides, effective, company });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

router.put("/rbac/overrides", async (req, res) => {
  if (!assertAccessControlAdmin(req, res)) return;
  try {
    const company = parseCompany(req);
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : req.body;
    if (!Array.isArray(entries)) {
      return res.status(400).json({ error: "Expected { entries: [...] }" });
    }
    const result = await rolePermissions.saveOverrides(entries, req.realUsername || req.username, company);
    res.json({ ok: true, company, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

router.post("/rbac/reset", async (req, res) => {
  if (!assertAccessControlAdmin(req, res)) return;
  try {
    const company = parseCompany(req);
    const role = req.body?.role;
    if (!role) return res.status(400).json({ error: "role required" });
    const keys = Array.isArray(req.body?.permissionKeys) ? req.body.permissionKeys : null;
    const result = await rolePermissions.resetRole(role, keys, company);
    res.json({ ok: true, company, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

router.get("/impersonate/users", async (req, res) => {
  if (!roles.canImpersonateUsers(req.realUsername || req.username)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const usersAdmin = require("../lib/users-admin");
    const company = parseCompany(req);
    const scopedEmployees = companyContext.filterEmployeesByCompany(store.getEmployees(), company);
    const scopedIds = new Set(scopedEmployees.map((e) => e.id));
    const empById = new Map(scopedEmployees.map((e) => [e.id, e]));
    const users = (await usersAdmin.listAppUsers())
      .filter((u) => {
        const empId = u.employee_id || u.employeeId || null;
        if (!empId) return company === "hangup";
        return scopedIds.has(empId);
      })
      .map((u) => {
      const empId = u.employee_id || u.employeeId || null;
      const emp = empId ? empById.get(empId) : null;
      return {
        username: u.username,
        role: u.role,
        status: u.status,
        employeeId: empId,
        employeeName: emp?.american_name || emp?.arabic_name || null,
      };
    });
    users.sort((a, b) =>
      String(a.employeeName || a.username).localeCompare(String(b.employeeName || b.username))
    );
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/impersonate/start", async (req, res) => {
  if (!roles.canImpersonateUsers(req.realUsername || req.username)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const username = String(req.body?.username || "").trim();
  if (!username) return res.status(400).json({ error: "username required" });
  if (username.toLowerCase() === String(req.realUsername || "").toLowerCase()) {
    return res.status(400).json({ error: "Already viewing as yourself" });
  }
  try {
    const usersAdmin = require("../lib/users-admin");
    const target = await usersAdmin.getAppUser(username);
    if (!target) return res.status(404).json({ error: "User not found" });
    const empId = target.employee_id || target.employeeId || null;
    if (empId) {
      const emp = store.getEmployeeById(empId);
      if (!assertEmployeeInCompanyContext(emp, req)) {
        return res.status(404).json({ error: "User not found" });
      }
    } else if (parseCompany(req) !== "hangup") {
      return res.status(404).json({ error: "User not found" });
    }
    updateSession(req.appSession.id, { impersonatingAs: target.username });
    res.json({ ok: true, impersonatingAs: target.username });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/impersonate/stop", async (req, res) => {
  if (!roles.canImpersonateUsers(req.realUsername || req.username)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  updateSession(req.appSession.id, { impersonatingAs: null });
  res.json({ ok: true });
});

router.use("/announcements", require("./announcements"));
router.use("/coaching", require("./coaching"));
router.use("/admin/users", require("./admin-users"));
router.use("/backup", require("./backup-api"));
router.use("/bonus-requests", (req, res, next) => {
  if (req.userRole?.employeeId) {
    req.userRole.username = req.username;
    return next();
  }
  const empLink = store.getAppUserEmployeeId(req.username);
  roles
    .enrichUserRoleWithOrgTeams(
      req.userRole || roles.resolveUserRole(req.username, req.appSession?.role),
      store.getEmployees(),
      empLink ? { employee_id: empLink } : null
    )
    .then((ur) => {
      req.userRole = ur;
      req.userRole.username = req.username;
      next();
    })
    .catch(next);
}, require("./bonus-requests"));
router.use("/sales", (req, res, next) => {
  if (req.userRole?.employeeId) {
    req.userRole.username = req.username;
    return next();
  }
  const empLink = store.getAppUserEmployeeId(req.username);
  roles
    .enrichUserRoleWithOrgTeams(
      req.userRole || roles.resolveUserRole(req.username, req.appSession?.role),
      store.getEmployees(),
      empLink ? { employee_id: empLink } : null
    )
    .then((ur) => {
      req.userRole = ur;
      req.userRole.username = req.username;
      next();
    })
    .catch(next);
}, require("./sales"));
router.use("/rpm-sales", (req, res, next) => {
  if (req.userRole?.employeeId) {
    req.userRole.username = req.username;
    return next();
  }
  const empLink = store.getAppUserEmployeeId(req.username);
  roles
    .enrichUserRoleWithOrgTeams(
      req.userRole || roles.resolveUserRole(req.username, req.appSession?.role),
      store.getEmployees(),
      empLink ? { employee_id: empLink } : null
    )
    .then((ur) => {
      req.userRole = ur;
      req.userRole.username = req.username;
      next();
    })
    .catch(next);
}, require("./rpm-sales"));
router.use("/sales-config", (req, res, next) => {
  if (req.userRole?.employeeId) {
    req.userRole.username = req.username;
    return next();
  }
  const empLink = store.getAppUserEmployeeId(req.username);
  roles
    .enrichUserRoleWithOrgTeams(
      req.userRole || roles.resolveUserRole(req.username, req.appSession?.role),
      store.getEmployees(),
      empLink ? { employee_id: empLink } : null
    )
    .then((ur) => {
      req.userRole = ur;
      req.userRole.username = req.username;
      next();
    })
    .catch(next);
}, require("./sales-config"));
router.use("/expenses", (req, res, next) => {
  req.userRole = req.userRole || roles.resolveUserRole(req.username, req.appSession?.role);
  next();
}, require("./expenses"));
router.use("/loan-requests", (req, res, next) => {
  if (req.userRole?.employeeId) {
    req.userRole.username = req.username;
    return next();
  }
  const empLink = store.getAppUserEmployeeId(req.username);
  roles
    .enrichUserRoleWithOrgTeams(
      req.userRole || roles.resolveUserRole(req.username, req.appSession?.role),
      store.getEmployees(),
      empLink ? { employee_id: empLink } : null
    )
    .then((ur) => {
      req.userRole = ur;
      req.userRole.username = req.username;
      next();
    })
    .catch(next);
}, require("./loan-requests"));
router.use("/hrms", (req, res, next) => {
  req.userRole = req.userRole || roles.resolveUserRole(req.username, req.appSession?.role);
  next();
}, require("./hrms"));
router.use("/interview", (req, res, next) => {
  req.userRole = req.userRole || roles.resolveUserRole(req.username, req.appSession?.role);
  next();
}, require("./interview"));

const orgHierarchy = require("../lib/org-hierarchy");

router.get("/registration/daily-pin", async (req, res) => {
  if (!registration.canViewDailyPin(req.userRole?.role)) {
    return res.status(403).json({ error: "Not allowed" });
  }
  try {
    const registrationCodes = require("../lib/registration-codes");
    const company = parseCompany(req);
    const daily = await registration.getOrCreateDailyPin(undefined, company);
    const orgCode = await registrationCodes.getOrgCodeForCompany(company);
    const registrationCode = registrationCodes.formatRegistrationCode(orgCode, daily.pin);
    res.json({
      date: daily.date,
      registrationCode,
      pin: daily.pin,
    });
  } catch (err) {
    console.error("[registration/daily-pin] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/registration/pending", async (req, res) => {
  if (!registration.canApproveRegistration(req.userRole?.role)) {
    return res.status(403).json({ error: "Not allowed" });
  }
  try {
    const company = parseCompany(req);
    const pending = await registration.listPendingRegistrations(company);
    res.json({ pending });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/registration/:id/approve", async (req, res) => {
  if (!registration.canApproveRegistration(req.userRole?.role)) {
    return res.status(403).json({ error: "Not allowed" });
  }
  if (!(await assertRegistrationInContext(req, res, req.params.id))) return;
  try {
    const result = await registration.approveRegistration(req.params.id, req.username, req.body || {});
    await store.refreshCache();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/registration/:id/reject", async (req, res) => {
  if (!registration.canApproveRegistration(req.userRole?.role)) {
    return res.status(403).json({ error: "Not allowed" });
  }
  if (!(await assertRegistrationInContext(req, res, req.params.id))) return;
  try {
    await registration.rejectRegistration(req.params.id, req.username);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/org/managers", async (req, res) => {
  try {
    const [managers, allTls, allClosers, allOps, allTeams] = await Promise.all([
      orgHierarchy.readUnitManagers(),
      teamTlsRepo.readAllTeamTls(),
      teamClosersRepo.readAllTeamClosers().catch(() => ({})),
      teamTlsRepo.readAllUnitOps(),
      hrms.readOrgTeams(),
    ]);
    const company = parseCompany(req);
    const companyEmployees = companyContext.filterEmployeesByCompany(
      store.getEmployees({ hideOut: false }),
      company
    );
    const companyUnits = new Set(companyEmployees.map((e) => e.unit).filter(Boolean));
    const filteredManagers = (managers || []).filter((m) => companyUnits.has(m.unit));
    const filteredTls = Object.fromEntries(
      Object.entries(allTls || {}).filter(([teamId]) => {
        const team = (allTeams || []).find((t) => t.id === teamId);
        return team && companyUnits.has(team.unit);
      })
    );
    const filteredClosers = Object.fromEntries(
      Object.entries(allClosers || {}).filter(([teamId]) => {
        const team = (allTeams || []).find((t) => t.id === teamId);
        return team && companyUnits.has(team.unit);
      })
    );
    const filteredOps = (allOps || []).filter((o) => companyUnits.has(o.unit));
    res.json({
      managers: filteredManagers,
      unitRules: orgHierarchy.UNIT_RULES,
      teamTls: filteredTls,
      teamClosers: filteredClosers,
      unitOps: filteredOps,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/org/managers/:unit", async (req, res) => {
  if (!roles.canManageOrgStructure(req.userRole)) return res.status(403).json({ error: "Admin/HR only" });
  if (!unitInCompanyContext(req.params.unit, req)) {
    return res.status(404).json({ error: "Unit not found" });
  }
  try {
    await orgHierarchy.upsertUnitManager(req.params.unit, req.body || {}, req.username);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/org/team-tls/:teamId", async (req, res) => {
  try {
    if (!(await teamInCompanyContext(req.params.teamId, req))) {
      return res.status(404).json({ error: "Team not found" });
    }
    const tls = await teamTlsRepo.readTeamTls(req.params.teamId);
    res.json({ teamId: req.params.teamId, tls });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/org/team-tls/:teamId", async (req, res) => {
  if (!roles.canManageOrgStructure(req.userRole)) return res.status(403).json({ error: "Admin/HR only" });
  const { employeeId } = req.body;
  if (!employeeId) return res.status(400).json({ error: "employeeId required" });
  if (!(await teamInCompanyContext(req.params.teamId, req))) {
    return res.status(404).json({ error: "Team not found" });
  }
  const emp = store.getEmployeeById(employeeId);
  if (!emp || !assertEmployeeInCompanyContext(emp, req)) {
    return res.status(404).json({ error: "Employee not found" });
  }
  try {
    await teamTlsRepo.addTeamTl(req.params.teamId, employeeId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/org/team-tls/:teamId/:employeeId", async (req, res) => {
  if (!roles.canManageOrgStructure(req.userRole)) return res.status(403).json({ error: "Admin/HR only" });
  if (!(await teamInCompanyContext(req.params.teamId, req))) {
    return res.status(404).json({ error: "Team not found" });
  }
  try {
    await teamTlsRepo.removeTeamTl(req.params.teamId, req.params.employeeId);
    roles.invalidateOrgTeamsCache();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/org/team-closers/:teamId", async (req, res) => {
  try {
    if (!(await teamInCompanyContext(req.params.teamId, req))) {
      return res.status(404).json({ error: "Team not found" });
    }
    const closers = await teamClosersRepo.readTeamClosers(req.params.teamId);
    res.json({ teamId: req.params.teamId, closers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/org/team-closers/:teamId", async (req, res) => {
  if (!roles.canManageOrgStructure(req.userRole)) return res.status(403).json({ error: "Admin/HR only" });
  const { employeeId } = req.body;
  if (!employeeId) return res.status(400).json({ error: "employeeId required" });
  if (!(await teamInCompanyContext(req.params.teamId, req))) {
    return res.status(404).json({ error: "Team not found" });
  }
  try {
    const teams = await hrms.readOrgTeams();
    const team = teams.find((t) => t.id === req.params.teamId);
    if (!team) return res.status(404).json({ error: "Team not found" });
    const emp = store.getEmployeeById(employeeId);
    if (!emp || !assertEmployeeInCompanyContext(emp, req)) {
      return res.status(404).json({ error: "Employee not found" });
    }
    if (team.unit && emp.unit && team.unit !== emp.unit) {
      return res.status(400).json({ error: "Closer must belong to the same unit as the team" });
    }
    await teamClosersRepo.addTeamCloser(req.params.teamId, employeeId);
    roles.invalidateOrgTeamsCache();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/org/team-closers/:teamId/:employeeId", async (req, res) => {
  if (!roles.canManageOrgStructure(req.userRole)) return res.status(403).json({ error: "Admin/HR only" });
  if (!(await teamInCompanyContext(req.params.teamId, req))) {
    return res.status(404).json({ error: "Team not found" });
  }
  try {
    await teamClosersRepo.removeTeamCloser(req.params.teamId, req.params.employeeId);
    roles.invalidateOrgTeamsCache();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/org/unit-ops/:unit", async (req, res) => {
  try {
    if (!unitInCompanyContext(req.params.unit, req)) {
      return res.status(404).json({ error: "Unit not found" });
    }
    const ops = await teamTlsRepo.readUnitOps(req.params.unit);
    res.json({ unit: req.params.unit, ops });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/org/unit-ops/:unit", async (req, res) => {
  if (!roles.canManageOrgStructure(req.userRole)) return res.status(403).json({ error: "Admin/HR only" });
  const { employeeId } = req.body;
  if (!employeeId) return res.status(400).json({ error: "employeeId required" });
  if (!unitInCompanyContext(req.params.unit, req)) {
    return res.status(404).json({ error: "Unit not found" });
  }
  const emp = store.getEmployeeById(employeeId);
  if (!emp || !assertEmployeeInCompanyContext(emp, req)) {
    return res.status(404).json({ error: "Employee not found" });
  }
  try {
    await teamTlsRepo.addUnitOp(req.params.unit, employeeId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/org/unit-ops/:unit/:employeeId", async (req, res) => {
  if (!roles.canManageOrgStructure(req.userRole)) return res.status(403).json({ error: "Admin/HR only" });
  if (!unitInCompanyContext(req.params.unit, req)) {
    return res.status(404).json({ error: "Unit not found" });
  }
  try {
    await teamTlsRepo.removeUnitOp(req.params.unit, req.params.employeeId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const itRequestsRepo = require("../lib/it-requests-repo");

// List IT users for assignee dropdown.
// Scoped to the submitting employee's unit (IT users in same unit first),
// falls back to all IT users if none found in unit.
router.get("/it-requests/it-users", async (req, res) => {
  if (!roles.canAssignItRequest(req.userRole) && !roles.canSubmitItRequest(req.userRole)) {
    return res.status(403).json({ error: "Access denied" });
  }
  try {
    const company = parseCompany(req);
    const unit = req.query.unit || req.userRole?.unit || "";
    const itUsers = await itRequestsRepo.readItUsers({ unit });
    const employees = companyContext.filterEmployeesByCompany(store.getEmployees({ hideOut: false }), company);
    const companyEmpIds = new Set(employees.map((e) => e.id));
    const companyUnits = new Set(employees.map((e) => e.unit).filter(Boolean));
    const empById = new Map(employees.map((e) => [e.id, e]));
    const enriched = itUsers
      .map((u) => {
        const emp = u.employeeId ? empById.get(u.employeeId) : null;
        return {
          username: u.username,
          employeeId: u.employeeId || "",
          unit: emp?.unit || "",
          displayName: emp?.american_name || emp?.arabic_name || u.username,
        };
      })
      .filter((u) => {
        if (u.employeeId) return companyEmpIds.has(u.employeeId);
        return !u.unit || companyUnits.has(u.unit);
      });
    enriched.sort((a, b) => a.displayName.localeCompare(b.displayName));
    res.json({ itUsers: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/it-requests/scoped-agents", async (req, res) => {
  if (!roles.canSubmitItRequest(req.userRole)) return res.status(403).json({ error: "Access denied" });
  try {
    let employees = store.getEmployees({ hideOut: false });
    const company = parseCompany(req);
    if (company) {
      employees = companyContext.filterEmployeesByCompany(employees, company);
    }
    const scoped = roles.employeesForItOnBehalf(req.userRole, employees);
    res.json({
      employees: scoped.map((e) => ({
        id: e.id,
        american_name: e.american_name,
        arabic_name: e.arabic_name,
        team: e.team,
        unit: e.unit,
        status: e.status,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// (removed mark-user-it endpoint; marking IT should be done via Users admin page or scripts)

router.get("/it-requests", async (req, res) => {
  if (!roles.canViewItRequests(req.userRole)) return res.status(403).json({ error: "Access denied" });
  try {
    const filters = {};
    if (req.query.status) filters.status = req.query.status.split(",");
    if (req.query.mine === "true" && req.userRole?.employeeId) filters.employeeId = req.userRole.employeeId;
    // filter by specific agent (employee id) or comma-separated list
    if (req.query.agent) filters.employeeId = req.query.agent.split(",").map(s => s.trim()).filter(Boolean);
    if (req.query.employeeId) filters.employeeId = req.query.employeeId.split(",").map(s => s.trim()).filter(Boolean);
    // Non-IT roles only see their own requests unless they supervise a team/unit.
    const canSuperviseIt =
      !roles.canAssignItRequest(req.userRole) &&
      (roles.hasLeadTeamAssignment(req.userRole) ||
        roles.hasCloserTeamAssignment(req.userRole) ||
        ["tl", "op", "it"].includes(roles.normalizeRole(req.userRole?.role)) ||
        roles.hasItAccess(req.userRole));
    if (!roles.canAssignItRequest(req.userRole)) {
      if (!canSuperviseIt) {
        if (req.userRole?.employeeId) {
          filters.employeeId = req.userRole.employeeId;
        } else {
          filters.createdBy = req.username;
        }
      }
    }
    if (req.query.unit && roles.canAssignItRequest(req.userRole)) filters.unit = req.query.unit;
    // team filter -> translate to employee ids
    if (req.query.team && roles.canAssignItRequest(req.userRole)) {
      const employees = store.getEmployees({ hideOut: false }).filter(e => e.team === req.query.team);
      if (employees.length) filters.employeeId = employees.map(e => e.id);
    }
    // date range filters (ISO date strings)
    if (req.query.from) filters.from = req.query.from;
    if (req.query.to) filters.to = req.query.to;
    let requests = await itRequestsRepo.readItRequests(filters);
    if (!roles.canAssignItRequest(req.userRole) && canSuperviseIt) {
      const allEmployees = store.getEmployees({ hideOut: false });
      const scopeIds = new Set(roles.employeesForItOnBehalf(req.userRole, allEmployees).map((e) => e.id));
      if (req.userRole?.employeeId) scopeIds.add(req.userRole.employeeId);
      const uname = String(req.username || "").toLowerCase();
      requests = requests.filter(
        (r) =>
          scopeIds.has(r.employeeId) || String(r.createdBy || "").toLowerCase() === uname
      );
    }
    // Apply company context filter
    const company = parseCompany(req);
    if (company) {
      const companyEmployees = companyContext.filterEmployeesByCompany(
        store.getEmployees({ hideOut: false }),
        company
      );
      const companyEmployeeIds = new Set(companyEmployees.map((e) => e.id));
      res.json({ requests: requests.filter((r) => companyEmployeeIds.has(r.employeeId)) });
      return;
    }
    res.json({ requests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/it-requests", async (req, res) => {
  if (!roles.canSubmitItRequest(req.userRole)) return res.status(403).json({ error: "Access denied" });
  const { employeeId, title, description, category, urgency, scope } = req.body;
  if (!employeeId) return res.status(400).json({ error: "employeeId is required" });
  const trimmedTitle = String(title || "").trim();
  const trimmedDesc = String(description || "").trim();
  const fallbackTitle = trimmedDesc.split(/\s+/).slice(0, 6).join(" ") || `IT request from ${employeeId}`;
  try {
    const emp = store.getEmployeeById(employeeId);
    if (!emp) return res.status(400).json({ error: "Employee not found" });
    if (!assertEmployeeInCompanyContext(emp, req)) {
      return res.status(403).json({ error: "Employee not in company context" });
    }
    const selfId = req.userRole?.employeeId || "";
    if (employeeId !== selfId && !roles.canSubmitItOnBehalf(req.userRole, emp)) {
      return res.status(403).json({ error: "Not allowed to submit IT request for this employee" });
    }
    const request = await itRequestsRepo.createItRequest({
      employeeId,
      title: trimmedTitle || fallbackTitle,
      description: trimmedDesc,
      category: category || "other",
      urgency: urgency || "normal",
      createdBy: req.username,
      scope: scope || [],
      unit: emp?.unit || "",
    });
    const dispatch = require("../lib/notify-dispatch");
    const notifyTitle = trimmedTitle || fallbackTitle;
    const company = companyContext.getCompanyForUnit(emp?.unit);
    await dispatch.dispatchNotification({
      actionKey: "it_request_submitted",
      type: "it_request_submitted",
      title: "IT request submitted",
      body: `${notifyTitle} — from ${employeeId}`,
      entityType: "it_request",
      entityId: request.id,
      actor: req.username,
      context: { company },
    }).catch(() => {});
    try {
      const notifyStore = require('../lib/notify-store');
      const itUsers = await itRequestsRepo.readItUsers({ unit: emp?.unit || '' });
      const companyEmpIds = new Set(
        companyContext
          .filterEmployeesByCompany(store.getEmployees({ hideOut: false }), company)
          .map((e) => e.id)
      );
      const itUsernames = (itUsers || [])
        .filter((u) => !u.employeeId || companyEmpIds.has(u.employeeId))
        .map((u) => u.username)
        .filter(Boolean);
      if (itUsernames.length) {
        await notifyStore.createNotificationsForUsers(itUsernames, {
          type: 'it_request_submitted',
          title: `New IT request: ${notifyTitle}`,
          body: `${notifyTitle} — from ${employeeId}`,
          entityType: 'it_request',
          entityId: request.id,
          actor: req.username,
        }).catch(() => {});
      }
    } catch (e) {
      // non-fatal
    }
    res.json({ ok: true, request });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete IT request — Admin, CEO, or users with the IT Access (is_it) flag
router.delete('/it-requests/:id', async (req, res) => {
  if (!roles.canDeleteItRequest(req.userRole)) {
    return res.status(403).json({ error: 'Only Admin, CEO, or IT-flagged staff may delete requests' });
  }
  try {
    const existing = await itRequestsRepo.readItRequestById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Request not found" });
    const emp = store.getEmployeeById(existing.employeeId);
    if (!emp || !assertEmployeeInCompanyContext(emp, req)) {
      return res.status(404).json({ error: "Request not found" });
    }
    await itRequestsRepo.deleteItRequest(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch("/it-requests/:id", async (req, res) => {
  if (!roles.canViewItRequests(req.userRole)) return res.status(403).json({ error: "Access denied" });
  const {
    status, assignedTo, resolutionNotes, notesHiddenFromRequester,
    // routing actions
    action, denialReason,
  } = req.body;
  try {
    const existing = await itRequestsRepo.readItRequestById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Request not found" });
    const ticketEmp = store.getEmployeeById(existing.employeeId);
    if (!ticketEmp || !assertEmployeeInCompanyContext(ticketEmp, req)) {
      return res.status(404).json({ error: "Request not found" });
    }
    const ticketCompany = companyContext.getCompanyForUnit(ticketEmp.unit);

    const patch = {};
    let notifyAction = null;

    // Allow editing title/category/urgency by the requester or assigners
    if (req.body.title !== undefined || req.body.category !== undefined || req.body.urgency !== undefined) {
      const isOwner = req.userRole?.employeeId && existing.employeeId === req.userRole.employeeId;
      if (!isOwner && !roles.canAssignItRequest(req.userRole)) {
        return res.status(403).json({ error: 'No permission to edit ticket' });
      }
      if (req.body.title !== undefined) patch.title = String(req.body.title || '').trim();
      if (req.body.category !== undefined) patch.category = req.body.category;
      if (req.body.urgency !== undefined) patch.urgency = req.body.urgency;
    }

    // ── Approve ──────────────────────────────────────────────
    if (action === "approve") {
      if (!roles.canAssignItRequest(req.userRole)) {
        return res.status(403).json({ error: "No permission to approve IT requests" });
      }
      patch.status = "in_progress";
      patch.approvedBy = req.username;
      notifyAction = "it_request_approved";
    }
    // ── Deny ─────────────────────────────────────────────────
    else if (action === "deny") {
      if (!roles.canAssignItRequest(req.userRole)) {
        return res.status(403).json({ error: "No permission to deny IT requests" });
      }
      patch.status = "closed";
      patch.deniedBy = req.username;
      patch.denialReason = denialReason || "";
      notifyAction = "it_request_denied";
    }
    // ── Reassign ──────────────────────────────────────────────
    else if (action === "reassign") {
      if (!roles.canAssignItRequest(req.userRole)) {
        return res.status(403).json({ error: "No permission to reassign IT requests" });
      }
      if (assignedTo === undefined) {
        return res.status(400).json({ error: "assignedTo required for reassign" });
      }
      patch.assignedTo = assignedTo;
      patch.reassignedBy = req.username;
      notifyAction = "it_request_reassigned";
    }
    // ── Assign ────────────────────────────────────────────────
    else if (assignedTo !== undefined) {
      if (!roles.canAssignItRequest(req.userRole)) {
        return res.status(403).json({ error: "No permission to assign IT requests" });
      }
      patch.assignedTo = assignedTo;
      notifyAction = "it_request_assigned";
    }
    // ── Resolve / Close ───────────────────────────────────────
    else if (status === "resolved" || status === "closed") {
      if (!roles.canResolveItRequest(req.userRole)) {
        return res.status(403).json({ error: "No permission to resolve IT requests" });
      }
      patch.status = status;
      if (resolutionNotes !== undefined) patch.resolutionNotes = resolutionNotes;
      notifyAction = "it_request_resolved";
    }
    // ── General status / notes ────────────────────────────────
    else {
      if (status) {
        if (!roles.canAssignItRequest(req.userRole)) {
          return res.status(403).json({ error: "No permission to change status" });
        }
        patch.status = status;
      }
      if (resolutionNotes !== undefined) patch.resolutionNotes = resolutionNotes;
      if (notesHiddenFromRequester !== undefined) patch.notesHiddenFromRequester = notesHiddenFromRequester;
    }

    const request = await itRequestsRepo.updateItRequest(req.params.id, patch);

    if (notifyAction) {
      const dispatch = require("../lib/notify-dispatch");
      await dispatch.dispatchNotification({
        actionKey: notifyAction,
        type: notifyAction,
        title: `IT request ${notifyAction.replace("it_request_", "").replace(/_/g, " ")}`,
        body: request.title,
        entityType: "it_request",
        entityId: request.id,
        actor: req.username,
        context: { company: ticketCompany },
      }).catch(() => {});

      // Also notify the original requester for approve/deny/resolve
      if (["it_request_approved", "it_request_denied", "it_request_resolved"].includes(notifyAction)) {
        const notifyRouting = require("../lib/notify-routing");
        const notifyStore = require("../lib/notify-store");
        const requesterUsers = await notifyRouting.resolveUsernamesForEmployees([request.employeeId]);
        if (requesterUsers.length) {
          await notifyStore.createNotificationsForUsers(requesterUsers, {
            type: notifyAction,
            title: `Your IT request was ${notifyAction.replace("it_request_", "")}`,
            body: request.title,
            entityType: "it_request",
            entityId: request.id,
          }).catch(() => {});
        }
      }
    }

    res.json({ ok: true, request });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const meetingRequestsRepo = require("../lib/meeting-requests-repo");

/**
 * Validate meeting participant scopes against the requester's role.
 * TL → only their own lead teams.
 * OP → any team or unit inside their unit.
 * HR/Admin/CEO → any.
 * Returns { ok, error } or { ok: true, participants: [...] }
 */
function validateMeetingParticipants(participants, userRole) {
  const role = userRole?.role || "";
  const isHrAdmin = ["hr", "admin", "ceo"].includes(role);
  const isOp = role === "op";
  const isTl = role === "tl";

  for (const p of participants || []) {
    const ps = String(p || "");
    if (ps.startsWith("unit:")) {
      // unit-wide — OP and above only
      if (!isOp && !isHrAdmin) return { ok: false, error: "Only OP/HR/Admin can select whole unit as participants" };
    } else if (ps.startsWith("team:")) {
      if (isTl) {
        // TL may only choose their own lead teams
        const raw = ps.slice("team:".length);
        const [u, t] = raw.split("|");
        const leadTeams = userRole?.leadTeams || [];
        const allowed = leadTeams.some(
          (lt) => (!u || lt.unit === u) && (!t || lt.team === t)
        );
        if (!allowed) return { ok: false, error: "TL can only select their own team" };
      }
      // OP and above can select any team — no restriction
    }
    // employee: prefix — individual; always allowed
  }
  return { ok: true };
}

router.get("/meeting-requests", async (req, res) => {
  const canView = roles.canViewMeetingRequests(req.userRole);
  const canSubmit = roles.canSubmitMeetingRequest(req.userRole);
  if (!canView && !canSubmit) return res.status(403).json({ error: "Access denied" });
  try {
    const filters = {};
    if (req.query.status) filters.status = req.query.status.split(",");
    // Non-reviewers (agents, TL, OP who don't have review permission) only see meetings
    // where they are the requester OR listed as a participant.
    if (!roles.canReviewMeetingRequest(req.userRole) && req.userRole?.employeeId) {
      filters.participantEmployeeId = req.userRole.employeeId;
    }
    if (req.query.mine === "true" && req.userRole?.employeeId) filters.requesterEmployeeId = req.userRole.employeeId;
    const requests = await meetingRequestsRepo.readMeetingRequests(filters);
    // Apply company context filter — only show meetings where requester is in current company
    const company = parseCompany(req);
    if (company) {
      const companyEmployees = companyContext.filterEmployeesByCompany(
        store.getEmployees({ hideOut: false }),
        company
      );
      const companyEmployeeIds = new Set(companyEmployees.map((e) => e.id));
      res.json({ requests: requests.filter((r) => companyEmployeeIds.has(r.requesterEmployeeId)) });
      return;
    }
    res.json({ requests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/meeting-requests", async (req, res) => {
  if (!roles.canSubmitMeetingRequest(req.userRole)) return res.status(403).json({ error: "Access denied" });
  const { title, description, proposedDate, proposedTime, durationMinutes, requesterEmployeeId, requesterRole, participants } = req.body;
  if (!title || !proposedDate || !proposedTime || !requesterEmployeeId) {
    return res.status(400).json({ error: "title, proposedDate, proposedTime, requesterEmployeeId required" });
  }
  if (!participants || !Array.isArray(participants) || participants.length === 0) {
    return res.status(400).json({ error: "At least one participant (employee, team, or unit) is required" });
  }
  const pCheck = validateMeetingParticipants(participants, req.userRole);
  if (!pCheck.ok) return res.status(403).json({ error: pCheck.error });
  try {
    const requester = store.getEmployeeById(requesterEmployeeId);
    if (!requester) return res.status(400).json({ error: "Requester not found" });
    if (!assertEmployeeInCompanyContext(requester, req)) {
      return res.status(403).json({ error: "Requester not in company context" });
    }
    const company = companyContext.getCompanyForUnit(requester.unit);
    const request = await meetingRequestsRepo.createMeetingRequest({
      title, description, proposedDate, proposedTime,
      durationMinutes: durationMinutes || 30,
      requesterEmployeeId, requesterRole: requesterRole || "",
      participants,
    });
    const dispatch = require("../lib/notify-dispatch");
    await dispatch.dispatchNotification({
      actionKey: "meeting_request_submitted",
      type: "meeting_request_submitted",
      title: "Meeting request submitted",
      body: `${title} — ${proposedDate} ${proposedTime}`,
      entityType: "meeting_request",
      entityId: request.id,
      actor: req.username,
      context: { company },
    }).catch(() => {});
    res.json({ ok: true, request });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch("/meeting-requests/:id", async (req, res) => {
  if (!roles.canViewMeetingRequests(req.userRole)) return res.status(403).json({ error: "Access denied" });
  const { status, reviewNotes, proposedDate, proposedTime, durationMinutes, participants } = req.body;
  try {
    const existingMeeting = await meetingRequestsRepo.readMeetingRequestById(req.params.id);
    if (!existingMeeting) return res.status(404).json({ error: "Request not found" });
    const requester = store.getEmployeeById(existingMeeting.requesterEmployeeId);
    if (!requester || !assertEmployeeInCompanyContext(requester, req)) {
      return res.status(404).json({ error: "Request not found" });
    }
    const company = companyContext.getCompanyForUnit(requester.unit);
    if (status && !roles.canReviewMeetingRequest(req.userRole)) {
      return res.status(403).json({ error: "Cannot review meeting requests" });
    }
    if (participants !== undefined) {
      const pCheck = validateMeetingParticipants(participants, req.userRole);
      if (!pCheck.ok) return res.status(403).json({ error: pCheck.error });
    }
    const patch = {};
    if (status) { patch.status = status; patch.reviewedBy = req.username; }
    if (reviewNotes !== undefined) patch.reviewNotes = reviewNotes;
    if (proposedDate) patch.proposedDate = proposedDate;
    if (proposedTime) patch.proposedTime = proposedTime;
    if (durationMinutes != null) patch.durationMinutes = durationMinutes;
    if (participants !== undefined) patch.participants = participants;
    const request = await meetingRequestsRepo.updateMeetingRequest(req.params.id, patch);

    if (status) {
      const dispatch = require("../lib/notify-dispatch");
      await dispatch.dispatchNotification({
        actionKey: "meeting_request_reviewed",
        type: "meeting_request_reviewed",
        title: `Meeting request ${status}`,
        body: request.title,
        entityType: "meeting_request",
        entityId: request.id,
        actor: req.username,
        context: { company },
      }).catch(() => {});
      const notifyRouting = require("../lib/notify-routing");
      const notifyStore = require("../lib/notify-store");
      const requesterUsers = await notifyRouting.resolveUsernamesForEmployees([request.requesterEmployeeId]);
      if (requesterUsers.length) {
        await notifyStore.createNotificationsForUsers(requesterUsers, {
          type: "meeting_request_reviewed",
          title: `Your meeting request was ${status}`,
          body: request.title,
          entityType: "meeting_request",
          entityId: request.id,
        }).catch(() => {});
      }
    }
    res.json({ ok: true, request });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.use("/auth", require("./auth-routes"));

// ─── Companies (multi-company settings) ──────────────────────────────────────
// NOTE: companiesRepo is required at top of file (line ~40); routes at bottom of file.

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

const { TEAM_OPTIONS, CASH_BRANCHES, PAYMENT_METHOD_OPTIONS, PAYMENT_METHOD_FILTER_OPTIONS, TL_BONUS_TYPE, normalizePaymentMethodValue } = require("../lib/hr-constants");

router.get("/meta/teams", async (req, res) => {
  const unit = req.query.unit || "";
  let fromOrg = [];
  try {
    const hrmsRepo = require("../lib/hrms-repo");
    const orgTeams = await hrmsRepo.readOrgTeams();
    fromOrg = unit
      ? orgTeams.filter((t) => t.unit === unit).map((t) => t.name)
      : orgTeams.map((t) => t.name);
  } catch {
    fromOrg = unit ? store.getTeams(unit) : [];
  }
  const teams = [...new Set(fromOrg.filter(Boolean))].sort();
  const company = parseCompany(req);
  const isHs2User = company === "hs2";
  res.json({
    teams: isHs2User ? teams : roles.canManageHs2Company(req.userRole) ? teams : teams.filter((t) => !companyContext.isHs2Team(t)),
    units: companyContext.filterUnitsListForRole(store.getUnits(), req.userRole),
    cashBranches: CASH_BRANCHES,
    paymentMethods: PAYMENT_METHOD_OPTIONS,
  });
});

router.get("/employees/next-id", (req, res) => {
  const { unit, backendPool, leadRole } = req.query;
  if (leadRole) {
    const role = String(leadRole).toUpperCase();
    if (role === "AGENT") {
      if (!unit) return res.status(400).json({ error: "unit required for Agent role" });
      if (!unitInCompanyContext(String(unit), req)) {
        return res.status(403).json({ error: "Unit not in company context" });
      }
      return res.json({ suggestedId: store.suggestNextId(unit, backendPool) });
    }
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
  if (!unitInCompanyContext(String(unit), req)) {
    return res.status(403).json({ error: "Unit not in company context" });
  }
  res.json({ suggestedId: store.suggestNextId(unit, backendPool) });
});

router.get("/employees/available-ids", (req, res) => {
  if (!roles.canManageEmployees(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const unit = String(req.query.unit || "").trim();
  if (!unit) return res.status(400).json({ error: "unit required" });
  if (!unitInCompanyContext(unit, req)) {
    return res.status(403).json({ error: "Unit not in company context" });
  }
  const backendPool = req.query.backendPool || null;
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const idGen = require("../lib/id-generator");
  const employees = store.getEmployees({ hideOut: false, includeDeleted: true });
  res.json({ unit, ids: idGen.listAvailableIds(employees, unit, backendPool, limit) });
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

router.get("/employees", async (req, res) => {
  const hideOut = parseHideOut(req);
  const showLegacyEmployees = parseShowLegacy(req);
  const month = req.query.month || roles.localYearMonth();
  const companyContext = require("../lib/company-context");
  const employeePrivacy = require("../lib/employee-privacy");
  const company = parseCompany(req);
  const scopedAll = roles.filterEmployeesForUser(
    companyContext.filterEmployeesByCompany(store.getEmployees({ hideOut: false }), company),
    req.userRole
  );
  let employees = store.getEmployeesForMonth(month, { hideOut, showLegacyEmployees });
  employees = companyContext.filterEmployeesByCompany(employees, company);
  employees = roles.filterEmployeesForUser(employees, req.userRole);
  employees = require("../lib/employee-app-role").enrichEmployeesWithAppRole(employees);
  employees = employeePrivacy.sanitizeEmployees(employees, req.userRole);
  if (roles.canViewEmployeeNotes(req.userRole)) {
    employees = employees.map((e) => ({
      ...e,
      hasWarnings: store.getEmployeeWarnings(e.id).length > 0,
    }));
  }
  const units = companyContext.filterUnitsListForRole(store.getUnits(), req.userRole);
  const positions = [
    ...new Set(employees.map((e) => e.position).filter(Boolean)),
  ].sort();
  const teams = [
    ...new Set(employees.map((e) => e.team).filter(Boolean)),
  ].sort();
  const paymentMethods = PAYMENT_METHOD_FILTER_OPTIONS;
  const fpStatuses = [
    ...new Set(employees.map((e) => (e.fp_number ? "has_fp" : "no_fp"))),
  ].sort();
  const positionRates = store.getPositionRates().map((r) => r.position);
  res.json({
    employees,
    units,
    positions,
    teams,
    paymentMethods,
    fpStatuses,
    positionRates: [...new Set(positionRates)].filter(Boolean).sort(),
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
  if (!assertEmployeeInCompanyContext(emp, req)) {
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
  const company = parseCompany(req);
  const stubs = companyContext
    .filterEmployeesByCompany(store.findEmptyEmployeeStubs(), company)
    .map((e) => ({ id: e.id, unit: e.unit, team: e.team, status: e.status }));
  res.json({ stubs, company });
});

router.delete("/employees/empty-stubs", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  try {
    const company = parseCompany(req);
    const scopedIds = new Set(
      companyContext.filterEmployeesByCompany(store.findEmptyEmployeeStubs(), company).map((e) => e.id)
    );
    const result = await store.deleteEmptyEmployeeStubs(req.username, scopedIds);
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
  if (!roles.canOpenEmployeeCard(req.userRole, emp)) {
    return res.status(403).json({ error: "Not allowed" });
  }
  const employeePrivacy = require("../lib/employee-privacy");
  res.json({ employee: employeePrivacy.sanitizeEmployee(emp, req.userRole) });
});

router.post("/employees", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  try {
    const body = { ...req.body };
    const company = parseCompany(req);
    const preview = { id: body.id, unit: body.unit, team: body.team };
    if (!companyContext.employeeInCompanyContext(preview, company)) {
      return res.status(403).json({ error: "Employee not in current company context" });
    }
    try {
      await require("../lib/employee-unit-team").assertEmployeeUnitTeam({
        unit: body.unit,
        team: body.team,
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (body.inTraining && !body.position) body.position = "Trainee";
    const emp = await store.createEmployee(body, req.username);
    if (req.body.inTraining && req.body.phase1Start) {
      try {
        const trainingPhases = require("../lib/training-phases");
        await trainingPhases.createProgram(emp.id, req.body.phase1Start, req.username);
      } catch (err) {
        console.warn(`training program create failed for ${emp.id}:`, err.message);
      }
    }
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
    const old = store.getEmployeeById(req.params.id);
    if (!old) return res.status(404).json({ error: "Employee not found" });
    if (!assertEmployeeInCompanyContext(old, req)) {
      return res.status(403).json({ error: "Employee not in current company context" });
    }
    const nextUnit = req.body?.unit != null ? req.body.unit : old.unit;
    const nextTeam = req.body?.team != null ? req.body.team : old.team;
    const nextCompany = companyContext.getCompanyForUnit(nextUnit);
    const oldCompany = companyContext.getCompanyForUnit(old.unit);
    if (nextCompany !== oldCompany && !roles.canManageHs2Company(req.userRole)) {
      return res.status(403).json({ error: "Cannot move employees between companies" });
    }
    try {
      await require("../lib/employee-unit-team").assertEmployeeUnitTeam({
        unit: nextUnit,
        team: nextTeam,
        previousUnit: old.unit,
        previousTeam: old.team,
        requireTeamOnCompanyChange: nextCompany !== oldCompany,
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const emp = await store.updateEmployee(req.params.id, req.body, req.username);
    const { isOutStatus } = require("../lib/employee-status");
    const employeeDepart = require("../lib/employee-depart");
    const { parseIsoDate } = require("../lib/date-iso");
    const oldDepart = parseIsoDate(old?.depart_date);
    const newDepart = parseIsoDate(emp?.depart_date);
    if (newDepart && newDepart !== oldDepart && isOutStatus(emp?.status)) {
      try {
        if (useSupabase()) {
          await hrms.closeEmploymentPeriod(req.params.id, newDepart, req.username);
        }
        await employeeDepart.persistDepartAutoOut(req.params.id, newDepart, store, req.username);
      } catch (syncErr) {
        console.warn("[api] depart sync on employee update failed:", syncErr.message);
      }
    }
    const loginSync = require("../lib/employee-login-sync");
    if (loginSync.shouldDisableLoginForEmployee(emp)) {
      try {
        await loginSync.disableLoginForDepartedEmployee(emp.id, req.username);
      } catch (e) {
        console.warn("[api] disable login on employee update failed:", e.message);
      }
    }
    res.json({ ok: true, employee: emp });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch("/employees/:id/status", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  if (!requireEmployeeInContext(req, res, req.params.id)) return;
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: "Status required" });
  try {
    if (String(status).trim() === "Deleted") {
      const result = await store.releaseEmployeeAppId(req.params.id, req.username);
      await store.refreshCache();
      return res.json({ ok: true, ...result });
    }
    const { isOutStatus } = require("../lib/employee-status");
    const { parseIsoDate } = require("../lib/date-iso");
    if (isOutStatus(status)) {
      const emp = store.getEmployeeById(req.params.id);
      const depart = parseIsoDate(emp?.depart_date);
      if (!depart) {
        return res.status(400).json({
          error: "Out status requires a depart date. Use Mark depart in the employee lifecycle panel.",
        });
      }
    }
    const emp = await store.updateEmployee(req.params.id, { status }, req.username);
    const loginSync = require("../lib/employee-login-sync");
    if (loginSync.shouldDisableLoginForEmployee(emp) || loginSync.isOutStatus(status)) {
      try {
        await loginSync.disableLoginForDepartedEmployee(emp.id, req.username);
      } catch (e) {
        console.warn("[api] disable login on status change failed:", e.message);
      }
    }
    res.json({ ok: true, employee: emp });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/employees/:id/promote", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  if (!requireEmployeeInContext(req, res, req.params.id)) return;
  const { newId, leadRole, effectiveFromMonth, position, team, enforcePrefix } = req.body;
  if (!newId) return res.status(400).json({ error: "newId required (e.g. TL04, CL02, OP01)" });
  try {
    const result = await store.promoteEmployee(
      req.params.id,
      { newId, leadRole, effectiveFromMonth, position, team, enforcePrefix },
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
  if (!requireEmployeeInContext(req, res, req.params.id)) return;
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
  if (!requireEmployeeInContext(req, res, req.params.id)) return;
  const newId = String(req.body?.newId || "").trim();
  if (!newId) return res.status(400).json({ error: "newId required" });
  const enforcePrefix = req.body?.enforcePrefix !== false;
  try {
    const result = await store.changeEmployeeAppId(req.params.id, newId, req.username, { enforcePrefix });
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
  if (!requireEmployeeInContext(req, res, req.params.id)) return;
  try {
    const result = await store.releaseEmployeeAppId(req.params.id, req.username);
    await store.refreshCache();
    res.json({
      ok: true,
      ...result,
      employees: store.getEmployees({ hideOut: false, includeDeleted: true }),
    });
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
  if (!assertEmployeeInCompanyContext(emp, req)) {
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
  if (!assertEmployeeInCompanyContext(emp, req)) {
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
  const showLegacyEmployees = parseShowLegacy(req);

  const config = store.getConfig();
  let records = await store.readAttendanceEventsForMonth(month);

  let employees = store.getEmployeesForMonth(month, { hideOut, showLegacyEmployees, attendanceRecords: records });
  employees = filterEmployeesForRequest(employees, req);
  if (unit) employees = employees.filter((e) => e.unit === unit);
  if (team) employees = employees.filter((e) => e.team === team);
  employees = employees.map((e) => normalizeEmployeeDepart(e));
  employees = employees.filter(
    (e) =>
      e.american_name ||
      e.arabic_name ||
      isPayrollEligible(e) ||
      !idGen.isOutEmployee(e)
  );

  records = buildMonthSkeleton(employees, month, records);
  records = applyDepartAutoOutForMonth(employees, records, month);

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
    holidays = useSupabase() ? await hrms.readPublicHolidays({ company: parseCompany(req) }) : [];
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

  const periodsByEmployee = new Map();
  if (useSupabase()) {
    await Promise.all(
      employees.map(async (e) => {
        try {
          periodsByEmployee.set(e.id, await hrms.getEmploymentPeriods(e.id));
        } catch {
          periodsByEmployee.set(e.id, []);
        }
      })
    );
  }

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
      employment_date: e.employment_date || "",
      depart_date: e.depart_date || "",
      lock_after: attendanceLockEnd(e, periodsByEmployee.get(e.id) || []) || "",
      profile_photo_file_id: e.profile_photo_file_id || "",
      profile_photo_updated: e.profile_photo_updated || "",
    })),
    workingDays,
    teams,
    units: companyContext.filterUnitsListForRole(store.getUnits(), req.userRole),
    statuses: roles.canUseNullAttendanceStatus(req.userRole)
      ? ATTENDANCE_STATUSES
      : ATTENDANCE_STATUSES.filter((s) => s !== "(--)"),
    canEdit: roles.canEditAttendance(req.userRole),
    hideOutEmployees: hideOut,
    holidays: monthHolidays,
    workingDaysNote,
    payrollMonthLocked: useSupabase()
      ? Boolean(await hrms.getPayrollMonthLock(month, parseCompany(req)))
      : false,
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
  if (!assertEmployeeInCompanyContext(emp, req)) {
    return res.status(403).json({ error: "No access to this unit" });
  }

  if (status === "(--)" && roles.canUseNullAttendanceStatus(req.userRole)) {
    await store.deleteAttendanceBatch([{ employeeId, date }], req.username);
    return res.json({ ok: true, deleted: true });
  }

  try {
    await assertMonthNotLocked(String(date).slice(0, 7), req);
    await assertCanEditAttendanceDate(employeeId, date);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const periods = useSupabase() ? await hrms.getEmploymentPeriods(employeeId) : [];
  if (isLockedDepartDay(emp, date, periods) && !isDepartDay(emp, date)) {
    return res.status(400).json({ error: "Days after depart date are locked as OUT." });
  }

  const month = String(date).slice(0, 7);
  const existing =
    store.getAttendanceEvents(month)?.find((r) => r.employeeId === employeeId && r.date === date) ||
    null;
  let record = {
    employeeId,
    date,
    status: status || "Attended",
    fpLateness: fpLateness || null,
    isWeekendDefault: isWeekend(date) && status === "Day-OFF",
    transportOverride:
      roles.canViewTransportControls(req.userRole) && req.body.transportOverride
        ? req.body.transportOverride
        : "",
  };
  if (hasExplicitManualStatus(record.status)) {
    record = applyManualAttendanceOverride(record, existing);
  }

  const employeeDepart = require("../lib/employee-depart");
  let departSync = null;
  if (employeeDepart.isOutAttendanceStatus(record.status) && req.body.confirmDepart === true) {
    departSync = await employeeDepart.syncDepartFromAttendanceOut(
      employeeId,
      date,
      store.getEmployeeById(employeeId) || emp,
      req.username,
      store,
      record.status,
      { notice_type: req.body.notice_type }
    );
  }

  const saved = await store.saveAttendanceRow(record, req.username);
  res.json({ ok: true, record: saved, departSync });
});

router.post("/attendance/batch", async (req, res) => {
  if (!roles.canEditAttendance(req.userRole)) {
    return res.status(403).json({ error: "No permission to edit attendance" });
  }
  const { records } = req.body;
  if (!Array.isArray(records) || !records.length) {
    return res.status(400).json({ error: "records array required" });
  }

  console.log("[attendance-debug] batch route received", { user: req.username, records });
  const normalized = [];
  const skippedRecords = [];
  const deleteRecords = [];
  const existingByMonth = new Map();
  const periodsByEmployee = new Map();
  const loadPeriods = async (employeeId) => {
    if (!useSupabase()) return [];
    if (!periodsByEmployee.has(employeeId)) {
      periodsByEmployee.set(employeeId, await hrms.getEmploymentPeriods(employeeId));
    }
    return periodsByEmployee.get(employeeId);
  };
  for (const r of records) {
    const emp = store.getEmployeeById(r.employeeId);
    if (!emp) {
      skippedRecords.push({ employeeId: r.employeeId, date: r.date, reason: "employee_not_found" });
      continue;
    }
    if (!assertEmployeeInCompanyContext(emp, req)) {
      skippedRecords.push({ employeeId: r.employeeId, date: r.date, reason: "access_denied" });
      continue;
    }
    try {
      await assertMonthNotLocked(String(r.date).slice(0, 7), req);
    } catch (err) {
      skippedRecords.push({ employeeId: r.employeeId, date: r.date, reason: err.message || "locked" });
      continue;
    }

    const month = String(r.date || "").slice(0, 7);
    let existingMap = existingByMonth.get(month);
    if (!existingMap) {
      const existingRows = (store.getAttendanceEvents(month) || []).filter((row) => row.employeeId === r.employeeId);
      existingMap = new Map(existingRows.map((row) => [`${row.employeeId}|${row.date}`, row]));
      existingByMonth.set(month, existingMap);
    }
    const existing = existingMap.get(`${r.employeeId}|${r.date}`);

    // Handle null status (--) - delete the record
    if (r.status === "(--)" && roles.canUseNullAttendanceStatus(req.userRole)) {
      deleteRecords.push({ employeeId: r.employeeId, date: r.date, existing });
      continue;
    }

    try {
      await assertCanEditAttendanceDate(r.employeeId, r.date);
    } catch (err) {
      skippedRecords.push({ employeeId: r.employeeId, date: r.date, reason: err.message || "locked" });
      continue;
    }

    const periods = await loadPeriods(r.employeeId);
    if (isLockedDepartDay(emp, r.date, periods) && !isDepartDay(emp, r.date)) {
      skippedRecords.push({
        employeeId: r.employeeId,
        date: r.date,
        reason: "Days after depart date are locked as OUT.",
      });
      continue;
    }
    
    const allowBlankClear = Boolean(roles.canManageEmployees(req.userRole)) && !String(r.status || "").trim();
    const explicitStatus = String(r.status || "").trim();
    const normalizedRecord = {
      employeeId: r.employeeId,
      date: r.date,
      status: r.status || "",
      fpLateness: r.fpLateness || null,
      fpNotes: r.fpNotes || "",
      leaveNote: r.leaveNote || r.fpNotes || "",
      isWeekendDefault: isWeekend(r.date) && r.status === "Day-OFF",
      transportOverride:
        roles.canViewTransportControls(req.userRole) && r.transportOverride
          ? r.transportOverride
          : "",
    };
    // Manual status always wins over FP metadata on the same day.
    if (hasExplicitManualStatus(explicitStatus)) {
      normalizedRecord.fpNotes = "";
      normalizedRecord.fpLateness =
        explicitStatus === "Lateness A" || explicitStatus === "Lateness B"
          ? r.fpLateness || null
          : null;
      if (!String(r.leaveNote || "").trim()) {
        normalizedRecord.leaveNote = "";
      }
    } else if (!normalizedRecord.status && existing?.status && !allowBlankClear) {
      normalizedRecord.status = existing.status;
      if (!normalizedRecord.transportOverride && existing.transportOverride) {
        normalizedRecord.transportOverride = existing.transportOverride;
      }
      if (normalizedRecord.fpLateness == null && existing.fpLateness != null) {
        normalizedRecord.fpLateness = existing.fpLateness;
      }
      if (!normalizedRecord.fpNotes && existing.fpNotes) {
        normalizedRecord.fpNotes = existing.fpNotes;
      }
      if (!normalizedRecord.leaveNote && existing.leaveNote) {
        normalizedRecord.leaveNote = existing.leaveNote;
      }
    }
    normalized.push({ ...normalizedRecord, __allowBlankClear: allowBlankClear, confirmDepart: r.confirmDepart === true });
  }

  const normalizedForSave = normalized.map(({ __allowBlankClear, confirmDepart, ...record }) =>
    normalizeAttendanceRecord(record, { allowBlankClear: __allowBlankClear })
  );

  const employeeDepart = require("../lib/employee-depart");
  const departSync = await employeeDepart.syncDepartFromAttendanceBatch(
    normalized.map(({ __allowBlankClear, confirmDepart, ...record }) => ({ ...record, confirmDepart })),
    req.username,
    store
  );
  
  // Delete records with null status (--)
  let deleteCount = 0;
  if (deleteRecords.length) {
    const recordsToDelete = deleteRecords.filter(r => r.existing).map(r => ({ employeeId: r.employeeId, date: r.date }));
    if (recordsToDelete.length) {
      deleteCount = await store.deleteAttendanceBatch(recordsToDelete, req.username);
    }
  }
  
  const saveCount = await store.saveAttendanceBatch(normalizedForSave, req.username);
  const count = saveCount + deleteCount;
  const savedFromCache = normalizedForSave.map((r) => {
    const ym = String(r.date || "").slice(0, 7);
    return (
      store.getAttendanceEvents(ym)?.find(
        (row) => row.employeeId === r.employeeId && row.date === r.date
      ) || r
    );
  });
  // Return the actually-saved records so the client can reconcile its in-memory
  // state with what the server persisted (e.g. a blank status that was silently
  // kept as the prior value because the user lacks canManageEmployees).
  // Also return skipped records so the client can show an error for access-denied saves.
  res.json({ ok: true, count, saved: savedFromCache, skipped: skippedRecords, departSync });
});

// Live sync (SSE). Pushes realtime Postgres changes on attendance_events and
// payroll_adjustments to every connected client so edits by one user appear on
// all screens immediately (shared "Google Sheet" behaviour).
router.get("/live/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");
  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, clients: liveSync.clientCount() })}\n\n`);
  liveSync.addClient(res);
  const hb = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { /* closed */ }
  }, 25000);
  req.on("close", () => {
    clearInterval(hb);
    liveSync.removeClient(res);
  });
});

router.get("/attendance/fp-rules/:month", async (req, res) => {
  if (!roles.canEditAttendance(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  const fpImport = require("../lib/attendance-fp-import");
  const company = parseCompany(req);
  const config = store.getConfigForCompany(company);
  const rules = fpImport.getRulesForMonth(config, req.params.month);
  res.json({ month: req.params.month, rules, defaults: fpImport.DEFAULT_FP_RULES, company });
});

router.put("/attendance/fp-rules/:month", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const month = req.params.month;
  const company = parseCompany(req);
  const rules = await store.saveFpRulesForCompanyMonth(company, month, req.body.rules || req.body, req.username);
  res.json({ ok: true, month, rules, company });
});

router.post("/attendance/import", async (req, res) => {
  if (!roles.canEditAttendance(req.userRole)) {
    return res.status(403).json({ error: "No permission to import attendance" });
  }
  const { month, base64, fileName, dryRun, overwritePolicy } = req.body;
  if (!month || !base64) {
    return res.status(400).json({ error: "month and base64 required" });
  }
  try {
    await assertMonthNotLocked(month, req);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  try {
    const fpImport = require("../lib/attendance-fp-import");
    const company = parseCompany(req);
    const config = store.getConfigForCompany(company);
    const rules = fpImport.getRulesForMonth(config, month);
    const buffer = Buffer.from(base64, "base64");
    const existing = await store.readAttendanceEventsForMonth(month);
    const result = fpImport.processImport({
      buffer,
      employees: filterEmployeesForRequest(store.getEmployees(), req),
      rules,
      month,
      existingRecords: existing,
      overwritePolicy: overwritePolicy || "skip_manual",
    });
    if (!dryRun && result.records.length) {
      const count = await store.saveAttendanceBatch(result.records, req.username);
      result.rowsApplied = count;
      // FP import is self-cleaning: clear fpNotes/fpLateness so the imported
      // records become plain attendance rows that future imports will not touch.
      if (count) {
        try {
          const keys = result.records.map((r) => `${r.employeeId}|${r.date}`);
          const { data: toClean, error: cleanErr } = await getSupabaseAdmin()
            .from("attendance_events")
            .select("employee_id, date")
            .in("employee_id", [...new Set(result.records.map((r) => r.employeeId))])
            .gte("date", `${month}-01`)
            .lt("date", `${month}-32`);
          if (!cleanErr && toClean?.length) {
            const monthKeys = new Set(toClean.map((r) => `${r.employee_id}|${r.date}`));
            const affected = keys.filter((k) => monthKeys.has(k));
            if (affected.length) {
              await getSupabaseAdmin()
                .from("attendance_events")
                .update({
                  fp_notes: "",
                  fp_lateness: null,
                  updated_by: req.username,
                  updated_at: new Date().toISOString(),
                })
                .in(
                  "employee_id",
                  [...new Set(affected.map((k) => k.split("|")[0]))]
                )
                .gte("date", `${month}-01`)
                .lt("date", `${month}-32`);
            }
          }
        } catch {
          // best-effort cleanup; do not fail the import if cleanup fails
        }
      }
    }
    res.json({ ok: true, dryRun: Boolean(dryRun), ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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
    await assertMonthNotLocked(month, req);
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
      if (emp && assertEmployeeInCompanyContext(emp, req)) employees = [emp];
    }
  }
  const existing = store.getAttendanceEvents(month);
  const skeleton = buildMonthSkeleton(employees, month, existing);
  const weekendOnly = skeleton.filter((r) => r.isWeekendDefault);
  let count = await store.initMonthWeekends(weekendOnly, req.username);

  let holidays = [];
  try {
    holidays = useSupabase()
      ? await hrms.readPublicHolidays({ activeOnly: true, company: parseCompany(req) })
      : [];
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
    await assertMonthNotLocked(month, req);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const emp = store.getEmployeeById(employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!assertEmployeeInCompanyContext(emp, req)) {
    return res.status(403).json({ error: "No access to this employee" });
  }

  const validation = validateBulkAttendanceAgainstDepartDate([emp], month, status, req.username);
  if (!validation.allowed && !req.body.force) {
    return res.status(409).json({
      error: "depart_date_conflict",
      message: validation.message,
      conflicts: validation.conflicts,
    });
  }

  let holidays = [];
  try {
    holidays = useSupabase()
      ? await hrms.readPublicHolidays({ activeOnly: true, company: parseCompany(req) })
      : [];
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

  const validation = validateBulkAttendanceAgainstDepartDate(employees, month, status, req.username);
  if (!validation.allowed && !req.body.force) {
    return res.status(409).json({
      error: "depart_date_conflict",
      message: validation.message,
      conflicts: validation.conflicts,
    });
  }

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

router.patch("/attendance/bulk-reset", async (req, res) => {
  if (!roles.canEditAttendance(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  const { month, employeeId, unit, team, scope } = req.body;
  if (!month) {
    return res.status(400).json({ error: "month is required" });
  }
  try {
    await assertMonthNotLocked(month, req);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  let records = [];
  const hideOut = store.getConfig().hideOutEmployees !== false;

  if (scope === "agent") {
    if (!employeeId) {
      return res.status(400).json({ error: "employeeId is required for agent scope" });
    }
    const emp = store.getEmployeeById(employeeId);
    if (!emp) return res.status(404).json({ error: "Employee not found" });
    if (!assertEmployeeInCompanyContext(emp, req)) {
      return res.status(403).json({ error: "No access to this employee" });
    }
    records = store.getAttendanceEvents(month).filter((r) => r.employeeId === employeeId);
  } else if (scope === "unit") {
    if (!unit) {
      return res.status(400).json({ error: "unit is required for unit scope" });
    }
    let employees = store.getEmployees({ hideOut, unit });
    employees = filterEmployeesForRequest(employees, req);
    const empIds = new Set(employees.map((e) => e.id));
    records = store.getAttendanceEvents(month).filter((r) => empIds.has(r.employeeId));
  } else if (scope === "company") {
    let employees = store.getEmployees({ hideOut });
    employees = filterEmployeesForRequest(employees, req);
    const empIds = new Set(employees.map((e) => e.id));
    records = store.getAttendanceEvents(month).filter((r) => empIds.has(r.employeeId));
  } else {
    return res.status(400).json({ error: "Invalid scope. Use agent, unit, or company" });
  }

  const count = await store.deleteAttendanceBatch(records, req.username);
  res.json({ ok: true, count });
});

router.patch("/attendance/bulk-reset-month", async (req, res) => {
  if (!roles.canEditAttendance(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  const { month, employeeId } = req.body;
  if (!month || !employeeId) {
    return res.status(400).json({ error: "month and employeeId are required" });
  }
  try {
    await assertMonthNotLocked(month, req);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const emp = store.getEmployeeById(employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!assertEmployeeInCompanyContext(emp, req)) {
    return res.status(403).json({ error: "No access to this employee" });
  }

  const records = store.getAttendanceEvents(month).filter((r) => r.employeeId === employeeId);
  const count = await store.deleteAttendanceBatch(records, req.username);
  res.json({ ok: true, count });
});

router.get("/payroll", async (req, res) => {
  if (!roles.canViewPayroll(req.userRole)) {
    return res.status(403).json({ error: "No permission to view payroll" });
  }
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const unit = req.query.unit || "";

  // Serve local cache immediately when warm; refresh Supabase in the background.
  await store.refreshPayrollLiveInputs(month);

  const [bundle, monthLock] = await Promise.all([
    buildEnrichedPayrollForMonth(month, req, {
      unit,
      skipAttendanceRefresh: true,
    }),
    useSupabase() ? hrms.getPayrollMonthLock(month, parseCompany(req)) : Promise.resolve(null),
  ]);
  const { payroll, workingDays, commissionTiers, allPayrollSplits, employees } = bundle;

  const {
    TRAINING_MONTHLY_SALARY,
    TRAINING_DAYS_PER_MONTH,
    TRAINING_DAILY_RATE,
    TRAINING_WEEKLY_SALARY,
  } = require("../lib/training-pay-rules");
  const { buildPayrollViews } = require("../lib/training-payroll");
  const { buildTotalPaidView } = require("../lib/payroll-schedule");

  const hideOut = parseHideOut(req);
  const showLegacyEmployees = parseShowLegacy(req);
  const views = buildPayrollViews(payroll, { hideOut, month, showLegacyEmployees });
  const priorMonth = shiftMonth(month, -1);
  const includeTotalPaid = String(req.query.includeTotalPaid || "") === "true";
  let totalPaid = { rows: [], totals: { scheduled: 0, received: 0, net: 0 } };
  if (includeTotalPaid) {
    const priorBundle = await buildEnrichedPayrollForMonth(priorMonth, req, { unit });
    const programsByEmployee = await loadProgramsForEmployees(employees);
    totalPaid = buildTotalPaidView(
      month,
      { [month]: payroll, [priorMonth]: priorBundle.payroll },
      allPayrollSplits,
      programsByEmployee
    );
  }

  const scopedForMeta = filterEmployeesForRequest(store.getEmployees({ hideOut: false }), req);
  const units = [...new Set(scopedForMeta.map((e) => e.unit).filter(Boolean))].sort();
  const teams = [...new Set(scopedForMeta.map((e) => e.team).filter(Boolean))].sort();
  res.json({
    month,
    payroll,
    views: {
      agent: views.agent,
      training: views.training,
      totalPaid,
    },
    trainingPay: {
      monthly: TRAINING_MONTHLY_SALARY,
      days: TRAINING_DAYS_PER_MONTH,
      daily: TRAINING_DAILY_RATE,
      weekly: TRAINING_WEEKLY_SALARY,
    },
    workingDays,
    monthLock,
    bonusTypes: bonusTypesForCompany(parseCompany(req)),
    deductionTypes: DEDUCTION_TYPES,
    commissionTypes: store.getCommissionTypes(),
    commissionTiers,
    payrollStatuses: PROFILE_STATUSES,
    paymentMethodFilters: PAYMENT_METHOD_FILTER_OPTIONS,
    units,
    teams,
    totals: views.agent.totals,
    trainingEnrichWarnings: bundle.trainingEnrichWarnings || [],
  });
});

router.get("/payroll/pdf", async (req, res) => {
  if (!roles.canViewPayroll(req.userRole)) {
    return res.status(403).json({ error: "No permission to view payroll" });
  }
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const unit = req.query.unit || "";
  const scope = (req.query.scope || "agent").toLowerCase();
  const {
    filterPayrollRowsByEmployeeIds,
    parseEmployeeIdsQuery,
    buildPayrollExportTotals,
  } = require("../lib/payroll-export");
  const employeeIds = parseEmployeeIdsQuery(req.query.employeeIds);

  const bundle = await buildEnrichedPayrollForMonth(month, req, { unit });
  const { buildPayrollViews } = require("../lib/training-payroll");
  const { buildTotalPaidView } = require("../lib/payroll-schedule");
  const hideOut = parseHideOut(req);
  const showLegacyEmployees = parseShowLegacy(req);
  const views = buildPayrollViews(bundle.payroll, { hideOut, month, showLegacyEmployees });

  let payrollRows = views.agent.rows;
  let totals = views.agent.totals;
  if (scope === "full") {
    const { filterPayrollViewRows } = require("../lib/payroll-view-filters");
    const { sumPayrollRowMetrics } = require("../lib/payroll-row-metrics");
    payrollRows = filterPayrollViewRows(bundle.payroll, { hideOut, month, showLegacyEmployees });
    totals = sumPayrollRowMetrics(payrollRows);
  } else if (scope === "training") {
    payrollRows = views.training.rows;
    totals = views.training.totals;
  } else if (scope === "total") {
    const priorMonth = shiftMonth(month, -1);
    const priorBundle = await buildEnrichedPayrollForMonth(priorMonth, req, { unit });
    const programsByEmployee = await loadProgramsForEmployees(bundle.employees);
    const totalPaid = buildTotalPaidView(
      month,
      { [month]: bundle.payroll, [priorMonth]: priorBundle.payroll },
      bundle.allPayrollSplits,
      programsByEmployee
    );
    payrollRows = totalPaid.rows;
    totals = totalPaid.totals;
  }

  payrollRows = filterPayrollRowsByEmployeeIds(payrollRows, employeeIds);
  // Always derive footer from the exact rows being exported (keeps PDF/XLS ≡ grid).
  if (scope !== "total") {
    totals = buildPayrollExportTotals(payrollRows);
  }

  const { buildPayrollTablePdf } = require("../lib/pdf-export");
  const pdf = await buildPayrollTablePdf(payrollRows, month, {
    totalNet: totals.totalNet,
    totalPaidNet: totals.totalPaidNet,
    totalAllNet: totals.totalAllNet,
  });
  const suffix = scope === "agent" ? "" : `-${scope}`;
  res.type("application/pdf").attachment(`payroll-${month}${suffix}.pdf`).send(pdf);
});

router.get("/payroll/xlsx", async (req, res) => {
  if (!roles.canViewPayroll(req.userRole)) {
    return res.status(403).json({ error: "No permission to view payroll" });
  }
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const unit = req.query.unit || "";
  const scope = (req.query.scope || "agent").toLowerCase();
  const {
    filterPayrollRowsByEmployeeIds,
    parseEmployeeIdsQuery,
    buildPayrollExportTotals,
    toPayrollXlsxBuffer,
  } = require("../lib/payroll-export");
  const employeeIds = parseEmployeeIdsQuery(req.query.employeeIds);

  const bundle = await buildEnrichedPayrollForMonth(month, req, { unit });
  const { buildPayrollViews } = require("../lib/training-payroll");
  const { buildTotalPaidView } = require("../lib/payroll-schedule");
  const hideOut = parseHideOut(req);
  const showLegacyEmployees = parseShowLegacy(req);
  const views = buildPayrollViews(bundle.payroll, { hideOut, month, showLegacyEmployees });

  let payrollRows = views.agent.rows;
  let totals = views.agent.totals;
  if (scope === "full") {
    const { filterPayrollViewRows } = require("../lib/payroll-view-filters");
    const { sumPayrollRowMetrics } = require("../lib/payroll-row-metrics");
    payrollRows = filterPayrollViewRows(bundle.payroll, { hideOut, month, showLegacyEmployees });
    totals = sumPayrollRowMetrics(payrollRows);
  } else if (scope === "training") {
    payrollRows = views.training.rows;
    totals = views.training.totals;
  } else if (scope === "total") {
    const priorMonth = shiftMonth(month, -1);
    const priorBundle = await buildEnrichedPayrollForMonth(priorMonth, req, { unit });
    const programsByEmployee = await loadProgramsForEmployees(bundle.employees);
    const totalPaid = buildTotalPaidView(
      month,
      { [month]: bundle.payroll, [priorMonth]: priorBundle.payroll },
      bundle.allPayrollSplits,
      programsByEmployee
    );
    payrollRows = totalPaid.rows;
    totals = totalPaid.totals;
  }

  payrollRows = filterPayrollRowsByEmployeeIds(payrollRows, employeeIds);
  if (scope !== "total") {
    totals = buildPayrollExportTotals(payrollRows);
  }

  const buf = toPayrollXlsxBuffer(payrollRows, month, totals);
  const suffix = scope === "agent" ? "" : `-${scope}`;
  res
    .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .attachment(`payroll-${month}${suffix}.xlsx`)
    .send(buf);
});

router.get("/payroll/my-payslip/available", (req, res) => {
  if (!["agent", "office_assistant"].includes(req.userRole?.role) || !req.userRole?.employeeId) {
    return res.json({ available: false });
  }
  const month = req.query.month || roles.localYearMonth();
  const emp = store.getEmployeeById(req.userRole.employeeId);
  const adjustment = store.getPayrollAdjustment(month, emp?.id);
  const available = roles.canViewAgentPayslip(req.userRole, emp, adjustment);
  res.json({ available, month, employeeId: req.userRole.employeeId });
});

router.get("/payroll/:employeeId", async (req, res) => {
  const month = req.query.month || roles.localYearMonth();
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!assertEmployeeInCompanyContext(emp, req)) {
    return res.status(404).json({ error: "Employee not found" });
  }
  const adjustment = store.getPayrollAdjustment(month, emp.id);
  const agentSelf =
    (req.userRole.role === "agent" || req.userRole.role === "office_assistant") &&
    req.userRole.employeeId === emp.id;
  if (agentSelf) {
    if (!roles.canViewAgentPayslip(req.userRole, emp, adjustment)) {
      return res.status(403).json({ error: "Payslip not released for this month" });
    }
  } else if (!roles.canViewBonusesDeductions(req.userRole)) {
    return res.status(403).json({ error: "No permission to view payroll" });
  } else if (!assertEmployeeInCompanyContext(emp, req)) {
    return res.status(403).json({ error: "No access" });
  }

  const bundle = await loadEmployeePayslipBundle(emp, month, req);
  const kind = req.query.kind || "";
  const { resolvePayslipFromBundle } = require("../lib/training-payroll");
  const payslip = kind ? resolvePayslipFromBundle(bundle, kind) : bundle.payslip;
  if (kind && !payslip) {
    return res.status(404).json({ error: `Payslip kind "${kind}" not found for this month` });
  }
  res.json({
    month,
    payslip,
    payrollKind: payslip.payrollKind || "standard",
    trainingPayslip: bundle.payslip?.training || null,
    agentPayslip: bundle.payslip?.agent || null,
    splits: payslip.splits || [],
    splitKinds: SPLIT_KINDS,
    splitStatuses: SPLIT_STATUSES.filter((s) => s !== "cancelled"),
    employee: emp,
    adjustment: store.getPayrollAdjustment(month, emp.id),
    bonuses: agentSelf ? [] : bundle.bonusEvents,
    deductions: agentSelf ? [] : bundle.deductionEvents,
    attendance: bundle.attendanceRecords,
    bonusTypes: bonusTypesForCompany(parseCompany(req)),
    deductionTypes: DEDUCTION_TYPES,
    commissionTypes: store.getCommissionTypes(),
    commissionTiers: bundle.commissionTiers,
    payslipGateNotes: bundle.payslipGateNotes || [],
    viewOnly: agentSelf,
    extraPayroll: bundle.extraPayrollEntries || [],
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
  const empIds = new Set(employees.map((e) => e.id));
  bonuses = bonuses.filter((b) => empIds.has(b.employeeId));
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
    types: bonusTypesForCompany(parseCompany(req)),
  });
});

router.post("/bonuses", async (req, res) => {
  const { employeeId, date, amount, reason, type, unit, deductFromEmployeeId } = req.body;
  const bonusType = type || "Other Bonus";
  if (bonusType === "Bonus from TL / OP" && !deductFromEmployeeId) {
    return res.status(400).json({
      error: "Select which TL/OP pays for this bonus (deductFromEmployeeId)",
    });
  }
  const isTlTransfer = bonusType === "Bonus from TL / OP";

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
    await assertMonthNotLocked(String(date).slice(0, 7), req);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const emp = store.getEmployeeById(employeeId);
  if (!assertEmployeeInCompanyContext(emp, req)) {
    return res.status(404).json({ error: "Employee not found" });
  }

  const allowedTypes = bonusTypesForCompany(
    companyContext.isInHs2Scope(emp) ? "hs2" : req.query.company
  );
  if (!allowedTypes.includes(bonusType)) {
    return res.status(400).json({ error: `Bonus type not allowed for this employee: ${bonusType}` });
  }

  try {
    await assertMonthNotLocked(String(date).slice(0, 7), req);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

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
    if (!assertEmployeeInCompanyContext(fromEmp, req)) {
      return res.status(404).json({ error: "Deduction employee not found" });
    }
    if (!roles.canGrantTransferBonus(req.userRole, emp, fromEmp)) {
      return res.status(403).json({ error: "No access to one of the employees" });
    }
    await applyTlBonusTransfer(
      {
        employeeId,
        deductFromEmployeeId,
        date,
        amount,
        reason,
        unit: unit || emp?.unit || "",
      },
      req.username
    );
  } else {
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
  if (bonusType === "Bonus from TL / OP" && !deductFromEmployeeId) {
    return res.status(400).json({
      error: "Select which TL/OP pays for this bonus (deductFromEmployeeId)",
    });
  }
  const isTlTransfer = bonusType === "Bonus from TL / OP";

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

  const patchEmp = store.getEmployeeById(employeeId);
  if (!assertEmployeeInCompanyContext(patchEmp, req)) {
    return res.status(404).json({ error: "Employee not found" });
  }
  const origEmp = store.getEmployeeById(originalEmployeeId);
  if (!assertEmployeeInCompanyContext(origEmp, req)) {
    return res.status(404).json({ error: "Employee not found" });
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
  const delEmp = store.getEmployeeById(employeeId);
  if (!assertEmployeeInCompanyContext(delEmp, req)) {
    return res.status(404).json({ error: "Employee not found" });
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
  const monthBonuses = store.getBonusEvents(month);
  let deductions = store.getDeductionEvents(month, employeeId || undefined);
  const empIds = new Set(employees.map((e) => e.id));
  deductions = deductions.filter((d) => empIds.has(d.employeeId));
  if (!employeeId) {
    deductions = roles.filterDeductionsForUser(deductions, req.userRole, employees);
  } else if (!roles.scopedEmployeeIds(employees, req.userRole).has(employeeId)) {
    return res.status(403).json({ error: "No access" });
  }
  res.json({
    deductions: deductions.map((d) => enrichDeductionForApi(d, monthBonuses)),
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
    await assertMonthNotLocked(String(date).slice(0, 7), req);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const emp = store.getEmployeeById(employeeId);
  if (!assertEmployeeInCompanyContext(emp, req)) {
    return res.status(404).json({ error: "Employee not found" });
  }
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
  const origDedEmp = store.getEmployeeById(originalEmployeeId);
  if (!assertEmployeeInCompanyContext(origDedEmp, req)) {
    return res.status(404).json({ error: "Employee not found" });
  }
  const existingDeduction = store
    .getDeductionEvents(String(originalDate).slice(0, 7), originalEmployeeId)
    .find(
      (d) =>
        d.employeeId === originalEmployeeId &&
        d.date === originalDate &&
        d.type === originalType
    );
  await store.deleteDeduction(originalEmployeeId, originalDate, originalType, req.username);
  const emp = store.getEmployeeById(employeeId);
  if (!assertEmployeeInCompanyContext(emp, req)) {
    return res.status(404).json({ error: "Employee not found" });
  }
  const deductionType = type || originalType || "Other Deductions";
  let deductionReason = reason;
  if (deductionType === "Bonus from TL / OP") {
    const recipientId =
      parseTlBonusRecipientFromReason(existingDeduction?.reason) ||
      parseTlBonusRecipientFromReason(reason) ||
      employeeId;
    deductionReason = formatTlDeductionReason(reason, recipientId);
  }
  await store.upsertDeduction(
    {
      employeeId,
      date,
      amount: Number(amount),
      reason: deductionReason,
      type: deductionType,
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

router.get("/position-rates", async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const company = parseCompany(req);
  try {
    const ensured = await store.ensurePositionRatesForMonth(month, req.username);
    let rates = store.getPositionRates(month);
    if (company === "hs2") {
      rates = rates.filter((r) => r.company === "hs2");
    } else {
      rates = rates.filter((r) => !r.company || r.company === "hangup");
    }
    res.json({ month, company, rates, initialized: ensured.initialized, initializedFrom: ensured.source });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/position-rates/copy-from-previous", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const month = req.body.month || req.body.yearMonth || new Date().toISOString().slice(0, 7);
  try {
    const result = await store.copyPositionRatesFromPreviousMonth(month, req.username);
    const company = parseCompany(req);
    let rates = store.getPositionRates(month);
    if (company === "hs2") {
      rates = rates.filter((r) => r.company === "hs2");
    } else {
      rates = rates.filter((r) => !r.company || r.company === "hangup");
    }
    res.json({ ok: true, month, ...result, rates });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function changeLogOptsForRequest(req) {
  const company = parseCompany(req);
  const scoped = companyContext.filterEmployeesByCompany(store.getEmployees(), company);
  return {
    employeeIds: new Set(scoped.map((e) => e.id)),
    company,
  };
}

router.get("/changelog", async (req, res) => {
  if (!roles.canViewLogs(req.userRole)) {
    return res.status(403).json({ error: "Logs access is restricted to Admin/CEO." });
  }
  const scope = changeLogOptsForRequest(req);
  const entries = await store.readChangeLog({
    limit: Number(req.query.limit) || 100,
    entity: req.query.entity,
    username: req.query.user,
    month: req.query.month,
    employeeIds: scope.employeeIds,
    company: scope.company,
  });
  res.json({ entries, company: scope.company });
});

router.put("/settings/hide-out", async (req, res) => {
  if (!roles.canViewSettingsSection(req.userRole, "hideOut")) {
    return res.status(403).json({ error: "No permission to change hide-out setting" });
  }
  const { hide } = req.body;
  await store.setHideOutEmployees(hide !== false, req.username);
  res.json({ ok: true, hideOutEmployees: hide !== false });
});

router.put("/settings/show-legacy", async (req, res) => {
  if (!roles.canViewSettingsSection(req.userRole, "hideOut")) {
    return res.status(403).json({ error: "No permission to change legacy employee setting" });
  }
  const { show } = req.body;
  await store.setShowLegacyEmployees(show === true, req.username);
  res.json({ ok: true, showLegacyEmployees: show === true });
});

router.put("/settings/tax-rules", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const company = parseCompany(req);
  const taxRules = {
    incomeTaxRate: Number(req.body.incomeTaxRate) || 0,
    socialInsuranceRate: Number(req.body.socialInsuranceRate) || 0,
  };
  const saved = await store.updateTaxRules(taxRules, req.username, company);
  res.json({ ok: true, taxRules: saved, company });
});

router.get("/settings/tax-rules", (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const company = parseCompany(req);
  const scopedConfig = store.getConfigForCompany(company);
  res.json({ taxRules: scopedConfig.taxRules, company });
});

router.get("/payroll-adjustments", (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const adjustments = store.getPayrollAdjustments(month);
  const employees = companyContext.filterEmployeesByCompany(
    store.getEmployees({ hideOut: false }),
    parseCompany(req)
  );
  const companyEmpIds = new Set(employees.map((e) => e.id));
  res.json({ month, adjustments: adjustments.filter((a) => companyEmpIds.has(a.employeeId)) });
});

router.put("/payroll-adjustments/:employeeId", async (req, res) => {
  const startTime = Date.now();
  const logPrefix = `[PAYROLL-SAVE ${req.params.employeeId} ${req.body.yearMonth}]`;
  console.log(`${logPrefix} START - body keys:`, Object.keys(req.body));
  
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const month = req.body.yearMonth || req.query.month || new Date().toISOString().slice(0, 7);
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!assertEmployeeInCompanyContext(emp, req)) {
    return res.status(403).json({ error: "Employee not in company context" });
  }
  
  console.log(`${logPrefix} [${Date.now() - startTime}ms] Employee loaded`);
  
  if (req.body.payrollStatus) {
    const gate = await payrollGates.canApprovePayrollStatus(
      req.params.employeeId,
      month,
      req.body.payrollStatus,
      emp
    );
    if (!gate.ok) return res.status(400).json({ error: gate.error, blockers: gate.blockers });
  }
  console.log(`${logPrefix} [${Date.now() - startTime}ms] Gates checked`);
  
  try {
    await assertMonthNotLocked(month, req);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  console.log(`${logPrefix} [${Date.now() - startTime}ms] Month lock checked`);
  
  const { resolveCanonicalPosition } = require("../lib/position-canonical");
  const rawPosition = req.body.position ?? emp.position;
  const record = {
    employeeId: req.params.employeeId,
    yearMonth: month,
    extraDays: Number(req.body.extraDays) || 0,
    twoWeekHold: req.body.twoWeekHold === true,
    commissionType: req.body.commissionType || "",
    commissionAmount: Number(req.body.commissionAmount) || 0,
    commissionComments: req.body.commissionComments || "",
    position: resolveCanonicalPosition(rawPosition, store.getPositionRates(month)),
    salaryRaise: Number(req.body.salaryRaise) || 0,
    monthlySalaryOverride:
      req.body.monthlySalaryOverride != null && req.body.monthlySalaryOverride !== ""
        ? Number(req.body.monthlySalaryOverride)
        : null,
    netSalaryOverride:
      req.body.netSalaryOverride != null && req.body.netSalaryOverride !== ""
        ? Number(req.body.netSalaryOverride)
        : null,
    trainingNetSalaryOverride:
      req.body.trainingNetSalaryOverride != null && req.body.trainingNetSalaryOverride !== ""
        ? Number(req.body.trainingNetSalaryOverride)
        : null,
    agentNetSalaryOverride:
      req.body.agentNetSalaryOverride != null && req.body.agentNetSalaryOverride !== ""
        ? Number(req.body.agentNetSalaryOverride)
        : null,
    trainingPayrollPaid: req.body.trainingPayrollPaid === true,
    trainingPhase1PayException: req.body.trainingPhase1PayException === true,
    trainingPayrollAnchorMonthOverride: String(req.body.trainingPayrollAnchorMonthOverride || "")
      .trim()
      .slice(0, 7),
    paymentMethod: normalizePaymentMethodValue(req.body.paymentMethod ?? emp.payment_method) || "",
    bankReference: req.body.bankReference ?? emp.bank_refrence_number,
    bankName: req.body.bankName ?? emp.bank_name_as_bank_sheet,
    payrollStatus: req.body.payrollStatus || "pending",
    transportEligible: req.body.transportEligible === true,
    monthNotes: req.body.monthNotes || "",
    noPayroll: req.body.noPayroll === true,
    payslipVisibleToAgent: req.body.payslipVisibleToAgent === true,
    salesCount: Number(req.body.salesCount) || 0,
  };
  console.log(`${logPrefix} [${Date.now() - startTime}ms] About to upsert:`, {
    monthlySalaryOverride: record.monthlySalaryOverride,
    netSalaryOverride: record.netSalaryOverride,
  });
  
  const saved = await store.upsertPayrollAdjustment(record, req.username);
  console.log(`${logPrefix} [${Date.now() - startTime}ms] SAVED - sending response`);
  res.json({ ok: true, adjustment: saved });
  console.log(`${logPrefix} [${Date.now() - startTime}ms] END`);
});

router.post("/payroll-adjustments/:employeeId/recalc-sales-count", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!assertEmployeeInCompanyContext(emp, req)) {
    return res.status(403).json({ error: "Employee not in company context" });
  }
  const month = req.body.yearMonth || req.query.month || new Date().toISOString().slice(0, 7);
  try {
    const saved = await store.recalcSalesCountForEmployee(month, req.params.employeeId, req.username);
    res.json({ ok: true, adjustment: saved, salesCount: saved?.salesCount ?? 0 });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/payroll-adjustments/init-month", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const month = req.body.month || new Date().toISOString().slice(0, 7);
  const scopedIds = new Set(
    filterEmployeesForRequest(store.getEmployees({ hideOut: false }), req).map((e) => e.id)
  );
  const count = await store.initMonthProfiles(month, req.username, { employeeIdFilter: scopedIds });
  res.json({ ok: true, count, month });
});

router.post("/payroll-adjustments/bulk-transport", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const month = req.body.month;
  if (!month) return res.status(400).json({ error: "month required (YYYY-MM)" });
  const eligible = req.body.eligible !== false;
  const scopedIds = new Set(
    filterEmployeesForRequest(store.getEmployees({ hideOut: false }), req).map((e) => e.id)
  );
  const count = await store.bulkSetTransportEligible(month, eligible, req.username, { employeeIdFilter: scopedIds });
  res.json({ ok: true, count, month, eligible });
});

router.get("/payroll-extra/:employeeId/:yearMonth", async (req, res) => {
  if (!roles.canViewPayroll(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!assertEmployeeInCompanyContext(emp, req)) {
    return res.status(403).json({ error: "Employee not in company context" });
  }
  const { employeeId, yearMonth } = req.params;
  const supabaseRepo = require("../lib/supabase-repo");
  const entries = await supabaseRepo.readExtraPayrollEntries(employeeId, yearMonth);
  res.json({ entries });
});

router.post("/payroll-extra/:employeeId/:yearMonth", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!assertEmployeeInCompanyContext(emp, req)) {
    return res.status(403).json({ error: "Employee not in company context" });
  }
  const { employeeId, yearMonth } = req.params;
  const { label, workingDays, dailyRate, netAmount } = req.body;
  const supabaseRepo = require("../lib/supabase-repo");
  const entry = await supabaseRepo.createExtraPayrollEntry(
    {
      employeeId,
      yearMonth,
      label: label || "Extra",
      workingDays: workingDays != null ? Number(workingDays) : 0,
      dailyRate: dailyRate != null ? Number(dailyRate) : 0,
      netAmount: netAmount != null ? Number(netAmount) : 0,
    },
    req.username
  );
  res.json({ ok: true, entry });
});

router.patch("/payroll-extra/:id", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const { id } = req.params;
  const supabaseRepo = require("../lib/supabase-repo");
  const existing = await supabaseRepo.getExtraPayrollEntryById(id);
  if (!existing) return res.status(404).json({ error: "Entry not found" });
  const emp = store.getEmployeeById(existing.employeeId);
  if (!emp || !assertEmployeeInCompanyContext(emp, req)) {
    return res.status(403).json({ error: "Employee not in company context" });
  }
  const entry = await supabaseRepo.updateExtraPayrollEntry(id, req.body, req.username);
  res.json({ ok: true, entry });
});

router.delete("/payroll-extra/:id", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const { id } = req.params;
  const supabaseRepo = require("../lib/supabase-repo");
  const existing = await supabaseRepo.getExtraPayrollEntryById(id);
  if (!existing) return res.status(404).json({ error: "Entry not found" });
  const emp = store.getEmployeeById(existing.employeeId);
  if (!emp || !assertEmployeeInCompanyContext(emp, req)) {
    return res.status(403).json({ error: "Employee not in company context" });
  }
  await supabaseRepo.deleteExtraPayrollEntry(id);
  res.json({ ok: true });
});

router.get("/payroll-extra/:id/pdf", async (req, res) => {
  try {
    if (!roles.canViewPayroll(req.userRole)) {
      return res.status(403).json({ error: "No permission" });
    }
    const { id } = req.params;
    const supabaseRepo = require("../lib/supabase-repo");
    const entry = await supabaseRepo.getExtraPayrollEntryById(id);
    if (!entry) return res.status(404).json({ error: "Entry not found" });
    const emp = store.getEmployeeById(entry.employeeId);
    if (!emp) return res.status(404).json({ error: "Employee not found" });
    if (!assertEmployeeInCompanyContext(emp, req)) {
      return res.status(403).json({ error: "No access" });
    }
    const { buildExtraPayrollPdf } = require("../lib/payslip-pdf");
    const pdf = await buildExtraPayrollPdf(entry, emp, entry.yearMonth);
    const safeLabel = (entry.label || "extra").replace(/[^\w\s-]+/g, "").trim().replace(/\s+/g, "-");
    const safeName = (emp.american_name || emp.id || "emp").replace(/[^\w\s-]+/g, "").trim().replace(/\s+/g, "-");
    res.type("application/pdf").attachment(`extra-payroll-${safeName}-${safeLabel}-${entry.yearMonth}.pdf`).send(pdf);
  } catch (err) {
    console.error("extra payroll pdf error", err);
    res.status(500).json({ error: err.message || "PDF generation failed" });
  }
});

router.get("/payroll-splits", (req, res) => {
  if (!roles.canViewPayroll(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  const month = req.query.month || "";
  const employeeId = req.query.employeeId || "";
  const employees = filterEmployeesForRequest(store.getEmployeesForMonth(month), req);
  const empIds = new Set(employees.map((e) => e.id));
  const splits = month
    ? store.getPayrollSplitsForMonth(month, employeeId || undefined).filter((s) => empIds.has(s.employeeId))
    : store.getAllPayrollSplits().filter((s) => (!employeeId || s.employeeId === employeeId) && empIds.has(s.employeeId));
  res.json({ splits, splitKinds: SPLIT_KINDS, splitStatuses: SPLIT_STATUSES.filter((s) => s !== "cancelled") });
});

async function getSplitValidationContext(employeeId, yearMonth, excludeSplitId = null, options = {}) {
  const splitKind = options.splitKind || "payment";
  const emp = store.getEmployeeById(employeeId);
  if (!emp) return null;
  const allPayrollSplits = store.getAllPayrollSplits();
  const splitMaps = buildSplitMaps(allPayrollSplits, yearMonth);
  const { filterTrainingSplits, filterAgentSplits, resolvePayslipFromBundle } = require("../lib/training-payroll");

  const bundle = await loadEmployeePayslipBundle(emp, yearMonth);

  if (splitKind === "training_payroll" || splitKind === "training_bonus") {
    const trainingSlip = resolvePayslipFromBundle({ payslip: bundle.payslip }, "training");
    if (!trainingSlip) return null;
    const splitsForMonth = filterTrainingSplits(splitMaps.byEmployeeMonth.get(employeeId) || []);
    const deferredIn = filterTrainingSplits(splitMaps.deferredIn.get(employeeId) || []);
    const calculatedNet =
      trainingSlip.calculatedNet ??
      trainingSlip.netSalary + (trainingSlip.receivedTotal || 0) + (trainingSlip.deferredOut || 0);
    return buildValidationContext(calculatedNet, splitsForMonth, deferredIn, excludeSplitId);
  }

  const agentSlip = resolvePayslipFromBundle({ payslip: bundle.payslip }, "agent") || bundle.payslip;
  const splitsForMonth = filterAgentSplits(splitMaps.byEmployeeMonth.get(employeeId) || []);
  const deferredIn = filterAgentSplits(splitMaps.deferredIn.get(employeeId) || []);
  const calculatedNet =
    agentSlip.calculatedNet ??
    agentSlip.netSalary + (agentSlip.receivedTotal || 0) + (agentSlip.deferredOut || 0);
  return buildValidationContext(calculatedNet, splitsForMonth, deferredIn, excludeSplitId);
}

router.post("/payroll-splits", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const { employeeId, yearMonth, amount, splitKind, status, deferToMonth, notes } = req.body;
  if (!employeeId || !yearMonth || amount == null) {
    return res.status(400).json({ error: "employeeId, yearMonth, amount required" });
  }
  const emp = store.getEmployeeById(employeeId);
  if (!emp || !assertEmployeeInCompanyContext(emp, req)) {
    return res.status(403).json({ error: "Employee not in company context" });
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
  const ctx = await getSplitValidationContext(employeeId, yearMonth, null, { splitKind: split.splitKind });
  const err = validateSplit(split, ctx);
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
  const splitEmp = store.getEmployeeById(existing.employeeId);
  if (!splitEmp || !assertEmployeeInCompanyContext(splitEmp, req)) {
    return res.status(403).json({ error: "Employee not in company context" });
  }
  const merged = {
    ...existing,
    ...req.body,
    id: existing.id,
    employeeId: existing.employeeId,
    yearMonth: existing.yearMonth,
    amount: req.body.amount != null ? Number(req.body.amount) : existing.amount,
  };
  const ctx = await getSplitValidationContext(existing.employeeId, existing.yearMonth, existing.id, {
    splitKind: merged.splitKind,
  });
  const err = validateSplit(merged, ctx);
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
  const splitEmp = store.getEmployeeById(existing.employeeId);
  if (!splitEmp || !assertEmployeeInCompanyContext(splitEmp, req)) {
    return res.status(403).json({ error: "Employee not in company context" });
  }
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
  const empCompany = companyContext.getCompanyForUnit(emp.unit);
  const enrichedPayroll = require("../lib/enriched-payroll");
  const history = [];
  const warnings = [];

  for (const ym of months) {
    try {
      await store.refreshAttendanceFromSupabase(ym);
      const bundle = await enrichedPayroll.buildForEmployees(ym, [emp], empCompany);
      if (bundle.trainingEnrichWarnings?.length) {
        warnings.push(...bundle.trainingEnrichWarnings.map((w) => `${ym}: ${w}`));
      }
      const row = bundle.payroll.find((p) => p.employeeId === emp.id);
      if (!row) continue;
      const hasPay =
        row.payrollKind === "training" ||
        row.payrollKind === "training_deferred_month" ||
        row.payrollKind === "dual" ||
        (Number(row.totalWorkingDays) || 0) > 0 ||
        (Number(row.netSalary) || 0) > 0 ||
        (Number(row.earnedNetSalary) || 0) > 0;
      if (!hasPay) continue;
      history.push({ ...row, yearMonth: ym });
    } catch (err) {
      warnings.push(`${ym}: payroll history failed — ${err.message}`);
    }
  }
  res.json({ employeeId: emp.id, history, trainingEnrichWarnings: warnings });
});

router.get("/warnings/:employeeId", (req, res) => {
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!assertEmployeeInCompanyContext(emp, req)) {
    return res.status(403).json({ error: "No access" });
  }
  if (!roles.canViewEmployeeNotes(req.userRole)) {
    return res.json({ warnings: [], writeOnly: roles.canWriteEmployeeNotes(req.userRole) });
  }
  res.json({ warnings: store.getEmployeeWarnings(req.params.employeeId) });
});

router.post("/warnings", async (req, res) => {
  if (!roles.canWriteEmployeeNotes(req.userRole)) {
    return res.status(403).json({ error: "No permission to add notes" });
  }
  const { employeeId, date, type, title, content, severity, warningLevel } = req.body;
  if (!employeeId || !content) {
    return res.status(400).json({ error: "employeeId and content required" });
  }
  const emp = store.getEmployeeById(employeeId);
  if (!emp || !roles.canAccessEmployee(req.userRole, emp)) {
    return res.status(403).json({ error: "No access to this employee" });
  }
  const saved = await store.addEmployeeWarning(
    { employeeId, date, type, title, content, severity, warningLevel },
    req.username
  );
  const employee = store.getEmployeeById(employeeId);
  const displayName =
    employee?.american_name || employee?.arabic_name || employeeId;
  const dispatch = require("../lib/notify-dispatch");
  await dispatch.dispatchNotification({
    actionKey: "employee_note_created",
    type: "employee_note",
    title: `Employee note added for ${displayName}`,
    body: `${displayName}: ${title || type || "Note"}`,
    entityType: "employee_note",
    entityId: `${employeeId}:${saved.id}`,
    actor: req.username,
    context: { company: companyContext.getCompanyForUnit(employee?.unit) },
  });
  res.json({ ok: true, warning: saved });
});

router.put("/warnings/:id", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  try {
    const prior = store.getEmployeeWarnings().find((w) => String(w.id) === String(req.params.id));
    if (!prior) return res.status(404).json({ error: "Warning not found" });
    const emp = store.getEmployeeById(prior.employeeId);
    if (!emp || !assertEmployeeInCompanyContext(emp, req)) {
      return res.status(404).json({ error: "Warning not found" });
    }
    const saved = await store.updateEmployeeWarning(
      req.params.id,
      {
        date: req.body.date,
        type: req.body.type,
        title: req.body.title,
        content: req.body.content,
        severity: req.body.severity,
        warningLevel: req.body.warningLevel,
      },
      req.username
    );
    res.json({ ok: true, warning: saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/warnings/:id", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  try {
    const prior = store.getEmployeeWarnings().find((w) => String(w.id) === String(req.params.id));
    if (!prior) return res.status(404).json({ error: "Warning not found" });
    const emp = store.getEmployeeById(prior.employeeId);
    if (!emp || !assertEmployeeInCompanyContext(emp, req)) {
      return res.status(404).json({ error: "Warning not found" });
    }
    await store.deleteEmployeeWarning(req.params.id, req.username);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/quality-notes/:employeeId", async (req, res) => {
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!assertEmployeeInCompanyContext(emp, req)) {
    return res.status(403).json({ error: "Employee not in current company context" });
  }
  if (!assertEmployeeInCompanyContext(emp, req)) {
    return res.status(403).json({ error: "No access" });
  }
  if (!roles.canViewQualityNotes(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  try {
    const qualityNotes = require("../lib/quality-notes-repo");
    const notes = await qualityNotes.listForEmployee(req.params.employeeId);
    res.json({ notes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/quality-notes", async (req, res) => {
  if (!roles.canWriteQualityNotes(req.userRole)) {
    return res.status(403).json({ error: "No permission to add quality notes" });
  }
  const { employeeId, body, noteDate } = req.body;
  if (!employeeId || !body) {
    return res.status(400).json({ error: "employeeId and body required" });
  }
  const emp = store.getEmployeeById(employeeId);
  if (!emp || !roles.canAccessEmployee(req.userRole, emp)) {
    return res.status(403).json({ error: "No access to this employee" });
  }
  if (!assertEmployeeInCompanyContext(emp, req)) {
    return res.status(403).json({ error: "Employee not in current company context" });
  }
  try {
    const qualityNotes = require("../lib/quality-notes-repo");
    const note = await qualityNotes.createNote(
      {
        employeeId,
        authorUsername: req.username,
        authorRole: req.userRole?.role || "",
        body,
        noteDate,
      },
      req.username
    );
    const employee = store.getEmployeeById(employeeId);
    const displayName =
      employee?.american_name || employee?.arabic_name || employeeId;
    const dispatch = require("../lib/notify-dispatch");
    await dispatch.dispatchNotification({
      actionKey: "quality_note_created",
      type: "quality_note",
      title: `Quality note on ${displayName}`,
      body: `${displayName}: ${String(body).slice(0, 80)}`,
      entityType: "quality_note",
      entityId: `${employeeId}:${note.id}`,
      actor: req.username,
      context: { company: companyContext.getCompanyForUnit(employee?.unit) },
    });
    res.json({ ok: true, note });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/quality-notes/:id", async (req, res) => {
  try {
    const qualityNotes = require("../lib/quality-notes-repo");
    const existing = await qualityNotes.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Note not found" });
    const emp = store.getEmployeeById(existing.employeeId);
    if (!emp || !assertEmployeeInCompanyContext(emp, req)) {
      return res.status(403).json({ error: "No access" });
    }
    if (!assertEmployeeInCompanyContext(emp, req)) {
      return res.status(403).json({ error: "Employee not in current company context" });
    }
    if (!roles.canManageQualityNote(req.userRole, existing, req.username)) {
      return res.status(403).json({ error: "No permission to edit this note" });
    }
    const note = await qualityNotes.updateNote(req.params.id, req.body, req.username);
    res.json({ ok: true, note });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/quality-notes/:id", async (req, res) => {
  try {
    const qualityNotes = require("../lib/quality-notes-repo");
    const existing = await qualityNotes.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Note not found" });
    const emp = store.getEmployeeById(existing.employeeId);
    if (!emp || !assertEmployeeInCompanyContext(emp, req)) {
      return res.status(403).json({ error: "No access" });
    }
    if (!assertEmployeeInCompanyContext(emp, req)) {
      return res.status(403).json({ error: "Employee not in current company context" });
    }
    if (!roles.canManageQualityNote(req.userRole, existing, req.username)) {
      return res.status(403).json({ error: "No permission to delete this note" });
    }
    await qualityNotes.deleteNote(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/position-rates", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const { position, monthlySalary, yearMonth, month: bodyMonth, company } = req.body;
  const month = yearMonth || bodyMonth || req.query.month || new Date().toISOString().slice(0, 7);
  if (!position || monthlySalary == null) {
    return res.status(400).json({ error: "position and monthlySalary required" });
  }
  const co = company || parseCompany(req);
  try {
    const rate = await store.upsertPositionRateMonthlyOnly(position, Number(monthlySalary), req.username, month, co);
    res.json({ ok: true, rate });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/position-rates/:position", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const position = decodeURIComponent(req.params.position);
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const company = parseCompany(req);
  const inUse = companyContext
    .filterEmployeesByCompany(store.getEmployees(), company)
    .some((e) => e.position === position);
  if (inUse) {
    return res.status(400).json({ error: `Position "${position}" is assigned to employees` });
  }
  try {
    await store.deletePositionRate(position, req.username, month, company);
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
  const company = parseCompany(req);
  res.json({ month, company, tiers: store.getCommissionTiers(month, company) });
});

router.put("/commission-tiers", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const month = req.body.month || req.query.month || new Date().toISOString().slice(0, 7);
  const company = parseCompany(req);
  const tiers = await store.setCommissionTiersForMonth(month, req.body.tiers || [], req.username, company);
  res.json({ ok: true, month, company, tiers });
});

router.get("/loans", (req, res) => {
  const employeeId = req.query.employeeId || "";
  let loans = store.getEmployeeLoans(employeeId || undefined);
  const employees = filterEmployeesForRequest(store.getEmployees({ hideOut: false }), req);
  const empIds = new Set(employees.map((e) => e.id));
  loans = loans.filter((l) => empIds.has(l.employeeId));
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
  if (!assertEmployeeInCompanyContext(emp, req)) {
    return res.status(403).json({ error: "Employee not in company context" });
  }
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
  const existing = store.getEmployeeLoans().find((l) => l.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "Loan not found" });
  const emp = store.getEmployeeById(existing.employeeId);
  if (!emp || !assertEmployeeInCompanyContext(emp, req)) {
    return res.status(404).json({ error: "Loan not found" });
  }
  const saved = await store.updateEmployeeLoanRecord(req.params.id, req.body, req.username);
  res.json({ ok: true, loan: saved });
});

router.post("/loans/:id/cancel", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const existing = store.getEmployeeLoans().find((l) => l.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "Loan not found" });
  const emp = store.getEmployeeById(existing.employeeId);
  if (!emp || !assertEmployeeInCompanyContext(emp, req)) {
    return res.status(404).json({ error: "Loan not found" });
  }
  const saved = await store.cancelEmployeeLoan(req.params.id, req.username);
  res.json({ ok: true, loan: saved });
});

router.delete("/loans/:id", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const existing = store.getEmployeeLoans().find((l) => l.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "Loan not found" });
  const emp = store.getEmployeeById(existing.employeeId);
  if (!emp || !assertEmployeeInCompanyContext(emp, req)) {
    return res.status(404).json({ error: "Loan not found" });
  }
  await store.removeEmployeeLoan(req.params.id, req.username);
  res.json({ ok: true });
});

router.post("/payroll/record-loan-payments", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const month = req.body.month || req.query.month || new Date().toISOString().slice(0, 7);
  const scopedIds = new Set(
    filterEmployeesForRequest(store.getEmployees({ hideOut: false }), req).map((e) => e.id)
  );
  const payments = await store.recordLoanPaymentsForMonth(month, req.username, { employeeIdFilter: scopedIds });
  res.json({ ok: true, month, count: payments.length, payments });
});

router.get("/documents/expiring", (req, res) => {
  const now = new Date();
  const docs = store.getEmployeeDocuments();
  const employees = filterEmployeesForRequest(store.getEmployees({ hideOut: false }), req);
  const empIds = new Set(employees.map((e) => e.id));
  const expiring = (docs || []).filter((d) => {
    if (d.noExpiry || !d.expiry) return false;
    if (!empIds.has(d.employeeId)) return false;
    const days = (new Date(d.expiry) - now) / 86400000;
    return days >= 0 && days <= 60;
  });
  res.json({ expiring });
});

router.get("/documents/:employeeId", (req, res) => {
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!assertEmployeeInCompanyContext(emp, req)) {
    return res.status(403).json({ error: "No access" });
  }
  res.json({
    documents: store.getEmployeeDocuments(req.params.employeeId),
    docTypes: (() => {
      const documents = require("../lib/documents");
      if (roles.canManageEmployees(req.userRole)) return documents.DOC_TYPES;
      const isSelf =
        req.userRole?.employeeId === req.params.employeeId &&
        ["agent", "office_assistant"].includes(req.userRole?.role);
      if (isSelf) return documents.SELF_UPLOAD_DOC_TYPES;
      return documents.DOC_TYPES;
    })(),
  });
});

router.get("/documents/:employeeId/:docId/file", async (req, res) => {
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!assertEmployeeInCompanyContext(emp, req)) {
    return res.status(403).json({ error: "No access" });
  }
  const docs = store.getEmployeeDocuments(req.params.employeeId);
  const doc = docs.find(
    (d) => String(d.id) === req.params.docId || String(d.driveFileId) === req.params.docId
  );
  if (!doc?.driveFileId) return res.status(404).json({ error: "Document not found" });
  try {
    const documents = require("../lib/documents");
    const { stream, mimeType } = await documents.getDriveFileStream(doc.driveFileId);
    res.setHeader("Content-Type", mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(doc.fileName || "document")}"`);
    stream.pipe(res);
  } catch (err) {
    res.status(404).json({ error: err.message || "File not found" });
  }
});

router.post("/documents", async (req, res) => {
  const { employeeId, docType, fileName, contentBase64, notes, expiry, noExpiry } = req.body;
  if (!employeeId || !contentBase64 || !fileName) {
    return res.status(400).json({ error: "employeeId, fileName, contentBase64 required" });
  }
  const emp = store.getEmployeeById(employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  const isSelf =
    req.userRole?.employeeId === employeeId &&
    ["agent", "office_assistant"].includes(req.userRole?.role);
  if (!roles.canManageAll(req.userRole) && !isSelf) {
    return res.status(403).json({ error: "No permission" });
  }
  const documents = require("../lib/documents");
  if (isSelf && !roles.canManageEmployees(req.userRole)) {
    if (!documents.SELF_UPLOAD_DOC_TYPES.includes(docType)) {
      return res.status(403).json({
        error: "You may only upload National ID, Medical Note, or Exam Note",
      });
    }
  }

  const fs = require("fs");
  const os = require("os");
  const path = require("path");
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

  const company = parseCompany(req);
  const config = store.getConfigForCompany(company);
  const rates = store.getPositionRates(month);
  const records = store.getAttendanceEvents(month);
  const adjustments = store.getPayrollAdjustments(month);
  const attendanceMap = store.buildAttendanceMap(month);
  const { commissionTiers, loans, loanPayments } = store.getPayrollExtras(month, company);
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
    allPayrollSplits,
    [],
    new Map(),
    useSupabase() ? await loadExtraPayrollEntriesForMonth(employees, month) : []
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

router.get("/reports/analytics", async (req, res) => {
  if (!roles.canViewAnalytics(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const salesMonth = req.query.salesMonth || month;
  const agentsMonth = req.query.agentsMonth || month;
  const company = parseCompany(req);

  const employees = store.getEmployees({ hideOut: false, includeDeleted: true });
  const scopedEmployees = companyContext.filterEmployeesByCompany(employees, company);
  const activeOnly = scopedEmployees.filter(
    (e) => String(e.status || "").toLowerCase() === "active"
  );
  const attendance = store.getAttendanceEvents(agentsMonth);
  const bonuses = store.getBonusEvents(month);
  const deductions = store.getDeductionEvents(month);
  const sales = cache.getBusinessCache("sales") || [];
  const leaveRequests = await hrms.readLeaveRequests({ company }).catch(() => []);
  const scopedEmployeeIds = new Set(scopedEmployees.map((e) => e.id));
  const itRequestsRaw = await require("../lib/it-requests-repo")
    .readItRequests({ company })
    .catch(() => []);
  const itRequests = itRequestsRaw.filter(
    (r) => !r.employeeId || scopedEmployeeIds.has(r.employeeId)
  );
  const equipment = await hrms.readAllEquipment(company).catch(() => []);
  const assignments = await hrms.readEquipmentAssignments(null, company).catch(() => []);
  const changelogRaw = await store.readChangeLog({ month, limit: 1000 }).catch(() => []);
  const changelogEntries = (Array.isArray(changelogRaw) ? changelogRaw : []).filter((entry) => {
    if (entry.entity === "employee" && entry.entity_id) {
      return scopedEmployeeIds.has(entry.entity_id);
    }
    if (entry.entity_id && scopedEmployeeIds.has(entry.entity_id)) return true;
    return !entry.entity_id;
  });

  let expenses = [];
  let bills = [];
  try {
    const business = require("../lib/business-repo");
    expenses = await business.readExpenseRequests({ company, excludeArchived: false }).catch(() => []);
    bills = await business.readMonthlyBills({ company }).catch(() => []);
  } catch {
    /* non-fatal */
  }

  const leave = analyticsAggregates.aggregateLeave(leaveRequests);
  const costs = analyticsAggregates.aggregateCompanyCosts({ expenses, bills });
  const payrollFin = analyticsAggregates.aggregatePayrollFinancials({
    bonuses,
    deductions,
    employees,
    company,
  });
  const att = analyticsAggregates.aggregateAttendance({
    employees,
    attendance,
    month: agentsMonth,
    company,
  });
  const trainingPrograms = await require("../lib/training-phases")
    .loadProgramsForEmployees(activeOnly.map((e) => e.id))
    .catch(() => new Map());
  const training = analyticsAggregates.aggregateTrainingPipeline(trainingPrograms);
  const salesAgg = analyticsAggregates.aggregateSales({
    sales,
    attendance,
    employees,
    salesMonth,
    agentsMonth,
    company,
  });

  const equipmentByType = {};
  const activeAssignments = assignments.filter((a) => !a.returnedAt);
  for (const a of activeAssignments) {
    const eq = equipment.find((e) => e.id === a.equipmentId);
    const type = eq?.itemType || "Unknown";
    equipmentByType[type] = (equipmentByType[type] || 0) + 1;
  }

  const itTotal = itRequests.length;
  const itResolved = itRequests.filter((r) => r.status === "resolved" || r.status === "closed").length;

  const hrAuditRoles = new Set(["hr", "it", "rtm", "admin", "ceo"]);
  const empMap = att.empMap || new Map(employees.map((e) => [e.id, e]));
  const uniqueUsernames = [...new Set(changelogEntries.map((e) => e.username).filter(Boolean))];
  const usernameToRole = {};
  if (uniqueUsernames.length) {
    try {
      const { data: appUsers } = await getSupabaseAdmin()
        .from("app_users")
        .select("username, role, employee_id")
        .in("username", uniqueUsernames);
      for (const u of appUsers || []) {
        let role = String(u.role || "").toLowerCase();
        if (!role && u.employee_id) {
          const emp = empMap.get(u.employee_id);
          if (emp) role = String(emp.position || emp.role || "").toLowerCase();
        }
        if (hrAuditRoles.has(role)) {
          usernameToRole[u.username] = role;
        }
      }
    } catch {
      /* non-fatal */
    }
  }

  const hrEditsByUser = {};
  for (const entry of changelogEntries) {
    const u = String(entry.username || "unknown").trim();
    if (!usernameToRole[u]) continue;
    hrEditsByUser[u] = (hrEditsByUser[u] || 0) + 1;
  }

  res.json({
    month,
    company,
    salesMonth: salesAgg.salesMonth,
    agentsMonth: salesAgg.agentsMonth,
    requests: {
      leave,
      it: { total: itTotal, resolved: itResolved, ratio: itTotal > 0 ? Math.round((itResolved / itTotal) * 100) : 0 },
    },
    financials: {
      companyCosts: costs.companyCosts,
      expenseTotal: costs.expenseTotal,
      billsTotal: costs.billsTotal,
      pendingTotal: costs.pendingTotal || 0,
      paidCount: costs.paidCount || 0,
      pendingCount: costs.pendingCount || 0,
      expensesByCategory: costs.byCategory,
      expensesByPaidBy: costs.byPaidByLabels || {},
      bonuses: payrollFin.bonuses,
      deductions: payrollFin.deductions,
      totalBonuses: payrollFin.totalBonuses,
      totalDeductions: payrollFin.totalDeductions,
    },
    attendance: {
      overall: att.overall,
      byTeam: att.byTeam,
      turnover: att.turnover,
      newEmployees: att.newEmployees,
    },
    training,
    sales: {
      byTeam: salesAgg.byTeam,
      closersByUnit: salesAgg.closersByUnit,
      topCloser: salesAgg.topCloser,
      agentsByTeam: salesAgg.agentsByTeam,
      topAgent: salesAgg.topAgent,
      averagesByTeam: salesAgg.averagesByTeam,
      averagesByTeamPerDay: salesAgg.averagesByTeamPerDay,
      statusByTeam: salesAgg.statusByTeam,
    },
    equipment: equipmentByType,
    hrAudit: hrEditsByUser,
  });
});

router.get("/reports/monthly/pdf", async (req, res) => {
  if (!roles.canViewPayroll(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const hideOut = parseHideOut(req);
  let employees = store.getEmployeesForMonth(month, { hideOut });
  employees = filterEmployeesForRequest(employees, req);

  const company = parseCompany(req);
  const config = store.getConfigForCompany(company);
  const rates = store.getPositionRates(month);
  const records = store.getAttendanceEvents(month);
  const adjustments = store.getPayrollAdjustments(month);
  const attendanceMap = store.buildAttendanceMap(month);
  const { commissionTiers, loans, loanPayments } = store.getPayrollExtras(month, company);
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
    allPayrollSplits,
    [],
    new Map(),
    useSupabase() ? await loadExtraPayrollEntriesForMonth(employees, month) : []
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
  const scope = (req.query.scope || "agent").toLowerCase();

  const bundle = await buildEnrichedPayrollForMonth(month, req);
  const { buildPayrollViews } = require("../lib/training-payroll");
  const { buildTotalPaidView } = require("../lib/payroll-schedule");
  const hideOut = parseHideOut(req);
  const views = buildPayrollViews(bundle.payroll, { hideOut, month });
  let payroll = views.agent.rows;
  if (scope === "training") {
    payroll = views.training.rows;
  } else if (scope === "total") {
    const priorMonth = shiftMonth(month, -1);
    const priorBundle = await buildEnrichedPayrollForMonth(priorMonth, req);
    const programsByEmployee = await loadProgramsForEmployees(bundle.employees);
    payroll = buildTotalPaidView(
      month,
      { [month]: bundle.payroll, [priorMonth]: priorBundle.payroll },
      bundle.allPayrollSplits,
      programsByEmployee
    ).rows;
  }
  const employees = bundle.employees;
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
  const month = req.query.month || roles.localYearMonth();
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  const adjustment = store.getPayrollAdjustment(month, emp.id);
  const agentSelf =
    (req.userRole.role === "agent" || req.userRole.role === "office_assistant") &&
    req.userRole.employeeId === emp.id;
  if (agentSelf) {
    return res.status(403).json({ error: "PDF export not available for agents" });
  }
  if (!roles.canViewBonusesDeductions(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  if (!assertEmployeeInCompanyContext(emp, req)) {
    return res.status(403).json({ error: "No access" });
  }

  const bundle = await loadEmployeePayslipBundle(emp, month, req);
  const { buildPayslipPdf } = require("../lib/payslip-pdf");
  const { resolvePayslipFromBundle } = require("../lib/training-payroll");
  const kind = req.query.kind || "";
  let payslip = resolvePayslipFromBundle(bundle, kind);
  if (!payslip) return res.status(404).json({ error: "Payslip kind not found" });
  const splitId = req.query.splitId;
  if (splitId) {
    const split = (payslip.splits || []).find((s) => s.id === splitId && s.status === "received");
    if (!split) return res.status(404).json({ error: "Split not found" });
    payslip = {
      ...payslip,
      netSalary: split.amount,
      remainingBalance: split.amount,
      calculatedNet: split.amount,
      monthNotes: [payslip.monthNotes, `Payment split: ${fmtCurrency(split.amount)} EGP — ${split.notes || ""}`].filter(Boolean).join("\n"),
    };
  }
  const pdf = await buildPayslipPdf(payslip, month, {
    bonusEvents: bundle.bonusEvents,
    deductionEvents: bundle.deductionEvents,
    attendanceRecords: bundle.attendanceRecords,
    config: bundle.config,
    employees: bundle.employees,
    payslipGateNotes: bundle.payslipGateNotes || [],
    splitLabel: splitId ? `Split payment` : null,
  });
  const safeName = (payslip.name || emp.id).replace(/[^\w\s-]+/g, "").trim().replace(/\s+/g, "-");
  const suffix = splitId ? `-split` : kind ? `-${kind}` : "";
  res
    .type("application/pdf")
    .attachment(`payslip-${emp.id}-${safeName}-${month}${suffix}.pdf`)
    .send(pdf);
});

function fmtCurrency(n) {
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
}

router.get("/payslip/:employeeId/splits-zip", async (req, res) => {
  if (!roles.canViewBonusesDeductions(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!assertEmployeeInCompanyContext(emp, req)) {
    return res.status(403).json({ error: "No access" });
  }
  const bundle = await loadEmployeePayslipBundle(emp, month, req);
  const received = (bundle.payslip.splits || []).filter((s) => s.status === "received");
  if (!received.length) {
    return res.status(404).json({ error: "No received payment splits for this month" });
  }
  const archiver = require("archiver");
  const { buildPayslipPdf } = require("../lib/payslip-pdf");
  const archive = archiver("zip", { zlib: { level: 9 } });
  const chunks = [];
  archive.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
  });
  for (const split of received) {
    const slip = {
      ...bundle.payslip,
      netSalary: split.amount,
      remainingBalance: split.amount,
      calculatedNet: split.amount,
      monthNotes: [bundle.payslip.monthNotes, `Payment split: ${fmtCurrency(split.amount)} EGP`].filter(Boolean).join("\n"),
    };
    const pdf = await buildPayslipPdf(slip, month, {
      bonusEvents: bundle.bonusEvents,
      deductionEvents: bundle.deductionEvents,
      attendanceRecords: bundle.attendanceRecords,
      config: bundle.config,
      employees: bundle.employees,
      payslipGateNotes: bundle.payslipGateNotes || [],
      splitLabel: `Split ${split.id}`,
    });
    archive.append(pdf, { name: `payslip-${emp.id}-${month}-split-${split.amount}.pdf` });
  }
  archive.finalize();
  const zip = await done;
  res
    .type("application/zip")
    .attachment(`payslip-splits-${emp.id}-${month}.zip`)
    .send(zip);
});

router.get("/exports/documents-zip", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const { employeeId, unit } = req.query;
  if (!employeeId && !unit) {
    return res.status(400).json({ error: "employeeId or unit required" });
  }
  if (employeeId) {
    const emp = store.getEmployeeById(employeeId);
    if (!assertEmployeeInCompanyContext(emp, req)) {
      return res.status(404).json({ error: "Employee not found" });
    }
  }
  if (unit && !unitInCompanyContext(unit, req)) {
    return res.status(404).json({ error: "Unit not found" });
  }
  try {
    const { buildDocumentsZip } = require("../lib/export-zip");
    const company = parseCompany(req);
    const zip = await buildDocumentsZip({ employeeId, unit, company });
    const label = employeeId || unit;
    res.type("application/zip").attachment(`documents-${label}.zip`).send(zip);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Rules content (editable per-company) ──────────────
router.get("/rules-content", async (req, res) => {
  if (!roles.canViewRules(req.userRole) && !roles.canEditRules(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  try {
    const company = req.query.company ? companyContext.parseCompanyContext(req.query.company) : parseCompany(req);
    if (!roles.canAccessRulesCompany(req.userRole, company)) {
      return res.status(403).json({ error: "No access to this company rules" });
    }
    const sections = await rulesRepo.readRulesContent(company);
    res.json({ company, sections });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/rules-content/:sectionKey", async (req, res) => {
  if (!roles.canEditRules(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  try {
    const company = req.body.company ? companyContext.parseCompanyContext(req.body.company) : parseCompany(req);
    if (!roles.canAccessRulesCompany(req.userRole, company)) {
      return res.status(403).json({ error: "No access to this company rules" });
    }
    const sectionKey = req.params.sectionKey;
    const section = await rulesRepo.upsertRulesContent(company, sectionKey, req.body, req.username);
    res.json({ ok: true, section });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Companies management ───────────────────────────────
router.get("/companies", async (req, res) => {
  if (!roles.canManageCompanies(req.userRole)) {
    return res.status(403).json({ error: "Admin only" });
  }
  try {
    const companies = await companiesRepo.readCompanies({ activeOnly: false });
    res.json({ companies });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/companies", async (req, res) => {
  if (!roles.canManageCompanies(req.userRole)) {
    return res.status(403).json({ error: "Admin only" });
  }
  const { slug, name, shortName, color, sortOrder } = req.body;
  if (!slug || !name) {
    return res.status(400).json({ error: "slug and name required" });
  }
  try {
    const company = await companiesRepo.createCompany({
      slug,
      name,
      shortName,
      color,
      sortOrder,
      createdBy: req.username,
    });
    res.json({ ok: true, company });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/companies/:slug", async (req, res) => {
  if (!roles.canManageCompanies(req.userRole)) {
    return res.status(403).json({ error: "Admin only" });
  }
  const { slug } = req.params;
  const { name, shortName, active, color, sortOrder } = req.body;
  try {
    const company = await companiesRepo.updateCompany(slug, {
      name,
      shortName,
      active,
      color,
      sortOrder,
    }, req.username);
    res.json({ ok: true, company });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Per-company access control overrides
router.get("/companies/:slug/permissions", async (req, res) => {
  if (!roles.canManageCompanies(req.userRole)) {
    return res.status(403).json({ error: "Admin only" });
  }
  try {
    const permCatalog = require("../lib/permission-catalog");
    const perms   = await companiesRepo.readCompanyPermissions(req.params.slug);
    const catalog  = permCatalog.listPermissions();
    res.json({ permissions: perms, catalog });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/companies/:slug/permissions", async (req, res) => {
  if (!roles.canManageCompanies(req.userRole)) {
    return res.status(403).json({ error: "Admin only" });
  }
  const { role, permissionKey, allowed } = req.body;
  if (!role || !permissionKey || allowed === undefined) {
    return res.status(400).json({ error: "role, permissionKey, and allowed are required" });
  }
  try {
    const perm = await companiesRepo.upsertCompanyPermission(
      req.params.slug, role, permissionKey, allowed, req.username
    );
    res.json({ ok: true, permission: perm });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/companies/:slug/permissions", async (req, res) => {
  if (!roles.canManageCompanies(req.userRole)) {
    return res.status(403).json({ error: "Admin only" });
  }
  const { role, permissionKey } = req.body;
  if (!role || !permissionKey) {
    return res.status(400).json({ error: "role and permissionKey required" });
  }
  try {
    await companiesRepo.deleteCompanyPermission(req.params.slug, role, permissionKey);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

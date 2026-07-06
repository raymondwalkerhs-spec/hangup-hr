const express = require("express");
const {
  fetchAuthUsers,
  validateLogin,
  checkSession,
} = require("../lib/auth");
const { createSession, getSession, destroySession, validateSession, updateSession } = require("../lib/session-store");
const { requireOnline, isOnline, verifyBackendAccess } = require("../lib/network");
const { getCacheDir } = require("../lib/cache");
const store = require("../lib/data-store");
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
} = require("../lib/attendance");
const { buildPayroll, calcPayrollRow, BONUS_TYPES, DEDUCTION_TYPES, bonusTypesForCompany } = require("../lib/payroll");
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
  const run = async () => {
    const session = sessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ error: "Not logged in" });
    }
    const valid = await validateSession(session.id);
    if (!valid) {
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
    const orgTeams = await roles.loadOrgTeamsForScope();
    req.userRole = roles.enrichUserRole(
      roles.resolveUserRole(effectiveUsername, valid.role),
      store.getEmployees(),
      empLinkId ? { employee_id: empLinkId } : null,
      orgTeams
    );
    req.userRole.username = effectiveUsername;
    if (!roles.hasAppAccess(req.userRole)) {
      destroySession(valid.id);
      return res.status(401).json({ error: "Access revoked. Contact Admin." });
    }
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
  const { config } = await resolvePayrollConfig(month);
  const rates = store.getPositionRates(month);
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
  let payslip = applyPayrollSplits(
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

  const { enrichPayrollRow, buildProgramPayrollDataForEmployees } = require("../lib/training-payroll");
  const { useSupabase } = require("../lib/backend");
  if (useSupabase()) {
    try {
      const trainingPhases = require("../lib/training-phases");
      const program = await trainingPhases.getProgram(emp.id);
      if (program) {
        const programPayrollByEmployee = buildProgramPayrollDataForEmployees(new Map([[emp.id, program]]), {
          getAttendance: (ym, id) => store.getAttendanceEvents(ym).filter((r) => r.employeeId === id),
          getBonuses: (ym, id) => store.getBonusEvents(ym, id),
          getDeductions: (ym, id) => store.getDeductionEvents(ym, id),
        });
        payslip = enrichPayrollRow(
          emp,
          payslip,
          {
            ym: month,
            config,
            rates,
            bonusEvents,
            deductionEvents,
            adjustment,
            attendanceRecords: records,
            commissionTiers,
            loans,
            loanPayments,
            actionPlans,
            payslipGateNotes: gate.payslipNotes || [],
            allPayrollSplits,
          },
          program,
          programPayrollByEmployee.get(emp.id)
        );
      }
    } catch (err) {
      console.warn(`training payroll enrich failed for ${emp.id}:`, err.message);
    }
  }

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

function payrollRowNet(p) {
  if (p?.payrollKind === "dual") return p.combinedNet ?? p.netSalary ?? 0;
  return p?.netSalary ?? 0;
}

function payrollRowBasic(p) {
  if (p?.payrollKind === "dual") return p.combinedBasic ?? p.basicSalary ?? 0;
  return p?.basicSalary ?? 0;
}

async function enrichPayrollWithTraining(payroll, employees, month, ctx) {
  const { useSupabase } = require("../lib/backend");
  if (!useSupabase()) return payroll;
  try {
    const trainingPhases = require("../lib/training-phases");
    const { enrichPayrollRows, buildProgramPayrollDataForEmployees } = require("../lib/training-payroll");
    const programs = await trainingPhases.loadProgramsForEmployees(employees.map((e) => e.id), {
      withSales: false,
    });
    const programPayrollByEmployee = buildProgramPayrollDataForEmployees(programs, {
      getAttendance: (ym, empId) => store.getAttendanceEvents(ym).filter((r) => r.employeeId === empId),
      getBonuses: (ym, empId) => store.getBonusEvents(ym, empId),
      getDeductions: (ym, empId) => store.getDeductionEvents(ym, empId),
    });
    return enrichPayrollRows(
      payroll,
      employees,
      {
        ym: month,
        ...ctx,
        actionPlans: ctx.actionPlans || [],
        attendanceByEmployee: ctx.attendanceMap,
        adjustments: ctx.adjustments || [],
      },
      programs,
      programPayrollByEmployee
    );
  } catch (err) {
    console.warn("training payroll batch enrich failed:", err.message);
    return payroll;
  }
}

async function loadProgramsForEmployees(employees) {
  const { useSupabase } = require("../lib/backend");
  if (!useSupabase()) return new Map();
  try {
    const trainingPhases = require("../lib/training-phases");
    return trainingPhases.loadProgramsForEmployees(employees.map((e) => e.id), { withSales: false });
  } catch {
    return new Map();
  }
}

async function buildEnrichedPayrollForMonth(month, req, { unit = "", hideOut } = {}) {
  const hide = hideOut ?? parseHideOut(req);
  let employees = store.getEmployeesForMonth(month, { hideOut: hide });
  employees = filterEmployeesForRequest(employees, req);
  if (unit) employees = employees.filter((e) => e.unit === unit);

  const { config, workingDays } = await resolvePayrollConfig(month);
  const rates = store.getPositionRates(month);
  const records = store.getAttendanceEvents(month);
  const bonusEvents = store.getBonusEvents(month);
  const deductionEvents = store.getDeductionEvents(month);
  const adjustments = store.getPayrollAdjustments(month);
  const attendanceMap = store.buildAttendanceMap(month);
  const { commissionTiers, loans, loanPayments } = store.getPayrollExtras(month);
  const allPayrollSplits = store.getAllPayrollSplits();
  const actionPlans = await loadActionPlansSafe();
  const actionPlansByEmployee = new Map();
  for (const p of actionPlans) {
    if (p.status !== "active") continue;
    if (!actionPlansByEmployee.has(p.employeeId)) actionPlansByEmployee.set(p.employeeId, []);
    actionPlansByEmployee.get(p.employeeId).push(p);
  }
  const recordsByEmployee = new Map();
  for (const r of records) {
    if (!recordsByEmployee.has(r.employeeId)) recordsByEmployee.set(r.employeeId, []);
    recordsByEmployee.get(r.employeeId).push(r);
  }

  const summaries = employees.map((emp) =>
    summarizeEmployeeMonth(
      emp,
      recordsByEmployee.get(emp.id) || [],
      config,
      actionPlansByEmployee.get(emp.id) || []
    )
  );

  let payroll = buildPayroll(
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
  payroll = await enrichPayrollWithTraining(payroll, employees, month, {
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
    actionPlans,
  });

  return {
    payroll,
    employees,
    config,
    workingDays,
    commissionTiers,
    allPayrollSplits,
    rates,
    bonusEvents,
    deductionEvents,
    adjustments,
    attendanceMap,
    loans,
    loanPayments,
    actionPlans,
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
    const normalizedRole = roles.normalizeRole(result.role);
    const userRole = normalizedRole;
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
    const session = createSession(result.user, password, normalizedRole, {
      deviceLabel: req.body.deviceLabel || "Desktop",
      ip: req.ip,
    });
    if (useSupabase()) {
      try {
        await hrms.revokeOtherSessionsForUser(result.user, session.id);
      } catch {
        /* non-fatal */
      }
    }
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

router.use("/registration", require("./registration"));

router.get("/session-check", async (req, res) => {
  const session = sessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: "Not logged in" });
  }
  try {
    const valid = await validateSession(session.id);
    if (!valid) {
      return res.json({ action: "session_revoked", message: "Session expired or signed in elsewhere." });
    }
    await requireOnline();
    const users = await fetchAuthUsers();
    const check = await checkSession(valid.username, valid.password, users);
    if (check.action === "uninstall") {
      destroySession(valid.id);
      return res.json({ action: "uninstall" });
    }
    if (check.action === "admin") {
      destroySession(valid.id);
      return res.json({ action: "admin", message: check.message });
    }
    if (check.role !== undefined) valid.role = check.role;
    if (!roles.hasAppAccess(roles.resolveUserRole(valid.username, valid.role))) {
      destroySession(valid.id);
      return res.json({ action: "admin", message: "Access removed. Contact Admin." });
    }
    const userRole = roles.resolveUserRole(valid.username, valid.role).role;
    const versionCheck = await loadVersionCheck(userRole);
    if (versionCheck.status === "blocked") {
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
    res.json(payload);
  } catch (err) {
    res.status(503).json({ error: err.message, offline: true });
  }
});

router.use(requireAuth);

// Badge still renders when sync is failing.
router.get("/status", async (req, res) => {
  let online = await isOnline();
  let backendOk = false;
  try {
    await Promise.race([
      verifyBackendAccess(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 6000)),
    ]);
    backendOk = true;
    online = true;
  } catch {
    /* keep online flag from probe */
  }
  const config = store.getConfig();
  let dropboxHealth = { configured: false };
  try {
    const dropbox = require("../lib/dropbox");
    dropboxHealth.configured = dropbox.isConfigured();
    if (dropbox.isConfigured() && roles.canManageAppUsers(req.realUsername || req.username)) {
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
  res.json({
    online,
    backendOk,
    live: true,
    dataBackend: "supabase",
    lastSync: store.getLastSync()?.toISOString() || null,
    hideOutEmployees: config.hideOutEmployees !== false,
    taxRules: config.taxRules || { incomeTaxRate: 0, socialInsuranceRate: 0 },
    canManageSessions: roles.canManageSessions(req.realUsername || req.username),
    canApproveLeave: roles.canApproveLeave(req.realUsername || req.username),
    user: {
      username: req.username,
      role: req.userRole.role,
      unit: req.userRole.unit,
      team: req.userRole.team,
      employeeId: req.userRole.employeeId,
      canManageUsers: roles.canManageAppUsersPerm(req.userRole, req.realUsername || req.username),
      canImpersonate: roles.canImpersonateUsers(req.realUsername || req.username),
      canApproveLeave: roles.canApproveLeave(req.realUsername || req.username),
      canManageSessions: roles.canManageSessions(req.realUsername || req.username),
      canViewPayroll: roles.canViewPayroll(req.userRole),
      canViewBonuses: roles.canViewBonusesDeductions(req.userRole),
      canEditAttendance: roles.canEditAttendance(req.userRole),
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
      canGrantSalesVisibility: roles.canGrantSalesVisibility(req.userRole),
      canManageSalesFieldPermissions: roles.canManageSalesFieldPermissions(req.userRole),
      canViewSalesAdmin: roles.canViewSalesAdmin(req.userRole),
      canManageAccessControl: roles.canManageAccessControl(req.userRole),
      canViewAgentPayslipNav: agentPayslipAvailable,
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
    const overrides = await rolePermissions.listOverrides();
    const effective = await rolePermissions.getEffectiveMatrix();
    res.json({ overrides, effective });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

router.put("/rbac/overrides", async (req, res) => {
  if (!assertAccessControlAdmin(req, res)) return;
  try {
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : req.body;
    if (!Array.isArray(entries)) {
      return res.status(400).json({ error: "Expected { entries: [...] }" });
    }
    const result = await rolePermissions.saveOverrides(entries, req.realUsername || req.username);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

router.post("/rbac/reset", async (req, res) => {
  if (!assertAccessControlAdmin(req, res)) return;
  try {
    const role = req.body?.role;
    if (!role) return res.status(400).json({ error: "role required" });
    const keys = Array.isArray(req.body?.permissionKeys) ? req.body.permissionKeys : null;
    const result = await rolePermissions.resetRole(role, keys);
    res.json({ ok: true, ...result });
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
    const employees = store.getEmployees();
    const empById = new Map(employees.map((e) => [e.id, e]));
    const users = (await usersAdmin.listAppUsers()).map((u) => {
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

router.use("/admin/users", require("./admin-users"));
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

const orgHierarchy = require("../lib/org-hierarchy");

router.get("/registration/daily-pin", async (req, res) => {
  if (!registration.canViewDailyPin(req.userRole?.role)) {
    return res.status(403).json({ error: "Not allowed" });
  }
  try {
    const pin = await registration.getOrCreateDailyPin();
    res.json(pin);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/registration/pending", async (req, res) => {
  if (!registration.canApproveRegistration(req.userRole?.role)) {
    return res.status(403).json({ error: "Not allowed" });
  }
  try {
    const pending = await registration.listPendingRegistrations();
    res.json({ pending });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/registration/:id/approve", async (req, res) => {
  if (!registration.canApproveRegistration(req.userRole?.role)) {
    return res.status(403).json({ error: "Not allowed" });
  }
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
  try {
    await registration.rejectRegistration(req.params.id, req.username);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/org/managers", async (_req, res) => {
  try {
    const managers = await orgHierarchy.readUnitManagers();
    res.json({ managers, unitRules: orgHierarchy.UNIT_RULES });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/org/managers/:unit", async (req, res) => {
  if (!roles.canManageOrgStructure(req.userRole)) return res.status(403).json({ error: "Admin/HR only" });
  try {
    await orgHierarchy.upsertUnitManager(req.params.unit, req.body || {}, req.username);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
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
    if (role === "AGENT") {
      if (!unit) return res.status(400).json({ error: "unit required for Agent role" });
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
  res.json({ suggestedId: store.suggestNextId(unit, backendPool) });
});

router.get("/employees/available-ids", (req, res) => {
  if (!roles.canManageEmployees(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const unit = String(req.query.unit || "").trim();
  if (!unit) return res.status(400).json({ error: "unit required" });
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

router.get("/employees", (req, res) => {
  const hideOut = parseHideOut(req);
  const companyContext = require("../lib/company-context");
  const employeePrivacy = require("../lib/employee-privacy");
  const company = companyContext.parseCompanyContext(req.query.company);
  const scopedAll = roles.filterEmployeesForUser(
    companyContext.filterEmployeesByCompany(store.getEmployees({ hideOut: false }), company),
    req.userRole
  );
  let employees = store.getEmployees({ hideOut });
  employees = companyContext.filterEmployeesByCompany(employees, company);
  employees = roles.filterEmployeesForUser(employees, req.userRole);
  employees = employeePrivacy.sanitizeEmployees(employees, req.userRole);
  if (roles.canViewEmployeeNotes(req.userRole)) {
    employees = employees.map((e) => ({
      ...e,
      hasWarnings: store.getEmployeeWarnings(e.id).length > 0,
    }));
  }
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
  if (!roles.canAccessEmployee(req.userRole, emp)) {
    return res.status(403).json({ error: "Not allowed" });
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

  if (isLockedDepartDay(emp, date)) {
    return res.status(400).json({ error: "Days after depart date are locked as OUT." });
  }

  const record = {
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
      fpNotes: r.fpNotes || "",
      leaveNote: r.leaveNote || r.fpNotes || "",
      isWeekendDefault: isWeekend(r.date) && r.status === "Day-OFF",
      transportOverride:
        roles.canViewTransportControls(req.userRole) && r.transportOverride
          ? r.transportOverride
          : "",
    });
  }

  const count = await store.saveAttendanceBatch(normalized, req.username);
  res.json({ ok: true, count });
});

router.get("/attendance/fp-rules/:month", async (req, res) => {
  if (!roles.canEditAttendance(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  const fpImport = require("../lib/attendance-fp-import");
  const config = store.getConfig();
  const rules = fpImport.getRulesForMonth(config, req.params.month);
  res.json({ month: req.params.month, rules, defaults: fpImport.DEFAULT_FP_RULES });
});

router.put("/attendance/fp-rules/:month", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const month = req.params.month;
  const config = store.getConfig();
  const byMonth = { ...(config.attendanceFpRulesByMonth || {}) };
  byMonth[month] = req.body.rules || req.body;
  await store.saveConfigKey("attendanceFpRulesByMonth", byMonth, req.username);
  res.json({ ok: true, month, rules: byMonth[month] });
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
    await assertMonthNotLocked(month);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  try {
    const fpImport = require("../lib/attendance-fp-import");
    const config = store.getConfig();
    const rules = fpImport.getRulesForMonth(config, month);
    const buffer = Buffer.from(base64, "base64");
    const existing = store.getAttendanceEvents(month);
    const result = fpImport.processImport({
      buffer,
      employees: store.getEmployees(),
      rules,
      month,
      existingRecords: existing,
      overwritePolicy: overwritePolicy || "skip_manual",
    });
    if (!dryRun && result.records.length) {
      const count = await store.saveAttendanceBatch(result.records, req.username);
      result.rowsApplied = count;
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

  const bundle = await buildEnrichedPayrollForMonth(month, req, { unit });
  const { payroll, workingDays, commissionTiers, allPayrollSplits, employees } = bundle;

  const {
    TRAINING_MONTHLY_SALARY,
    TRAINING_DAYS_PER_MONTH,
    TRAINING_DAILY_RATE,
    TRAINING_WEEKLY_SALARY,
  } = require("../lib/training-pay-rules");
  const { buildPayrollViews } = require("../lib/training-payroll");
  const { buildTotalPaidView } = require("../lib/payroll-schedule");

  const views = buildPayrollViews(payroll);
  const priorMonth = shiftMonth(month, -1);
  const priorBundle = await buildEnrichedPayrollForMonth(priorMonth, req, { unit });
  const programsByEmployee = await loadProgramsForEmployees(employees);
  const totalPaid = buildTotalPaidView(
    month,
    { [month]: payroll, [priorMonth]: priorBundle.payroll },
    allPayrollSplits,
    programsByEmployee
  );

  const monthLock = useSupabase() ? await hrms.getPayrollMonthLock(month) : null;
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
    bonusTypes: bonusTypesForCompany(req.query.company),
    deductionTypes: DEDUCTION_TYPES,
    commissionTypes: store.getCommissionTypes(),
    commissionTiers,
    payrollStatuses: PROFILE_STATUSES,
    totals: views.agent.totals,
  });
});

router.get("/payroll/pdf", async (req, res) => {
  if (!roles.canViewPayroll(req.userRole)) {
    return res.status(403).json({ error: "No permission to view payroll" });
  }
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const unit = req.query.unit || "";
  const scope = (req.query.scope || "agent").toLowerCase();

  const bundle = await buildEnrichedPayrollForMonth(month, req, { unit });
  const { buildPayrollViews } = require("../lib/training-payroll");
  const { buildTotalPaidView } = require("../lib/payroll-schedule");
  const views = buildPayrollViews(bundle.payroll);

  let payrollRows = views.agent.rows;
  let totals = views.agent.totals;
  if (scope === "training") {
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

  const { buildPayrollTablePdf } = require("../lib/pdf-export");
  const pdf = await buildPayrollTablePdf(payrollRows, month, { totalNet: totals.totalNet });
  const suffix = scope === "agent" ? "" : `-${scope}`;
  res.type("application/pdf").attachment(`payroll-${month}${suffix}.pdf`).send(pdf);
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
  } else if (!roles.canAccessEmployee(req.userRole, emp)) {
    return res.status(403).json({ error: "No access" });
  }

  const bundle = await loadEmployeePayslipBundle(emp, month);
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
    bonusTypes: bonusTypesForCompany(req.query.company),
    deductionTypes: DEDUCTION_TYPES,
    commissionTypes: store.getCommissionTypes(),
    commissionTiers: store.getPayrollExtras(month).commissionTiers,
    payslipGateNotes: bundle.payslipGateNotes || [],
    viewOnly: agentSelf,
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
    types: bonusTypesForCompany(req.query.company),
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

  const allowedTypes = bonusTypesForCompany(
    companyContext.isInHs2Scope(emp) ? "hs2" : req.query.company
  );
  if (!allowedTypes.includes(bonusType)) {
    return res.status(400).json({ error: `Bonus type not allowed for this employee: ${bonusType}` });
  }

  try {
    await assertMonthNotLocked(String(date).slice(0, 7));
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
  const empIds = new Set(employees.map((e) => e.id));
  deductions = deductions.filter((d) => empIds.has(d.employeeId));
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
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  res.json({ month, rates: store.getPositionRates(month) });
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
  if (!roles.canViewSettingsSection(req.userRole, "hideOut")) {
    return res.status(403).json({ error: "No permission to change hide-out setting" });
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
    noPayroll: req.body.noPayroll === true,
    payslipVisibleToAgent: req.body.payslipVisibleToAgent === true,
    salesCount: Number(req.body.salesCount) || 0,
  };
  const saved = await store.upsertPayrollAdjustment(record, req.username);
  res.json({ ok: true, adjustment: saved });
});

router.post("/payroll-adjustments/:employeeId/recalc-sales-count", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
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

async function getSplitValidationContext(employeeId, yearMonth, excludeSplitId = null, options = {}) {
  const splitKind = options.splitKind || "payment";
  const emp = store.getEmployeeById(employeeId);
  if (!emp) return null;
  const allPayrollSplits = store.getAllPayrollSplits();
  const splitMaps = buildSplitMaps(allPayrollSplits, yearMonth);
  const { filterTrainingSplits, filterAgentSplits, resolvePayslipFromBundle } = require("../lib/training-payroll");

  if (splitKind === "training_payroll" || splitKind === "training_bonus") {
    const bundle = await loadEmployeePayslipBundle(emp, yearMonth);
    const trainingSlip = resolvePayslipFromBundle({ payslip: bundle.payslip }, "training");
    if (!trainingSlip) return null;
    const splitsForMonth = filterTrainingSplits(splitMaps.byEmployeeMonth.get(employeeId) || []);
    const deferredIn = filterTrainingSplits(splitMaps.deferredIn.get(employeeId) || []);
    const calculatedNet =
      trainingSlip.calculatedNet ??
      trainingSlip.netSalary + (trainingSlip.receivedTotal || 0) + (trainingSlip.deferredOut || 0);
    return buildValidationContext(calculatedNet, splitsForMonth, deferredIn, excludeSplitId);
  }

  const { config, workingDays } = await resolvePayrollConfig(yearMonth);
  const rates = store.getPositionRates(yearMonth);
  const records = store.getAttendanceEvents(yearMonth).filter((r) => r.employeeId === employeeId);
  const bonusEvents = store.getBonusEvents(yearMonth, employeeId);
  const deductionEvents = store.getDeductionEvents(yearMonth, employeeId);
  const adjustment = store.getPayrollAdjustment(yearMonth, employeeId);
  const actionPlans = await loadActionPlansSafe();
  const gate = await payrollGates.getPayrollBlockers(employeeId, yearMonth, emp).catch(() => ({ payslipNotes: [] }));
  const summary = summarizeEmployeeMonth(
    emp,
    records,
    config,
    actionPlans.filter((p) => p.employeeId === employeeId && p.status === "active")
  );
  const { commissionTiers, loans, loanPayments } = store.getPayrollExtras(yearMonth);
  const raw = calcPayrollRow(
    emp,
    summary,
    yearMonth,
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
  );
  const splitsForMonth = filterAgentSplits(splitMaps.byEmployeeMonth.get(employeeId) || []);
  const deferredIn = filterAgentSplits(splitMaps.deferredIn.get(employeeId) || []);
  return buildValidationContext(raw.netSalary, splitsForMonth, deferredIn, excludeSplitId);
}

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
  const rates = store.getPositionRates(month);
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
  if (!roles.canAccessEmployee(req.userRole, emp)) {
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
  const dispatch = require("../lib/notify-dispatch");
  await dispatch.dispatchNotification({
    actionKey: "employee_note_created",
    type: "employee_note",
    title: "Employee note added",
    body: `${employeeId}: ${title || type || "Note"}`,
    entityType: "employee_note",
    entityId: String(saved.id || employeeId),
    actor: req.username,
    context: { extraUsernames: [] },
  });
  res.json({ ok: true, warning: saved });
});

router.put("/warnings/:id", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  try {
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
    await store.deleteEmployeeWarning(req.params.id, req.username);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/quality-notes/:employeeId", async (req, res) => {
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!roles.canAccessEmployee(req.userRole, emp)) {
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
    const dispatch = require("../lib/notify-dispatch");
    await dispatch.dispatchNotification({
      actionKey: "quality_note_created",
      type: "quality_note",
      title: "Quality note on agent",
      body: `${employeeId}: ${String(body).slice(0, 80)}`,
      entityType: "quality_note",
      entityId: note.id,
      actor: req.username,
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
    if (!emp || !roles.canAccessEmployee(req.userRole, emp)) {
      return res.status(403).json({ error: "No access" });
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
    if (!emp || !roles.canAccessEmployee(req.userRole, emp)) {
      return res.status(403).json({ error: "No access" });
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
  const { position, monthlySalary, yearMonth } = req.body;
  const month = yearMonth || req.query.month || new Date().toISOString().slice(0, 7);
  if (!position || monthlySalary == null) {
    return res.status(400).json({ error: "position and monthlySalary required" });
  }
  try {
    const rate = await store.upsertPositionRate(position, Number(monthlySalary), req.username, month);
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
  const inUse = store.getEmployees().some((e) => e.position === position);
  if (inUse) {
    return res.status(400).json({ error: `Position "${position}" is assigned to employees` });
  }
  try {
    await store.deletePositionRate(position, req.username, month);
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

router.get("/documents/:employeeId/:docId/file", async (req, res) => {
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!roles.canAccessEmployee(req.userRole, emp)) {
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
  const rates = store.getPositionRates(month);
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
  const rates = store.getPositionRates(month);
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
  const scope = (req.query.scope || "agent").toLowerCase();

  const bundle = await buildEnrichedPayrollForMonth(month, req);
  const { buildPayrollViews } = require("../lib/training-payroll");
  const views = buildPayrollViews(bundle.payroll);
  const payroll =
    scope === "training" ? views.training.rows : scope === "total" ? views.agent.rows : views.agent.rows;
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
  if (!roles.canAccessEmployee(req.userRole, emp)) {
    return res.status(403).json({ error: "No access" });
  }

  const bundle = await loadEmployeePayslipBundle(emp, month);
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
  if (!roles.canAccessEmployee(req.userRole, emp)) {
    return res.status(403).json({ error: "No access" });
  }
  const bundle = await loadEmployeePayslipBundle(emp, month);
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

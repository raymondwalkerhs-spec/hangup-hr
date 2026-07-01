const express = require("express");
const {
  fetchAuthUsers,
  validateLogin,
  checkSession,
} = require("../lib/auth-sheet");
const { createSession, getSession, destroySession } = require("../lib/session-store");
const { requireOnline, isOnline, verifyGoogleSheetsAccess } = require("../lib/network");
const { resolveCredentialsPath } = require("../lib/google-auth");
const { getCacheDir } = require("../lib/cache");
const store = require("../lib/data-store");
const roles = require("../lib/roles");
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

const router = express.Router();

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
  req.userRole = roles.resolveUserRole(session.username);
  req.userRole.username = session.username;
  next();
}

function parseHideOut(req) {
  if (req.query.showOut === "true") return false;
  if (req.query.hideOut === "false") return false;
  return store.getConfig().hideOutEmployees !== false;
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
    const result = validateLogin(username, password, users);
    if (!result.ok) {
      if (result.terminated) {
        return res.status(403).json({ error: "terminated", terminated: true });
      }
      if (result.reason === "inactive") {
        return res.status(403).json({ error: "Account inactive. Contact Admin." });
      }
      return res.status(401).json({ error: "Invalid username or password" });
    }
    const session = createSession(result.user, result.password);
    req.session.appSessionId = session.id;
    res.json({
      ok: true,
      sessionId: session.id,
      username: result.user,
    });
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
    const check = checkSession(session.username, session.password, users);
    if (check.action === "uninstall") {
      destroySession(session.id);
      return res.json({ action: "uninstall" });
    }
    if (check.action === "admin") {
      destroySession(session.id);
      return res.json({ action: "admin", message: check.message });
    }
    res.json({ action: "ok", username: session.username });
  } catch (err) {
    res.status(503).json({ error: err.message, offline: true });
  }
});

router.use(requireAuth);

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

router.use(async (req, res, next) => {
  if (/\/employees\/[^/]+\/avatar$/.test(req.path)) {
    return next();
  }
  try {
    await requireOnline();
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

router.get("/status", async (req, res) => {
  let online = await isOnline();
  let sheetsOk = false;
  try {
    await verifyGoogleSheetsAccess();
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
    lastSync: store.getLastSync()?.toISOString() || null,
    hideOutEmployees: config.hideOutEmployees !== false,
    user: {
      username: req.username,
      role: req.userRole.role,
      unit: req.userRole.unit,
    },
    sheetId: store.SHEET_ID,
    authSheetId: require("../lib/auth-sheet").AUTH_SHEET_ID,
    credentialsPath: resolveCredentialsPath(),
    cacheDir: getCacheDir(),
  });
});

router.get("/meta/teams", (req, res) => {
  const unit = req.query.unit || "";
  const teams = unit ? store.getTeams(unit) : [];
  res.json({ teams, units: store.getUnits() });
});

router.get("/employees/next-id", (req, res) => {
  const { unit, backendPool } = req.query;
  if (!unit) return res.status(400).json({ error: "unit required" });
  res.json({ suggestedId: store.suggestNextId(unit, backendPool) });
});

router.get("/employees", (req, res) => {
  const hideOut = parseHideOut(req);
  let employees = store.getEmployees({ hideOut });
  employees = roles.filterEmployeesForUser(employees, req.userRole);
  const units = store.getUnits();
  const positions = [
    ...new Set(employees.map((e) => e.position).filter(Boolean)),
  ].sort();
  res.json({
    employees,
    units,
    positions,
    statuses: store.EMPLOYEE_STATUSES.filter(Boolean),
    hideOutEmployees: hideOut,
    backendPools: Object.keys(store.BACKEND_POOLS),
  });
});

router.get("/employees/:employeeId/avatar", async (req, res) => {
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).end();
  if (!roles.canAccessUnit(req.userRole, emp.unit)) {
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

router.get("/employees/:id", (req, res) => {
  if (req.params.id === "next-id") return res.status(404).json({ error: "Not found" });
  const emp = store.getEmployeeById(req.params.id);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!roles.canAccessUnit(req.userRole, emp.unit)) {
    return res.status(403).json({ error: "No access to this unit" });
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
    const emp = await store.updateEmployee(req.params.id, { status }, req.username);
    res.json({ ok: true, employee: emp });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/attendance", async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const unit = req.query.unit || "";
  const team = req.query.team || "";
  const hideOut = parseHideOut(req);

  let employees = store.getEmployees({ hideOut });
  employees = roles.filterEmployeesForUser(employees, req.userRole);
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

  const summaries = employees.map((emp) =>
    summarizeEmployeeMonth(
      emp,
      monthRecords.filter((r) => r.employeeId === emp.id),
      config
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
  if (!roles.canAccessUnit(req.userRole, emp.unit)) {
    return res.status(403).json({ error: "No access to this unit" });
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
    if (!roles.canAccessUnit(req.userRole, emp.unit)) continue;
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
  const { month } = req.body;
  const hideOut = store.getConfig().hideOutEmployees !== false;
  let employees = store.getEmployees({ hideOut });
  employees = roles.filterEmployeesForUser(employees, req.userRole);
  const existing = store.getAttendanceEvents(month);
  const skeleton = buildMonthSkeleton(employees, month, existing);
  const weekendOnly = skeleton.filter((r) => r.isWeekendDefault);
  const count = await store.initMonthWeekends(weekendOnly, req.username);
  res.json({ ok: true, count });
});

router.patch("/attendance/bulk-weekdays", async (req, res) => {
  if (!roles.canEditAttendance(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  const { month, status, unit, team } = req.body;
  const hideOut = store.getConfig().hideOutEmployees !== false;
  let employees = store.getEmployees({ hideOut, unit, team });
  employees = roles.filterEmployeesForUser(employees, req.userRole);
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

  let employees = store.getEmployees({ hideOut });
  employees = roles.filterEmployeesForUser(employees, req.userRole);
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
  res.json({
    month,
    payroll,
    workingDays,
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

  let employees = store.getEmployees({ hideOut });
  employees = roles.filterEmployeesForUser(employees, req.userRole);
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
  if (!roles.canViewPayroll(req.userRole)) {
    return res.status(403).json({ error: "No permission to view payroll" });
  }
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!roles.canAccessUnit(req.userRole, emp.unit)) {
    return res.status(403).json({ error: "No access" });
  }

  const config = store.getConfig();
  const rates = store.getPositionRates();
  const records = store.getAttendanceEvents(month).filter(
    (r) => r.employeeId === emp.id
  );
  const bonusEvents = store.getBonusEvents(month, emp.id);
  const deductionEvents = store.getDeductionEvents(month, emp.id);
  const adjustment = store.getPayrollAdjustment(month, emp.id);
  const summary = summarizeEmployeeMonth(emp, records, config);
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
      loanPayments
    ),
    splitMaps.byEmployeeMonth.get(emp.id) || [],
    splitMaps.deferredIn.get(emp.id) || []
  );
  res.json({
    month,
    payslip,
    splits: payslip.splits || [],
    splitKinds: SPLIT_KINDS,
    splitStatuses: SPLIT_STATUSES.filter((s) => s !== "cancelled"),
    employee: emp,
    adjustment,
    bonuses: bonusEvents,
    deductions: deductionEvents,
    attendance: records,
    bonusTypes: BONUS_TYPES,
    deductionTypes: DEDUCTION_TYPES,
    commissionTypes: store.getCommissionTypes(),
    commissionTiers,
  });
});

router.get("/bonuses", (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const employeeId = req.query.employeeId || "";
  res.json({
    bonuses: store.getBonusEvents(month, employeeId || undefined),
    types: BONUS_TYPES,
  });
});

router.post("/bonuses", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const { employeeId, date, amount, reason, type, unit } = req.body;
  if (!employeeId || !date || amount == null) {
    return res.status(400).json({ error: "employeeId, date, amount required" });
  }
  const emp = store.getEmployeeById(employeeId);
  await store.upsertBonus(
    {
      employeeId,
      date,
      amount: Number(amount),
      reason,
      type: type || "Other Bonus",
      unit: unit || emp?.unit || "",
    },
    req.username
  );
  res.json({ ok: true });
});

router.delete("/bonuses", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const { employeeId, date, type } = req.body;
  if (!employeeId || !date || !type) {
    return res.status(400).json({ error: "employeeId, date, type required" });
  }
  await store.deleteBonus(employeeId, date, type, req.username);
  res.json({ ok: true });
});

router.get("/deductions", (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const employeeId = req.query.employeeId || "";
  res.json({
    deductions: store.getDeductionEvents(month, employeeId || undefined),
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

router.delete("/deductions", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const { employeeId, date, type } = req.body;
  if (!employeeId || !date || !type) {
    return res.status(400).json({ error: "employeeId, date, type required" });
  }
  await store.deleteDeduction(employeeId, date, type, req.username);
  res.json({ ok: true });
});

router.get("/position-rates", (req, res) => {
  res.json({ rates: store.getPositionRates() });
});

router.get("/changelog", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
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
  const { employeeId, date, type, title, content, severity } = req.body;
  if (!employeeId || !content) {
    return res.status(400).json({ error: "employeeId and content required" });
  }
  const saved = await store.addEmployeeWarning(
    { employeeId, date, type, title, content, severity },
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

router.get("/commission-types", (req, res) => {
  res.json({ types: store.getCommissionTypes() });
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

router.get("/documents/:employeeId", (req, res) => {
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!roles.canAccessUnit(req.userRole, emp.unit)) {
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
  const { employeeId, docType, fileName, contentBase64, notes, expiry } = req.body;
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
    const saved = await store.uploadEmployeeDocument(uploaded, req.username);
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
  let employees = store.getEmployees({ hideOut });
  employees = roles.filterEmployeesForUser(employees, req.userRole);

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
  let employees = store.getEmployees({ hideOut });
  employees = roles.filterEmployeesForUser(employees, req.userRole);

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
  if (!roles.canViewPayroll(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const method = (req.query.method || "all").toLowerCase();
  const format = req.query.format || "json";
  const hideOut = parseHideOut(req);

  let employees = store.getEmployees({ hideOut });
  employees = roles.filterEmployeesForUser(employees, req.userRole);
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
  const { buildPaymentExports, toCsv } = require("../lib/bank-export");
  const exports = buildPaymentExports(payroll, employees);
  let data = exports;
  if (method === "cash") data = { cash: exports.cash };
  else if (method === "bank") data = { bank: exports.bank };
  else if (method === "insta") data = { insta: exports.insta };

  if (format === "csv" && method !== "all") {
    const key = method === "cash" ? "cash" : method === "bank" ? "bank" : "insta";
    const cols =
      key === "cash"
        ? [
            { key: "serial", label: "Serial" },
            { key: "employeeId", label: "ID" },
            { key: "name", label: "Name" },
            { key: "netSalary", label: "Salary" },
            { key: "roundedSalary", label: "NEW SALARY" },
            { key: "americanName", label: "Name ( American )" },
          ]
        : key === "bank"
          ? [
              { key: "employeeId", label: "ID" },
              { key: "name", label: "Name" },
              { key: "netSalary", label: "Net Salary" },
              { key: "bankReference", label: "Bank Reference" },
              { key: "bankName", label: "Bank Name" },
            ]
          : [
              { key: "employeeId", label: "ID" },
              { key: "name", label: "Name" },
              { key: "netSalary", label: "Net Salary" },
              { key: "instaDetails", label: "Payment Details" },
            ];
    res.type("text/csv").attachment(`${key}-${month}.csv`).send(toCsv(exports[key], cols));
    return;
  }
  res.json({ month, ...data });
});

router.get("/payslip/:employeeId/pdf", async (req, res) => {
  if (!roles.canViewPayroll(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const emp = store.getEmployeeById(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });

  const config = store.getConfig();
  const rates = store.getPositionRates();
  const records = store.getAttendanceEvents(month).filter((r) => r.employeeId === emp.id);
  const adjustment = store.getPayrollAdjustment(month, emp.id);
  const summary = summarizeEmployeeMonth(emp, records, config);
  const { commissionTiers, loans, loanPayments } = store.getPayrollExtras(month);
  const allPayrollSplits = store.getAllPayrollSplits();
  const payslip = calcPayrollRow(
    emp,
    summary,
    month,
    config,
    rates,
    store.getBonusEvents(month, emp.id),
    store.getDeductionEvents(month, emp.id),
    adjustment,
    records,
    commissionTiers,
    loans,
    loanPayments,
    allPayrollSplits
  );
  const { buildPayslipPdf } = require("../lib/payslip-pdf");
  const pdf = await buildPayslipPdf(payslip, month);
  res
    .type("application/pdf")
    .attachment(`payslip-${emp.id}-${month}.pdf`)
    .send(pdf);
});

module.exports = router;

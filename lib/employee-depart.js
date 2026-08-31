const hrms = require("./hrms-repo");
const { buildAutoOutRecordsAfterDepart } = require("./depart-attendance");

/** Local calendar YYYY-MM-DD (not UTC) — avoids Egypt early-morning drift. */
function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function resolveDepartDate(value) {
  const s = String(value || "").trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return todayIso();
}

function isOutAttendanceStatus(status) {
  const s = String(status || "").trim();
  return s === "OUT" || s === "OUT BUT STILL GET PAID";
}

function mapAttendanceOutToEmployeeStatus(status) {
  return String(status || "").toUpperCase().includes("STILL GET PAID")
    ? "OUT BUT STILL GET PAID"
    : "Out";
}

function mapDepartBodyStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s === "out_still_paid" || s === "out but still get paid") return "OUT BUT STILL GET PAID";
  return "Out";
}

function normalizeNoticeType(noticeType) {
  const s = String(noticeType || "").toLowerCase().replace(/\s+/g, "_");
  if (
    s === "without_notice" ||
    s === "no_notice" ||
    s === "left_without_two_weeks_notice" ||
    s === "without_2_weeks_notice"
  ) {
    return "without_notice";
  }
  if (
    s === "company_decision" ||
    s === "company" ||
    s === "company_terminated" ||
    s === "left_company_decision"
  ) {
    return "company_decision";
  }
  return "with_notice";
}

/**
 * No longer materializes ~24 months of OUT rows (was freezing the app).
 * Post-depart days are painted virtually via applyDepartAutoOut + isLockedDepartDay.
 * Kept as a no-op for call-site compatibility; clearPostDepartAutoOut still cleans legacy rows.
 */
async function persistDepartAutoOut(_employeeId, _departDate, _store, _username, _opts = {}) {
  return 0;
}

async function executeEmployeeDepart(employeeId, departDateInput, options = {}, ctx = {}) {
  const store = ctx.store || require("./data-store");
  const username = ctx.username || "system";
  const departDate = resolveDepartDate(departDateInput);
  const emp = store.getEmployeeById(employeeId);
  if (!emp) throw new Error("Employee not found");

  const notice = normalizeNoticeType(options.notice_type);
  const statusLabel = options.statusLabel || mapDepartBodyStatus(options.status);

  const currentDepart = String(emp.depart_date || "").slice(0, 10);
  const currentNotice = normalizeNoticeType(emp.notice_type);
  const { isOutStatus } = require("./employee-status");
  if (
    isOutStatus(emp.status) &&
    currentDepart === departDate &&
    currentNotice === notice &&
    String(emp.status) === statusLabel
  ) {
    return {
      ok: true,
      departDate,
      notice_type: notice,
      deductions: [],
      transportDeductions: [],
      noticePayScale: null,
      passedSalesInNotice: 0,
      loginDisabled: null,
      autoOutCount: 0,
      shortCircuited: true,
    };
  }

  await hrms.closeEmploymentPeriod(employeeId, departDate, username);
  await store.updateEmployee(
    employeeId,
    { status: statusLabel, depart_date: departDate, notice_type: notice },
    username
  );

  let loginDisabled = null;
  let loginWarning = null;
  try {
    const loginSync = require("./employee-login-sync");
    loginDisabled = await loginSync.disableLoginForDepartedEmployee(employeeId, username);
    loginWarning = loginSync.loginDisableWarning(loginDisabled);
  } catch (loginErr) {
    console.warn("[employee-depart] disable login failed:", loginErr.message);
    loginWarning = loginErr.message || "Login deactivation failed";
  }

  let payroll = null;
  try {
    const { applyDepartPayrollRules } = require("./departure-payroll");
    payroll = await applyDepartPayrollRules(
      { ...emp, depart_date: departDate, notice_type: notice },
      departDate,
      notice,
      store,
      username
    );
  } catch (payErr) {
    console.warn("[employee-depart] depart payroll rules failed:", payErr.message);
  }

  // Virtual lock + paint only — do not await multi-month attendance writes.
  const autoOutCount = 0;

  return {
    ok: true,
    departDate,
    notice_type: notice,
    deductions: payroll?.deductions || [],
    transportDeductions: payroll?.transportDeductions || [],
    noticePayScale: payroll?.scale || null,
    passedSalesInNotice: payroll?.passedSalesInNotice || 0,
    loginDisabled,
    loginWarning,
    autoOutCount,
  };
}

/**
 * When attendance is set to OUT on a date, treat that date as depart_date and
 * lock all later days as OUT until re-hire.
 * options.departDate overrides the cell date when the user picked a different leaving date.
 */
async function syncDepartFromAttendanceOut(employeeId, date, emp, username, store, attendanceStatus = "OUT", options = {}) {
  const cellDate = String(date || "").slice(0, 10);
  const override = String(options.departDate || "").slice(0, 10);
  const departDate =
    /^\d{4}-\d{2}-\d{2}$/.test(override) ? override : cellDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(departDate)) {
    return { updated: false, departDate: null };
  }

  const currentDepart = String(emp?.depart_date || "").slice(0, 10);
  const force = options.force === true;
  const shouldUpdateDepart = force || !currentDepart || departDate <= currentDepart || options.departDate;

  if (!shouldUpdateDepart) {
    return { updated: false, departDate: currentDepart };
  }

  let statusLabel = mapAttendanceOutToEmployeeStatus(attendanceStatus);
  if (options.status === "out_still_paid" || options.status === "OUT BUT STILL GET PAID") {
    statusLabel = "OUT BUT STILL GET PAID";
  } else if (options.status === "out" || options.status === "Out") {
    statusLabel = "Out";
  }

  const result = await executeEmployeeDepart(
    employeeId,
    departDate,
    {
      status: statusLabel === "OUT BUT STILL GET PAID" ? "out_still_paid" : "out",
      statusLabel,
      notice_type: options.notice_type || emp?.notice_type || "with_notice",
    },
    { store, username }
  );

  return { updated: true, departDate: result.departDate, autoOutCount: result.autoOutCount };
}

async function syncDepartFromAttendanceBatch(records, username, store) {
  const outByEmp = new Map();
  for (const r of records || []) {
    if (!r.confirmDepart || !isOutAttendanceStatus(r.status)) continue;
    const d = String(r.departDate || r.date || "").slice(0, 10);
    const prev = outByEmp.get(r.employeeId);
    if (!prev || d < prev.date) {
      outByEmp.set(r.employeeId, {
        date: d,
        status: r.status,
        notice_type: r.notice_type,
        departDate: r.departDate,
        formStatus: r.departStatus,
      });
    }
  }
  const results = [];
  for (const [employeeId, info] of outByEmp) {
    const emp = store.getEmployeeById(employeeId);
    if (!emp) continue;
    results.push(
      await syncDepartFromAttendanceOut(employeeId, info.date, emp, username, store, info.status, {
        notice_type: info.notice_type,
        departDate: info.departDate,
        status: info.formStatus,
      })
    );
  }
  return results;
}

async function clearPostDepartAutoOut(employeeId, departDate, store, username) {
  const depart = String(departDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(depart)) return 0;
  const records = buildAutoOutRecordsAfterDepart(employeeId, depart, 24);
  if (!records.length) return 0;

  const backendMod = require("./backend");
  let count = 0;
  for (const r of records) {
    if (backendMod.useSupabase()) {
      const backend = require("./supabase-repo");
      await backend.deleteAttendanceEvent(employeeId, r.date);
    }
    require("./cache").deleteAttendanceRecord(employeeId, r.date);
    await require("./changelog").logAttendanceChange(username, "delete", r, "OUT");
    count += 1;
  }
  return count;
}

/**
 * Undo a mistaken depart: clear depart_date, reopen employment period, remove auto OUT days.
 */
async function clearEmployeeDepart(employeeId, ctx = {}) {
  const store = ctx.store || require("./data-store");
  const username = ctx.username || "system";
  const hrms = require("./hrms-repo");
  const emp = store.getEmployeeById(employeeId);
  if (!emp) throw new Error("Employee not found");

  const oldDepart = String(emp.depart_date || "").slice(0, 10);
  if (!oldDepart && String(emp.status || "").toLowerCase() !== "out") {
    return { ok: true, cleared: false, reason: "no_depart_date" };
  }

  await hrms.reopenEmploymentPeriod(employeeId, username);
  await store.updateEmployee(
    employeeId,
    { status: "Active", depart_date: null },
    username
  );

  const clearedOutCount = oldDepart
    ? await clearPostDepartAutoOut(employeeId, oldDepart, store, username)
    : 0;

  let loginEnabled = null;
  try {
    const usersAdmin = require("./users-admin");
    const loginSync = require("./employee-login-sync");
    const loginUsername = await loginSync.findLoginUsernameForEmployee(employeeId);
    if (loginUsername) {
      const existing = await usersAdmin.getAppUser(loginUsername);
      if (existing && String(existing.status || "").toLowerCase() === "inactive") {
        await usersAdmin.updateAppUser(loginUsername, { status: "active" }, username, {
          skipActivateGate: true,
        });
        loginEnabled = loginUsername;
      }
    }
  } catch (loginErr) {
    console.warn("[employee-depart] re-enable login failed:", loginErr.message);
  }

  return { ok: true, cleared: true, departDate: oldDepart, clearedOutCount, loginEnabled };
}

module.exports = {
  todayIso,
  resolveDepartDate,
  isOutAttendanceStatus,
  mapAttendanceOutToEmployeeStatus,
  mapDepartBodyStatus,
  normalizeNoticeType,
  persistDepartAutoOut,
  executeEmployeeDepart,
  syncDepartFromAttendanceOut,
  syncDepartFromAttendanceBatch,
  clearPostDepartAutoOut,
  clearEmployeeDepart,
};

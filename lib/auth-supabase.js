const bcrypt = require("bcrypt");
const { getSupabaseAdmin } = require("./supabase-client");
const { isPasswordSnapshotValid } = require("./session-store");
const { authDebug, authDebugError } = require("./auth-debug");

const AUTH_SHEET_ID = process.env.SUPABASE_URL || "supabase";
const BCRYPT_ROUNDS = 12;

function db() {
  return getSupabaseAdmin();
}

async function fetchAuthUsers() {
  authDebug("fetchAuthUsers.start");
  let { data, error } = await db()
    .from("app_users")
    .select("username, password_hash, status, role, password_changed_at");
  if (error && /password_changed_at/i.test(error.message)) {
    authDebug("fetchAuthUsers.fallback_no_password_changed_at", { error: error.message });
    ({ data, error } = await db()
      .from("app_users")
      .select("username, password_hash, status, role"));
  }
  if (error) {
    authDebugError("fetchAuthUsers", error);
    throw new Error(`Auth users: ${error.message}`);
  }
  const users = (data || []).map((r) => ({
    user: r.username,
    password: r.password_hash,
    status: r.status,
    role: r.role || "",
    passwordIsHash: true,
    passwordChangedAt: r.password_changed_at || null,
  }));
  authDebug("fetchAuthUsers.ok", { count: users.length });
  return users;
}

async function validateLogin(username, password, users) {
  authDebug("validateLogin.start", { username, userCount: users?.length });
  const record = users.find((u) => u.user.toLowerCase() === username.toLowerCase());
  if (!record) {
    authDebug("validateLogin.fail", { username, reason: "user_not_found" });
    return { ok: false, reason: "invalid" };
  }

  const valid = record.passwordIsHash
    ? await bcrypt.compare(password, record.password)
    : record.password === password;
  if (!valid) {
    authDebug("validateLogin.fail", { username: record.user, reason: "bad_password" });
    return { ok: false, reason: "invalid" };
  }

  const status = record.status.toLowerCase();
  if (status === "terminated") {
    authDebug("validateLogin.fail", { username: record.user, reason: "terminated" });
    return { ok: false, reason: "terminated", terminated: true };
  }
  if (status === "inactive") {
    authDebug("validateLogin.fail", { username: record.user, reason: "inactive" });
    return { ok: false, reason: "inactive" };
  }
  if (status === "active") {
    // Defense: Out employees with a depart date cannot keep using an active login
    try {
      const store = require("./data-store");
      const loginSync = require("./employee-login-sync");
      const usersAdmin = require("./users-admin");
      const appUser = await usersAdmin.getAppUser(record.user).catch(() => null);
      const empId = appUser?.employeeId || appUser?.employee_id || record.user;
      const emp = store.getEmployeeById?.(empId);
      if (emp && loginSync.shouldDisableLoginForEmployee(emp)) {
        authDebug("validateLogin.fail", { username: record.user, reason: "employee_departed" });
        loginSync.disableLoginForDepartedEmployee(emp.id, "login-guard").catch(() => {});
        return { ok: false, reason: "inactive" };
      }
    } catch {
      /* non-fatal — auth continues if employee cache unavailable */
    }
    authDebug("validateLogin.ok", { username: record.user, role: record.role, status: record.status });
    return {
      ok: true,
      user: record.user,
      status: record.status,
      password: record.password,
      role: record.role || "",
      passwordIsHash: record.passwordIsHash,
      passwordChangedAt: record.passwordChangedAt || null,
    };
  }
  authDebug("validateLogin.fail", { username: record.user, reason: "unknown_status", status });
  return { ok: false, reason: "unknown_status" };
}

function checkSessionByUserRecord(sessionUser, users, passwordChangedAtSnapshot) {
  authDebug("checkSessionByUserRecord.start", { username: sessionUser });
  const record = users.find((u) => u.user.toLowerCase() === sessionUser.toLowerCase());
  if (!record) {
    authDebug("checkSessionByUserRecord.admin", { username: sessionUser, reason: "user_removed" });
    return { action: "admin", message: "Your account was removed. Contact Admin." };
  }
  const status = String(record.status || "").toLowerCase();
  if (status === "terminated") {
    authDebug("checkSessionByUserRecord.uninstall", { username: sessionUser });
    return { action: "uninstall" };
  }
  if (status !== "active") {
    authDebug("checkSessionByUserRecord.admin", { username: sessionUser, reason: "not_active", status });
    return { action: "admin", message: "Your access was changed. Contact Admin." };
  }
  if (!isPasswordSnapshotValid(passwordChangedAtSnapshot, record.passwordChangedAt)) {
    authDebug("checkSessionByUserRecord.admin", {
      username: sessionUser,
      reason: "password_changed",
      snapshot: passwordChangedAtSnapshot,
      dbChangedAt: record.passwordChangedAt,
    });
    return { action: "admin", message: "Your password was changed. Sign in again." };
  }
  authDebug("checkSessionByUserRecord.ok", { username: sessionUser, role: record.role });
  return { action: "ok", role: record.role || "" };
}

/** @deprecated use checkSessionByUserRecord */
async function checkSession(sessionUser, sessionPassword, users) {
  const record = users.find((u) => u.user.toLowerCase() === sessionUser.toLowerCase());
  if (!record) {
    return { action: "admin", message: "Your account was removed. Contact Admin." };
  }
  const status = record.status.toLowerCase();
  if (status === "terminated") return { action: "uninstall" };

  const valid = record.passwordIsHash
    ? await bcrypt.compare(sessionPassword, record.password)
    : record.password === sessionPassword;

  if (status !== "active" || !valid) {
    return { action: "admin", message: "Your access was changed. Contact Admin." };
  }
  return { action: "ok", role: record.role || "" };
}

module.exports = {
  AUTH_SHEET_ID,
  BCRYPT_ROUNDS,
  fetchAuthUsers,
  validateLogin,
  checkSession,
  checkSessionByUserRecord,
};

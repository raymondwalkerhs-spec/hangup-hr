const bcrypt = require("bcrypt");
const { getSupabaseAdmin } = require("./supabase-client");

const AUTH_SHEET_ID = process.env.SUPABASE_URL || "supabase";

function db() {
  return getSupabaseAdmin();
}

async function fetchAuthUsers() {
  const { data, error } = await db()
    .from("app_users")
    .select("username, password_hash, status, role");
  if (error) throw new Error(`Auth users: ${error.message}`);
  return (data || []).map((r) => ({
    user: r.username,
    password: r.password_hash,
    status: r.status,
    role: r.role || "",
    passwordIsHash: true,
  }));
}

async function validateLogin(username, password, users) {
  const record = users.find((u) => u.user.toLowerCase() === username.toLowerCase());
  if (!record) return { ok: false, reason: "invalid" };

  const valid = record.passwordIsHash
    ? await bcrypt.compare(password, record.password)
    : record.password === password;
  if (!valid) return { ok: false, reason: "invalid" };

  const status = record.status.toLowerCase();
  if (status === "terminated") return { ok: false, reason: "terminated", terminated: true };
  if (status === "inactive") return { ok: false, reason: "inactive" };
  if (status === "active") {
    return {
      ok: true,
      user: record.user,
      status: record.status,
      password: record.password,
      role: record.role || "",
      passwordIsHash: record.passwordIsHash,
    };
  }
  return { ok: false, reason: "unknown_status" };
}

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
  fetchAuthUsers,
  validateLogin,
  checkSession,
};

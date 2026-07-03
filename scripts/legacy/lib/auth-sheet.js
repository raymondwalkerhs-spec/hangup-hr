const { getSheetsAuth, getSheetsClient } = require("./google-auth");

const AUTH_SHEET_ID =
  process.env.AUTH_SHEET_ID || "1i4KR3e_jNtPMTSDFnbpS7kYzExqEyA0CgLlaZg5KoF8";
const AUTH_SHEET_TAB = process.env.AUTH_SHEET_TAB || "";

function authSheetRange() {
  // Read the full row so an optional Role column (and any future columns) is picked up.
  return AUTH_SHEET_TAB ? `'${AUTH_SHEET_TAB}'!A:Z` : "A:Z";
}

async function fetchAuthUsers() {
  const auth = await getSheetsAuth();
  const sheets = getSheetsClient(auth);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: AUTH_SHEET_ID,
    range: authSheetRange(),
  });
  const rows = res.data.values || [];
  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => String(h).trim());
  const userCol = headers.findIndex((h) => h.toLowerCase() === "user");
  const passCol = headers.findIndex((h) => h.toLowerCase() === "password");
  const statusCol = headers.findIndex((h) => h.toLowerCase() === "status");
  // Optional per-user role column. Accept a few common header names.
  const roleCol = headers.findIndex((h) =>
    ["role", "permission", "permissions", "access", "access level"].includes(h.toLowerCase())
  );

  if (userCol < 0 || passCol < 0 || statusCol < 0) {
    throw new Error("Auth sheet must have columns: User, Password, status");
  }

  return rows.slice(1).map((row) => ({
    user: String(row[userCol] || "").trim(),
    password: String(row[passCol] || ""),
    status: String(row[statusCol] || "").trim(),
    role: roleCol >= 0 ? String(row[roleCol] || "").trim() : "",
  })).filter((r) => r.user);
}

function validateLogin(username, password, users) {
  const record = users.find(
    (u) => u.user.toLowerCase() === username.toLowerCase()
  );
  if (!record || record.password !== password) {
    return { ok: false, reason: "invalid" };
  }
  const status = record.status.toLowerCase();
  if (status === "terminated") {
    return { ok: false, reason: "terminated", terminated: true };
  }
  if (status === "inactive") {
    return { ok: false, reason: "inactive" };
  }
  if (status === "active") {
    return {
      ok: true,
      user: record.user,
      status: record.status,
      password: record.password,
      role: record.role || "",
    };
  }
  return { ok: false, reason: "unknown_status" };
}

function checkSession(sessionUser, sessionPassword, users) {
  const record = users.find(
    (u) => u.user.toLowerCase() === sessionUser.toLowerCase()
  );
  if (!record) {
    return { action: "admin", message: "Your account was removed. Contact Admin." };
  }
  const status = record.status.toLowerCase();
  if (status === "terminated") {
    return { action: "uninstall" };
  }
  if (status !== "active" || record.password !== sessionPassword) {
    return {
      action: "admin",
      message: "Your access was changed. Contact Admin.",
    };
  }
  return { action: "ok", role: record.role || "" };
}

module.exports = {
  AUTH_SHEET_ID,
  fetchAuthUsers,
  validateLogin,
  checkSession,
};

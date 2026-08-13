/** Auth/login tracing — set HR_AUTH_DEBUG=1 in .env (on by default in dev). */

function isAuthDebug() {
  const v = String(process.env.HR_AUTH_DEBUG || "").trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  // Default ON in unpackaged/dev so login failures show in the terminal.
  try {
    const { app } = require("electron");
    if (app?.isPackaged) return false;
  } catch {
    /* not electron */
  }
  return true;
}

function maskSessionId(id) {
  const s = String(id || "").trim();
  if (!s) return "(none)";
  if (s.length <= 10) return s;
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

function maskUsername(name) {
  const s = String(name || "").trim();
  if (!s) return "(empty)";
  if (s.length <= 2) return "*".repeat(s.length);
  return `${s[0]}${"*".repeat(Math.max(1, s.length - 2))}${s[s.length - 1]}`;
}

function authDebug(step, detail = {}) {
  if (!isAuthDebug()) return;
  const safe = { ...detail };
  if (safe.sessionId) safe.sessionId = maskSessionId(safe.sessionId);
  if (safe.username) safe.username = maskUsername(safe.username);
  if (safe.password) safe.password = "(redacted)";
  if (safe.currentPassword) safe.currentPassword = "(redacted)";
  if (safe.newPassword) safe.newPassword = "(redacted)";
  const extra = Object.keys(safe).length ? ` ${JSON.stringify(safe)}` : "";
  console.log(`[auth-debug] ${step}${extra}`);
}

function authDebugError(step, err, detail = {}) {
  const msg = err?.message || String(err || "unknown error");
  if (!isAuthDebug()) {
    console.error(`[auth] ${step}: ${msg}`);
    return;
  }
  const safe = { ...detail, error: msg };
  if (safe.sessionId) safe.sessionId = maskSessionId(safe.sessionId);
  if (safe.username) safe.username = maskUsername(safe.username);
  console.error(`[auth-debug] ${step} FAILED ${JSON.stringify(safe)}`);
  if (err?.stack) console.error(err.stack);
}

module.exports = {
  isAuthDebug,
  maskSessionId,
  maskUsername,
  authDebug,
  authDebugError,
};

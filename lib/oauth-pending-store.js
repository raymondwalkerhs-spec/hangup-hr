/**
 * In-memory bridge for Google OAuth when the browser redirects to the local
 * Electron HTTP server (external browser → 127.0.0.1 → poll from the app window).
 */
let pending = null;

function beginOauth(mode) {
  const m = mode === "link" ? "link" : "cold";
  pending = { mode: m, code: null, error: null, startedAt: Date.now() };
  return pending;
}

function completeOauthFromCallback({ code, error, mode, syncLinked } = {}) {
  const m = mode === "link" || mode === "cold" ? mode : pending?.mode || "cold";
  const errText = error ? String(error) : null;
  const already =
    Boolean(syncLinked) ||
    (errText && /already linked/i.test(errText));
  pending = {
    mode: m,
    code: code ? String(code).trim() : null,
    // "already linked" is recoverable — surface as syncLinked, not a hard error
    error: already ? null : errText,
    syncLinked: already,
    startedAt: pending?.startedAt || Date.now(),
    completedAt: Date.now(),
  };
  return pending;
}

function pollOauth(maxAgeMs = 5 * 60 * 1000) {
  if (!pending) return { pending: true };
  if (Date.now() - (pending.startedAt || 0) > maxAgeMs) {
    pending = null;
    return { pending: true, expired: true };
  }
  if (pending.code || pending.error || pending.syncLinked) {
    const out = {
      pending: false,
      code: pending.code || null,
      error: pending.error || null,
      syncLinked: Boolean(pending.syncLinked),
      mode: pending.mode || "cold",
    };
    pending = null;
    return out;
  }
  return { pending: true, mode: pending.mode || "cold" };
}

function getPendingMode() {
  return pending?.mode || null;
}

module.exports = {
  beginOauth,
  completeOauthFromCallback,
  pollOauth,
  getPendingMode,
};

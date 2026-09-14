/**
 * In-memory bridge for Google OAuth when the browser redirects to the local
 * Electron HTTP server (external browser → 127.0.0.1 → poll from the app window).
 *
 * Poll peeks without clearing — call clearOauthPending() only after login/link succeeds
 * so a failed exchange can retry with the same code.
 */
let pending = null;

function beginOauth(mode) {
  const m = mode === "link" ? "link" : "cold";
  pending = {
    mode: m,
    code: null,
    error: null,
    syncLinked: false,
    codeVerifier: null,
    codeVerifierStorageKey: null,
    startedAt: Date.now(),
    receivedAt: null,
  };
  return pending;
}

function setOauthCodeVerifier(storageKey, value) {
  if (!pending) return;
  pending.codeVerifierStorageKey = storageKey || null;
  pending.codeVerifier = value || null;
}

function getOauthCodeVerifier() {
  if (!pending?.codeVerifier) return null;
  return {
    key: pending.codeVerifierStorageKey || null,
    value: pending.codeVerifier,
  };
}

function completeOauthFromCallback({ code, error, mode, syncLinked } = {}) {
  const m = mode === "link" || mode === "cold" ? mode : pending?.mode || "cold";
  const errText = error ? String(error) : null;
  const already =
    Boolean(syncLinked) ||
    (errText && /already linked/i.test(errText));
  const prev = pending || { startedAt: Date.now() };
  pending = {
    mode: m,
    code: code ? String(code).trim() : null,
    error: already ? null : errText,
    syncLinked: already,
    codeVerifier: prev.codeVerifier || null,
    codeVerifierStorageKey: prev.codeVerifierStorageKey || null,
    startedAt: prev.startedAt || Date.now(),
    receivedAt: Date.now(),
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
    return {
      pending: false,
      code: pending.code || null,
      error: pending.error || null,
      syncLinked: Boolean(pending.syncLinked),
      mode: pending.mode || "cold",
      receivedAt: pending.receivedAt || null,
    };
  }
  return { pending: true, mode: pending.mode || "cold" };
}

function clearOauthPending() {
  pending = null;
}

function getPendingMode() {
  return pending?.mode || null;
}

function getPendingSnapshot() {
  if (!pending) return null;
  return {
    mode: pending.mode,
    hasCode: Boolean(pending.code),
    hasError: Boolean(pending.error),
    syncLinked: Boolean(pending.syncLinked),
    startedAt: pending.startedAt,
    receivedAt: pending.receivedAt || null,
  };
}

module.exports = {
  beginOauth,
  setOauthCodeVerifier,
  getOauthCodeVerifier,
  completeOauthFromCallback,
  pollOauth,
  clearOauthPending,
  getPendingMode,
  getPendingSnapshot,
};

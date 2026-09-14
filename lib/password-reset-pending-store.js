/**
 * Short-lived tokens after Authenticator OTP succeeds on forgot-password.
 * Default TTL: 2 minutes — then user must verify a new OTP.
 */
const crypto = require("crypto");

const DEFAULT_TTL_MS = 2 * 60 * 1000;
/** @type {Map<string, { username: string, expiresAt: number }>} */
const pending = new Map();

function pruneExpired() {
  const now = Date.now();
  for (const [token, row] of pending.entries()) {
    if (!row || row.expiresAt <= now) pending.delete(token);
  }
}

function createResetToken(username, ttlMs = DEFAULT_TTL_MS) {
  pruneExpired();
  const name = String(username || "").trim();
  if (!name) throw new Error("Username required");
  // One active reset per username — invalidate older tokens.
  for (const [token, row] of pending.entries()) {
    if (String(row.username || "").toLowerCase() === name.toLowerCase()) {
      pending.delete(token);
    }
  }
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + Math.max(1_000, Number(ttlMs) || DEFAULT_TTL_MS);
  pending.set(token, { username: name, expiresAt });
  return {
    resetToken: token,
    expiresAt,
    expiresInSec: Math.max(1, Math.floor((expiresAt - Date.now()) / 1000)),
  };
}

function peekResetToken(resetToken) {
  pruneExpired();
  const token = String(resetToken || "").trim();
  if (!token) return null;
  const row = pending.get(token);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    pending.delete(token);
    return null;
  }
  return {
    username: row.username,
    expiresAt: row.expiresAt,
    expiresInSec: Math.max(1, Math.floor((row.expiresAt - Date.now()) / 1000)),
  };
}

function consumeResetToken(resetToken) {
  const peeked = peekResetToken(resetToken);
  if (!peeked) return null;
  pending.delete(String(resetToken || "").trim());
  return peeked;
}

function invalidateResetToken(resetToken) {
  pending.delete(String(resetToken || "").trim());
}

module.exports = {
  DEFAULT_TTL_MS,
  createResetToken,
  peekResetToken,
  consumeResetToken,
  invalidateResetToken,
};

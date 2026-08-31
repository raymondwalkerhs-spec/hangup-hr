/**
 * In-memory Idempotency-Key cache (TTL). Process-local; enough for double-tap guards.
 */
const DEFAULT_TTL_MS = 60_000;
const store = new Map();

function prune(now = Date.now()) {
  for (const [key, entry] of store.entries()) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}

function getCached(key) {
  if (!key) return null;
  prune();
  const entry = store.get(String(key));
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(String(key));
    return null;
  }
  return entry.value;
}

function setCached(key, value, ttlMs = DEFAULT_TTL_MS) {
  if (!key) return;
  prune();
  store.set(String(key), {
    value,
    expiresAt: Date.now() + Math.max(1000, ttlMs),
  });
}

function idempotencyKeyFromReq(req) {
  const h = req?.headers || {};
  return (
    h["idempotency-key"] ||
    h["Idempotency-Key"] ||
    h["x-idempotency-key"] ||
    null
  );
}

module.exports = {
  getCached,
  setCached,
  idempotencyKeyFromReq,
  DEFAULT_TTL_MS,
};

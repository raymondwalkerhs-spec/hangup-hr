const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const buckets = new Map();

function keyFor(req, prefix) {
  const sid = req.sessionID || req.ip || "anonymous";
  return `${prefix}:${sid}`;
}

function hit(k) {
  const now = Date.now();
  let b = buckets.get(k);
  if (!b || now - b.windowStart > WINDOW_MS) {
    b = { count: 1, windowStart: now };
    buckets.set(k, b);
    return false;
  }
  b.count += 1;
  return b.count > MAX_ATTEMPTS;
}

function remaining(k) {
  const b = buckets.get(k);
  if (!b) return MAX_ATTEMPTS;
  const now = Date.now();
  if (now - b.windowStart > WINDOW_MS) return MAX_ATTEMPTS;
  return Math.max(0, MAX_ATTEMPTS - b.count);
}

function prune() {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.windowStart > WINDOW_MS) buckets.delete(k);
  }
}

setInterval(prune, 60 * 1000);

module.exports = {
  checkLogin(req) {
    const k = keyFor(req, "login");
    if (hit(k)) return { limited: true, remaining: 0 };
    return { limited: false, remaining: remaining(k) };
  },
  checkVerifyPin(req) {
    const k = keyFor(req, "pin");
    if (hit(k)) return { limited: true, remaining: 0 };
    return { limited: false, remaining: remaining(k) };
  },
  checkBackupAction(req) {
    const k = keyFor(req, "backup");
    if (hit(k)) return { limited: true, remaining: 0 };
    return { limited: false, remaining: remaining(k) };
  },
  middleware(checkFn) {
    return (req, res, next) => {
      const result = checkFn(req);
      if (result.limited) {
        return res.status(429).json({ error: "Too many attempts. Try again later.", limited: true });
      }
      res.set("X-RateLimit-Remaining", String(result.remaining));
      next();
    };
  },
};

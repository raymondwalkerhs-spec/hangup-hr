/**
 * Short-lived opaque token after registration code verification (no company exposed to client).
 */
const crypto = require("crypto");

const TTL_MS = 30 * 60 * 1000;

function secret() {
  return (
    process.env.REGISTRATION_TOKEN_SECRET ||
    process.env.SESSION_SECRET ||
    "hangup-registration-token-dev"
  );
}

function createRegistrationToken(company) {
  const co = String(company || "hangup").trim().toLowerCase() === "hs2" ? "hs2" : "hangup";
  const exp = Date.now() + TTL_MS;
  const payload = `${co}:${exp}`;
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

function verifyRegistrationToken(token) {
  if (!token) return null;
  try {
    const raw = Buffer.from(String(token), "base64url").toString("utf8");
    const lastColon = raw.lastIndexOf(":");
    if (lastColon < 0) return null;
    const sig = raw.slice(lastColon + 1);
    const body = raw.slice(0, lastColon);
    const secondColon = body.indexOf(":");
    if (secondColon < 0) return null;
    const company = body.slice(0, secondColon);
    const exp = Number(body.slice(secondColon + 1));
    if (!Number.isFinite(exp) || Date.now() > exp) return null;
    const expected = crypto.createHmac("sha256", secret()).update(body).digest("hex");
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return company === "hs2" ? "hs2" : "hangup";
  } catch {
    return null;
  }
}

module.exports = { createRegistrationToken, verifyRegistrationToken, TTL_MS };

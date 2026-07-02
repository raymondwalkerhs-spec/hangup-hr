/** Session store — in-memory cache + optional Supabase persistence */
const hrms = require("./hrms-repo");
const { useSupabase } = require("./backend");

const sessions = new Map();

function createSession(username, password, role = "", meta = {}) {
  const id = require("crypto").randomBytes(32).toString("hex");
  const session = {
    id,
    username,
    password,
    role,
    deviceLabel: meta.deviceLabel || "Desktop",
    ip: meta.ip || null,
    createdAt: Date.now(),
  };
  sessions.set(id, session);
  if (useSupabase()) {
    hrms.upsertAppSession(session).catch(() => {});
  }
  return session;
}

function getSession(id) {
  return sessions.get(id) || null;
}

async function validateSession(id) {
  const s = getSession(id);
  if (!s) return null;
  if (useSupabase()) {
    try {
      const revoked = await hrms.isSessionRevoked(id);
      if (revoked) {
        destroySession(id);
        return null;
      }
      hrms.touchAppSession(id).catch(() => {});
    } catch {
      /* keep in-memory session */
    }
  }
  return s;
}

function destroySession(id) {
  sessions.delete(id);
  if (useSupabase()) {
    hrms.revokeAppSession(id).catch(() => {});
  }
}

module.exports = { createSession, getSession, destroySession, validateSession };

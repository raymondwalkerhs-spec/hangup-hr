/** Session store — in-memory cache + optional Supabase persistence */
const hrms = require("./hrms-repo");
const { useSupabase } = require("./backend");

const IDLE_MS = 10 * 60 * 60 * 1000;
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
      const row = await hrms.getAppSessionRow(id);
      if (!row || row.revoked_at) {
        destroySession(id);
        return null;
      }
      const lastSeen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : s.createdAt || Date.now();
      if (Date.now() - lastSeen > IDLE_MS) {
        await hrms.revokeAppSession(id);
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

function destroySessionsForUser(username) {
  const target = String(username || "").trim().toLowerCase();
  if (!target) return 0;
  let count = 0;
  for (const [id, session] of sessions.entries()) {
    if (String(session.username || "").trim().toLowerCase() === target) {
      destroySession(id);
      count += 1;
    }
  }
  return count;
}

function updateSession(id, patch) {
  const s = sessions.get(id);
  if (!s) return null;
  Object.assign(s, patch);
  sessions.set(id, s);
  return s;
}

module.exports = { createSession, getSession, destroySession, destroySessionsForUser, validateSession, updateSession };

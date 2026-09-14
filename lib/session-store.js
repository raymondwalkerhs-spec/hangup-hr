/** Session store — in-memory cache + optional Supabase persistence */
const hrms = require("./hrms-repo");
const { useSupabase } = require("./backend");
const { authDebug, authDebugError } = require("./auth-debug");

const IDLE_MS = 10 * 60 * 60 * 1000;
const sessions = new Map();

function normalizeChangedAt(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function isPasswordSnapshotValid(snapshot, dbChangedAt) {
  const snap = normalizeChangedAt(snapshot);
  const dbAt = normalizeChangedAt(dbChangedAt);
  if (!dbAt && !snap) return true;
  if (!dbAt || !snap) return false;
  return dbAt === snap;
}

function createSession(username, role = "", meta = {}) {
  const id = require("crypto").randomBytes(32).toString("hex");
  const sessionKind = meta.sessionKind === "pending_setup" ? "pending_setup" : "full";
  const session = {
    id,
    username,
    role,
    passwordChangedAtSnapshot: normalizeChangedAt(meta.passwordChangedAtSnapshot),
    deviceLabel: meta.deviceLabel || "Desktop",
    ip: meta.ip || null,
    sessionKind,
    authUserId: meta.authUserId || null,
    loginMethod: meta.loginMethod || "password",
    // In-memory only — never persisted to app_sessions
    supabaseAccessToken: meta.supabaseAccessToken || null,
    supabaseRefreshToken: meta.supabaseRefreshToken || null,
    createdAt: Date.now(),
    lastSupabaseOkAt: Date.now(),
  };
  sessions.set(id, session);
  authDebug("createSession", {
    sessionId: id,
    username,
    role,
    deviceLabel: session.deviceLabel,
    sessionKind,
    loginMethod: session.loginMethod,
  });
  if (useSupabase()) {
    hrms.upsertAppSession(session).catch((err) => {
      authDebugError("createSession.upsertAppSession", err, { sessionId: id, username });
    });
  }
  return session;
}

function getSession(id) {
  return sessions.get(id) || null;
}

async function validateSession(id) {
  const s = getSession(id);
  if (!s) {
    authDebug("validateSession.miss", { sessionId: id, reason: "not_in_memory" });
    return null;
  }
  if (useSupabase()) {
    try {
      let row = await hrms.getAppSessionRow(id);
      if (row?.revoked_at) {
        authDebug("validateSession.revoked", { sessionId: id, username: s.username });
        destroySession(id);
        return null;
      }
      if (!row) {
        // C1 race: createSession used to fire-and-forget upsert; keep session if row is still missing
        authDebug("validateSession.upsert_missing_row", { sessionId: id, username: s.username });
        try {
          await hrms.upsertAppSession(s);
          row = await hrms.getAppSessionRow(id);
        } catch (upsertErr) {
          authDebugError("validateSession.upsert_missing_row", upsertErr, {
            sessionId: id,
            username: s.username,
          });
        }
      }
      if (row?.revoked_at) {
        authDebug("validateSession.revoked_after_upsert", { sessionId: id, username: s.username });
        destroySession(id);
        return null;
      }
      if (!row) {
        // M2-style grace: in-memory session is enough until Supabase catches up
        authDebug("validateSession.ok_memory_only", { sessionId: id, username: s.username });
        return s;
      }
      const lastSeen = row.last_seen_at
        ? new Date(row.last_seen_at).getTime()
        : s.createdAt || Date.now();
      if (Date.now() - lastSeen > IDLE_MS) {
        authDebug("validateSession.idle_timeout", {
          sessionId: id,
          username: s.username,
          idleMs: Date.now() - lastSeen,
        });
        await hrms.revokeAppSession(id);
        destroySession(id);
        return null;
      }
      let dbChangedAt = null;
      try {
        dbChangedAt = await hrms.getAppUserPasswordChangedAt(s.username);
      } catch (err) {
        // Migration not applied yet — treat as null (legacy valid with null snapshot)
        if (!/password_changed_at/i.test(err?.message || "")) throw err;
        authDebug("validateSession.password_changed_at_missing", { username: s.username });
        dbChangedAt = null;
      }
      if (!isPasswordSnapshotValid(s.passwordChangedAtSnapshot, dbChangedAt)) {
        authDebug("validateSession.password_snapshot_mismatch", {
          sessionId: id,
          username: s.username,
          snapshot: s.passwordChangedAtSnapshot,
          dbChangedAt,
        });
        destroySession(id);
        return null;
      }
      s.lastSupabaseOkAt = Date.now();
      hrms.touchAppSession(id).catch((err) => {
        authDebugError("validateSession.touchAppSession", err, { sessionId: id });
      });
      authDebug("validateSession.ok", { sessionId: id, username: s.username });
    } catch (err) {
      authDebugError("validateSession.grace_keep_memory", err, { sessionId: id, username: s.username });
    }
  } else {
    authDebug("validateSession.ok_local", { sessionId: id, username: s.username });
  }
  return s;
}

function destroySession(id) {
  const had = sessions.has(id);
  sessions.delete(id);
  authDebug("destroySession", { sessionId: id, hadInMemory: had });
  if (useSupabase()) {
    hrms.revokeAppSession(id).catch((err) => {
      authDebugError("destroySession.revokeAppSession", err, { sessionId: id });
    });
  }
}

function destroySessionsForUser(username, exceptSessionId = null) {
  const target = String(username || "").trim().toLowerCase();
  if (!target) return 0;
  let count = 0;
  for (const [id, session] of sessions.entries()) {
    if (exceptSessionId && id === exceptSessionId) continue;
    if (String(session.username || "").trim().toLowerCase() === target) {
      destroySession(id);
      count += 1;
    }
  }
  return count;
}

/** Soft-gate all live sessions after admin MFA/Google clear (plan: force re-setup). */
function demoteSessionsForUser(username) {
  const target = String(username || "").trim().toLowerCase();
  if (!target) return 0;
  let count = 0;
  for (const [id, session] of sessions.entries()) {
    if (String(session.username || "").trim().toLowerCase() !== target) continue;
    session.sessionKind = "pending_setup";
    sessions.set(id, session);
    count += 1;
    if (useSupabase()) {
      hrms.upsertAppSession(session).catch((err) => {
        authDebugError("demoteSessionsForUser.upsert", err, { sessionId: id, username: target });
      });
    }
  }
  return count;
}

function updateSessionsRoleForUser(username, role) {
  const target = String(username || "").trim().toLowerCase();
  const nextRole = String(role || "").trim();
  if (!target || !nextRole) return 0;
  let count = 0;
  for (const session of sessions.values()) {
    if (String(session.username || "").trim().toLowerCase() === target) {
      session.role = nextRole;
      count += 1;
    }
  }
  return count;
}

function updateSession(id, patch) {
  const s = sessions.get(id);
  if (!s) return null;
  if (patch.passwordChangedAtSnapshot !== undefined) {
    patch.passwordChangedAtSnapshot = normalizeChangedAt(patch.passwordChangedAtSnapshot);
  }
  Object.assign(s, patch);
  sessions.set(id, s);
  return s;
}

module.exports = {
  createSession,
  getSession,
  destroySession,
  destroySessionsForUser,
  demoteSessionsForUser,
  updateSessionsRoleForUser,
  validateSession,
  updateSession,
  isPasswordSnapshotValid,
  normalizeChangedAt,
};

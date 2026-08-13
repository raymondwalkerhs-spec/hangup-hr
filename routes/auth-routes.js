const express = require("express");
const bcrypt = require("bcrypt");
const roles = require("../lib/roles");
const usersAdmin = require("../lib/users-admin");
const hrms = require("../lib/hrms-repo");
const { getSession, destroySession, updateSession } = require("../lib/session-store");
const { fetchAuthUsers, BCRYPT_ROUNDS } = require("../lib/auth");

const { authDebug, authDebugError } = require("../lib/auth-debug");

const router = express.Router();
const MIN_PASSWORD_LENGTH = 8;

router.put("/change-password", async (req, res) => {
  authDebug("change-password.start", { username: req.appSession?.username });
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || String(newPassword).length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Current and new password (min ${MIN_PASSWORD_LENGTH} chars) required` });
  }

  const session = req.appSession;
  const users = await fetchAuthUsers();
  const record = users.find((u) => u.user.toLowerCase() === session.username.toLowerCase());
  if (!record) return res.status(400).json({ error: "User not found" });

  const valid = record.passwordIsHash
    ? await bcrypt.compare(String(currentPassword), record.password)
    : record.password === currentPassword;
  if (!valid) {
    authDebug("change-password.fail", { username: session.username, reason: "bad_current_password" });
    return res.status(400).json({ error: "Current password is incorrect" });
  }

  try {
    const updated = await usersAdmin.updateAppUser(
      session.username,
      { password: newPassword },
      session.username,
      { keepSessionId: session.id }
    );
    const warnings = [];
    try {
      await hrms.revokeOtherSessionsForUser(session.username, session.id);
      authDebug("change-password.revoke_other_sessions.ok", { username: session.username });
    } catch (err) {
      warnings.push("sessions_revoke_failed");
      authDebugError("change-password.revokeOtherSessions", err, { username: session.username });
    }
    updateSession(session.id, {
      passwordChangedAtSnapshot: updated.passwordChangedAt || new Date().toISOString(),
    });
    authDebug("change-password.ok", { username: session.username, sessionId: session.id });
    res.json({ ok: true, warnings: warnings.length ? warnings : undefined });
  } catch (e) {
    authDebugError("change-password.exception", e, { username: session.username });
    res.status(400).json({ error: e.message });
  }
});

router.get("/sessions", async (req, res) => {
  if (!roles.canManageSessions(req.username)) {
    return res.status(403).json({ error: "System administrator only" });
  }
  try {
    const sessions = await hrms.listAppSessions();
    res.json({ sessions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/sessions/:id/revoke", async (req, res) => {
  if (!roles.canManageSessions(req.username)) {
    return res.status(403).json({ error: "System administrator only" });
  }
  try {
    await hrms.revokeAppSession(req.params.id);
    destroySession(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;

const express = require("express");
const bcrypt = require("bcrypt");
const roles = require("../lib/roles");
const usersAdmin = require("../lib/users-admin");
const hrms = require("../lib/hrms-repo");
const { getSession, destroySession } = require("../lib/session-store");
const { useSupabase } = require("../lib/backend");

const router = express.Router();

router.put("/change-password", async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || String(newPassword).length < 4) {
    return res.status(400).json({ error: "Current and new password (min 4 chars) required" });
  }
  if (!useSupabase()) return res.status(503).json({ error: "Requires Supabase backend" });

  const session = req.appSession;
  const valid = await bcrypt.compare(currentPassword, session.password);
  if (!valid) return res.status(400).json({ error: "Current password is incorrect" });

  try {
    await usersAdmin.updateAppUser(session.username, { password: newPassword }, session.username);
    session.password = await bcrypt.hash(String(newPassword), 10);
    res.json({ ok: true });
  } catch (e) {
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

const express = require("express");
const path = require("path");
const fs = require("fs");
const { fetchAuthUsers, validateLogin } = require("../lib/auth");
const { createSession, destroySession, validateSession } = require("../lib/session-store");
const { requireOnline } = require("../lib/network");
const roles = require("../lib/roles");
const backupJobs = require("../lib/backup-jobs");
const backupService = require("../lib/backup-service");
const rateLimiter = require("../lib/rate-limiter");

const router = express.Router();
const BACKUP_ROLES = new Set(["admin", "rtm"]);

function canUseBackupApp(role) {
  return BACKUP_ROLES.has(String(role || "").trim().toLowerCase());
}

function sessionFromRequest(req) {
  const header = req.headers["x-session-id"];
  if (header) return String(header).trim();
  return req.session?.backupSessionId || null;
}

async function requireBackupAuth(req, res, next) {
  const id = sessionFromRequest(req);
  if (!id) return res.status(401).json({ error: "Not signed in" });
  const session = await validateSession(id);
  if (!session) return res.status(401).json({ error: "Session expired" });
  if (!canUseBackupApp(session.role)) {
    destroySession(id);
    return res.status(403).json({ error: "Backup access is limited to Admin and RTM." });
  }
  req.backupSession = session;
  req.username = session.username;
  req.userRole = { role: roles.normalizeRole(session.role), username: session.username };
  next();
}

function assertOutputDir(outputDir) {
  const dir = String(outputDir || "").trim();
  if (!dir) throw new Error("Choose a backup folder first.");
  if (!path.isAbsolute(dir)) throw new Error("Backup folder must be an absolute path.");
  if (!fs.existsSync(dir)) throw new Error("Backup folder does not exist.");
  if (!fs.statSync(dir).isDirectory()) throw new Error("Backup path is not a folder.");
  return dir;
}

router.post("/login", rateLimiter.middleware(rateLimiter.checkLogin), async (req, res) => {
  try {
    await requireOnline();
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Username and password required" });
    const users = await fetchAuthUsers();
    const result = await validateLogin(username, password, users);
    if (!result.ok) {
      if (result.reason === "inactive") return res.status(403).json({ error: "Account inactive." });
      return res.status(401).json({ error: "Invalid username or password" });
    }
    const role = roles.normalizeRole(result.role);
    if (!canUseBackupApp(role)) {
      return res.status(403).json({ error: "Backup access is limited to Admin and RTM accounts." });
    }
    const session = createSession(result.user, role, {
      deviceLabel: "Hangup Backup",
      passwordChangedAtSnapshot: result.passwordChangedAt || null,
    });
    req.session.backupSessionId = session.id;
    res.json({ ok: true, sessionId: session.id, username: result.user, role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/logout", requireBackupAuth, (req, res) => {
  const id = sessionFromRequest(req);
  if (id) destroySession(id);
  if (req.session) req.session.backupSessionId = null;
  res.json({ ok: true });
});

router.get("/me", requireBackupAuth, (req, res) => {
  res.json({ username: req.username, role: req.userRole.role, kinds: backupService.SALES_ATTACHMENT_KINDS });
});

function startJob(type, outputDir, runFn) {
  const job = backupJobs.createJob(type, { outputDir });
  setImmediate(async () => {
    backupJobs.updateJob(job.id, { status: "running" });
    try {
      const result = await runFn((patch) => backupJobs.updateJob(job.id, patch));
      backupJobs.completeJob(job.id, result);
    } catch (err) {
      backupJobs.failJob(job.id, err);
    }
  });
  return job;
}

const backupRateLimit = rateLimiter.middleware(rateLimiter.checkBackupAction);

router.post("/full", requireBackupAuth, backupRateLimit, (req, res) => {
  try {
    const outputDir = assertOutputDir(req.body?.outputDir);
    backupJobs.pruneOldJobs();
    const job = startJob("full", outputDir, (p) => backupService.runFullBackup(outputDir, p));
    res.json({ ok: true, jobId: job.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/sales", requireBackupAuth, backupRateLimit, (req, res) => {
  try {
    const outputDir = assertOutputDir(req.body?.outputDir);
    const from = req.body?.from ? String(req.body.from).slice(0, 10) : null;
    const to = req.body?.to ? String(req.body.to).slice(0, 10) : null;
    backupJobs.pruneOldJobs();
    const job = startJob("sales", outputDir, (p) => backupService.runSalesBackup(outputDir, p, { from, to }));
    res.json({ ok: true, jobId: job.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/jobs/:id", requireBackupAuth, (req, res) => {
  const job = backupJobs.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json({ job });
});

module.exports = router;

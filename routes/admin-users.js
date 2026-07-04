const express = require("express");
const roles = require("../lib/roles");
const { useSupabase } = require("../lib/backend");
const usersAdmin = require("../lib/users-admin");
const userPermissions = require("../lib/user-permissions");
const permissionCatalog = require("../lib/permission-catalog");
const store = require("../lib/data-store");

const router = express.Router();

function requireSystemAdmin(req, res, next) {
  if (!roles.canManageAppUsers(req.username)) {
    return res.status(403).json({ error: "Only the system administrator may manage users." });
  }
  if (!useSupabase()) {
    return res.status(503).json({ error: "User management requires Supabase (DATA_BACKEND=supabase)." });
  }
  next();
}

router.use(requireSystemAdmin);

router.get("/", async (_req, res) => {
  try {
    await userPermissions.loadOverrides(true);
    const users = await usersAdmin.listAppUsers();
    const employees = store.getEmployees({ hideOut: false });
    const byId = new Map(employees.map((e) => [e.id, e]));
    res.json({
      users: users.map((u) => {
        const emp = byId.get(u.employee_id || u.username) || null;
        return {
          id: u.id,
          username: u.username,
          email: u.email || "",
          role: u.role || "",
          status: u.status || "active",
          employeeId: u.employee_id || "",
          employeeName: emp ? emp.american_name || emp.arabic_name || emp.id : "",
          employeeTeam: emp?.team || "",
          employeeUnit: emp?.unit || "",
          hasExceptionAccess: userPermissions.hasAnyOverride(u.username),
          lastLoginAt: u.last_login_at || null,
          createdAt: u.created_at,
          updatedAt: u.updated_at,
        };
      }),
      roles: usersAdmin.ASSIGNABLE_ROLES,
      statuses: usersAdmin.VALID_STATUSES,
      units: [...new Set(employees.map((e) => e.unit).filter(Boolean))].sort(),
      teams: [...new Set(employees.map((e) => e.team).filter(Boolean))].sort(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/sync-employees", async (req, res) => {
  try {
    const result = await usersAdmin.syncMissingEmployeeLogins(req.username);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const user = await usersAdmin.createAppUser(req.body, req.username);
    res.status(201).json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/:username", async (req, res) => {
  try {
    const username = decodeURIComponent(req.params.username);
    const user = await usersAdmin.updateAppUser(username, req.body, req.username);
    if (Array.isArray(req.body?.permissionOverrides)) {
      await userPermissions.saveForUser(username, req.body.permissionOverrides, req.username);
    }
    res.json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/:username/permissions", async (req, res) => {
  try {
    const username = decodeURIComponent(req.params.username);
    const user = await usersAdmin.getAppUser(username);
    if (!user) return res.status(404).json({ error: "User not found" });
    const overrides = await userPermissions.listForUser(username);
    const role = require("../lib/roles").normalizeRole(user.role);
    const defaults = permissionCatalog.defaultForRole(role, { role, username });
    res.json({ username, role, defaults, overrides });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:username/permissions", async (req, res) => {
  try {
    const username = decodeURIComponent(req.params.username);
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : req.body?.permissionOverrides;
    if (!Array.isArray(entries)) return res.status(400).json({ error: "Expected entries array" });
    const result = await userPermissions.saveForUser(username, entries, req.username);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/:username/permissions", async (req, res) => {
  try {
    const username = decodeURIComponent(req.params.username);
    await userPermissions.clearForUser(username);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/:username/purge", async (req, res) => {
  try {
    const username = decodeURIComponent(req.params.username);
    const result = await usersAdmin.purgeAppUserAndReleaseId(username, req.username);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/:username", async (req, res) => {
  try {
    const username = decodeURIComponent(req.params.username);
    const result = await usersAdmin.deleteAppUser(username, req.username);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

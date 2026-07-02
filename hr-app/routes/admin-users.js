const express = require("express");
const roles = require("../lib/roles");
const { useSupabase } = require("../lib/backend");
const usersAdmin = require("../lib/users-admin");
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
          lastLoginAt: u.last_login_at || null,
          createdAt: u.created_at,
          updatedAt: u.updated_at,
        };
      }),
      roles: usersAdmin.ASSIGNABLE_ROLES,
      statuses: usersAdmin.VALID_STATUSES,
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
    res.json({ ok: true, user });
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

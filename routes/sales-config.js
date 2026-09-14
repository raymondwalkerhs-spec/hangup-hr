const express = require("express");
const roles = require("../lib/roles");
const salesClients = require("../lib/sales-clients-repo");
const breaksRepo = require("../lib/break-schedules-repo");
const takesRepo = require("../lib/break-takes-repo");
const { getRevision } = require("../lib/settings-revision");
const companyContext = require("../lib/company-context");

const router = express.Router();

function resolveCompany(req) {
  return companyContext.resolveCompanyContextForUser(req.query.company || req.body?.company, req.userRole);
}

function canManageSalesConfig(userRole) {
  const r = userRole?.role;
  return ["rtm", "admin"].includes(r);
}

router.get("/revision", async (req, res) => {
  try {
    const revision = await getRevision();
    res.json({ revision });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/catalog", async (req, res) => {
  try {
    const company = resolveCompany(req);
    const saleProgramRaw = String(req.query.saleProgram || req.query.sale_program || "mla").toLowerCase();
    const saleProgram = saleProgramRaw === "rpm" ? "rpm" : "mla";
    const clients = await salesClients.readSalesClientsCatalog(company, { saleProgram });
    const activeOnly = req.query.activeOnly !== "false";
    const list = activeOnly
      ? clients.filter((c) => c.status !== "disabled")
      : clients;
    res.json({ clients: list, company, saleProgram, revision: await getRevision() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/import-from-sales", async (req, res) => {
  if (!canManageSalesConfig(req.userRole)) return res.status(403).json({ error: "RTM or Admin only" });
  try {
    const company = resolveCompany(req);
    const result = await salesClients.importFromExistingSales(company);
    res.json({ ok: true, ...result, company, revision: await getRevision() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/clients", async (req, res) => {
  if (!canManageSalesConfig(req.userRole)) {
    return res.status(403).json({ error: "RTM or Admin only" });
  }
  try {
    const company = resolveCompany(req);
    const saleProgram = req.query.saleProgram || req.query.sale_program;
    const clients = await salesClients.readSalesClientsCatalog(company, saleProgram ? { saleProgram } : {});
    res.json({ clients, company, revision: await getRevision() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/clients", async (req, res) => {
  if (!canManageSalesConfig(req.userRole)) return res.status(403).json({ error: "RTM or Admin only" });
  try {
    const company = resolveCompany(req);
    const client = await salesClients.upsertClient({ ...req.body, company });
    res.status(201).json({ client, revision: await getRevision() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch("/clients/:id", async (req, res) => {
  if (!canManageSalesConfig(req.userRole)) return res.status(403).json({ error: "RTM or Admin only" });
  try {
    const client = await salesClients.upsertClient({ ...req.body, id: req.params.id });
    res.json({ client, revision: await getRevision() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/clients/:id", async (req, res) => {
  if (!canManageSalesConfig(req.userRole)) return res.status(403).json({ error: "RTM or Admin only" });
  try {
    await salesClients.deleteClient(req.params.id);
    res.json({ ok: true, revision: await getRevision() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/products", async (req, res) => {
  if (!canManageSalesConfig(req.userRole)) return res.status(403).json({ error: "RTM or Admin only" });
  try {
    const product = await salesClients.upsertProduct(req.body || {});
    res.status(201).json({ product, revision: await getRevision() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch("/products/:id", async (req, res) => {
  if (!canManageSalesConfig(req.userRole)) return res.status(403).json({ error: "RTM or Admin only" });
  try {
    const product = await salesClients.upsertProduct({ ...req.body, id: req.params.id });
    res.json({ product, revision: await getRevision() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/products/:id", async (req, res) => {
  if (!canManageSalesConfig(req.userRole)) return res.status(403).json({ error: "RTM or Admin only" });
  try {
    await salesClients.deleteProduct(req.params.id);
    res.json({ ok: true, revision: await getRevision() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/prices", async (req, res) => {
  if (!canManageSalesConfig(req.userRole)) return res.status(403).json({ error: "RTM or Admin only" });
  try {
    const price = await salesClients.upsertPrice(req.body || {});
    res.status(201).json({ price, revision: await getRevision() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch("/prices/:id", async (req, res) => {
  if (!canManageSalesConfig(req.userRole)) return res.status(403).json({ error: "RTM or Admin only" });
  try {
    const price = await salesClients.upsertPrice({ ...req.body, id: req.params.id });
    res.json({ price, revision: await getRevision() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/prices/:id", async (req, res) => {
  if (!canManageSalesConfig(req.userRole)) return res.status(403).json({ error: "RTM or Admin only" });
  try {
    await salesClients.deletePrice(req.params.id);
    res.json({ ok: true, revision: await getRevision() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function filterBreaksForCompany(breaks, company) {
  const co = String(company || "hangup").toLowerCase();
  return (breaks || []).filter((b) => String(b.company || "hangup").toLowerCase() === co);
}

async function resolveBreakActor(req) {
  const store = require("../lib/data-store");
  const empLink = store.getAppUserEmployeeId(req.username);
  const employees = store.getEmployees({ hideOut: false });
  const emp = empLink ? employees.find((e) => String(e.id) === String(empLink)) : null;
  const enriched = await roles.enrichUserRoleWithOrgTeams(
    roles.resolveUserRole(req.username, req.userRole?.role || req.role),
    employees,
    empLink ? { employee_id: empLink } : null
  );
  return { store, employees, emp, empLink, enriched };
}

router.get("/breaks", async (req, res) => {
  try {
    const company = resolveCompany(req);
    const breaks = filterBreaksForCompany(await breaksRepo.readBreakSchedules(company), company);
    const manage = canManageSalesConfig(req.userRole);
    const { emp, enriched } = await resolveBreakActor(req);
    const extraRoles = await breaksRepo.getNotifierExtraRoles();
    const activeBreak = breaksRepo.activeBreakForUser(breaks, enriched, emp, { extraRoles });
    let openTake = null;
    if (emp?.id) {
      try {
        openTake = await takesRepo.getOpenTakeForEmployee(emp.id);
      } catch {
        /* table may not exist yet */
      }
    }
    res.json({
      breaks: manage ? breaks : breaks.filter((b) => b.active),
      activeBreak,
      openTake,
      notifierExtraRoles: manage ? extraRoles : undefined,
      company,
      revision: await getRevision(),
      canManage: manage,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/breaks", async (req, res) => {
  if (!canManageSalesConfig(req.userRole)) return res.status(403).json({ error: "RTM or Admin only" });
  try {
    const company = resolveCompany(req);
    const brk = await breaksRepo.upsertBreakSchedule({ ...(req.body || {}), company });
    res.status(201).json({ break: brk, revision: await getRevision() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch("/breaks/:id", async (req, res) => {
  if (!canManageSalesConfig(req.userRole)) return res.status(403).json({ error: "RTM or Admin only" });
  try {
    const company = resolveCompany(req);
    const brk = await breaksRepo.upsertBreakSchedule({ ...req.body, id: req.params.id, company: req.body?.company || company });
    res.json({ break: brk, revision: await getRevision() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/breaks/:id", async (req, res) => {
  if (!canManageSalesConfig(req.userRole)) return res.status(403).json({ error: "RTM or Admin only" });
  try {
    await breaksRepo.deleteBreakSchedule(req.params.id);
    res.json({ ok: true, revision: await getRevision() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/breaks/notifier-roles", async (req, res) => {
  if (!canManageSalesConfig(req.userRole)) return res.status(403).json({ error: "RTM or Admin only" });
  try {
    res.json({ roles: await breaksRepo.getNotifierExtraRoles() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/breaks/notifier-roles", async (req, res) => {
  if (!canManageSalesConfig(req.userRole)) return res.status(403).json({ error: "RTM or Admin only" });
  try {
    const rolesList = await breaksRepo.setNotifierExtraRoles(req.body?.roles || []);
    res.json({ roles: rolesList, revision: await getRevision() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/breaks/active", async (req, res) => {
  try {
    const company = resolveCompany(req);
    const breaks = filterBreaksForCompany(await breaksRepo.readBreakSchedules(company), company);
    const { emp, enriched, empLink } = await resolveBreakActor(req);
    const extraRoles = await breaksRepo.getNotifierExtraRoles();
    const active = breaksRepo.activeBreakForUser(breaks, enriched, emp, { extraRoles });
    let openTake = null;
    if (empLink) {
      try {
        openTake = await takesRepo.getOpenTakeForEmployee(empLink);
      } catch {
        /* ignore */
      }
    }
    res.json({
      activeBreak: active,
      openTake,
      revision: await getRevision(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/breaks/:id/start", async (req, res) => {
  try {
    const company = resolveCompany(req);
    const { emp, empLink, enriched } = await resolveBreakActor(req);
    if (!empLink || !emp) return res.status(400).json({ error: "No employee linked to your account", code: "no_employee" });
    const breaks = filterBreaksForCompany(await breaksRepo.readBreakSchedules(company), company);
    const schedule = breaks.find((b) => b.id === req.params.id);
    if (!schedule) return res.status(404).json({ error: "Break schedule not found" });
    const take = await takesRepo.startTake({
      schedule,
      employeeId: empLink,
      username: req.username,
      unit: emp.unit || enriched.unit,
      company,
    });
    res.json({ ok: true, take });
  } catch (err) {
    res.status(err.code === "take_open" ? 409 : 400).json({ error: err.message, code: err.code });
  }
});

router.post("/breaks/:id/dismiss", async (req, res) => {
  try {
    const company = resolveCompany(req);
    const { emp, empLink, enriched } = await resolveBreakActor(req);
    if (!empLink) return res.status(400).json({ error: "No employee linked to your account", code: "no_employee" });
    const breaks = filterBreaksForCompany(await breaksRepo.readBreakSchedules(company), company);
    const schedule = breaks.find((b) => b.id === req.params.id);
    if (!schedule) return res.status(404).json({ error: "Break schedule not found" });
    const take = await takesRepo.dismissTake({
      schedule,
      employeeId: empLink,
      username: req.username,
      unit: emp?.unit || enriched.unit,
      company,
    });
    res.json({ ok: true, take });
  } catch (err) {
    res.status(err.code === "take_open" ? 409 : 400).json({ error: err.message, code: err.code });
  }
});

router.post("/breaks/takes/:takeId/end", async (req, res) => {
  try {
    const { empLink } = await resolveBreakActor(req);
    if (!empLink) return res.status(400).json({ error: "No employee linked to your account", code: "no_employee" });
    const take = await takesRepo.endTake({ takeId: req.params.takeId, employeeId: empLink });
    res.json({ ok: true, take });
  } catch (err) {
    res.status(err.code === "forbidden" ? 403 : 400).json({ error: err.message, code: err.code });
  }
});

router.get("/breaks/takes", async (req, res) => {
  try {
    const company = resolveCompany(req);
    const egyptDate = String(req.query.date || require("../lib/egypt-datetime").egyptTodayDate()).slice(0, 10);
    const q = String(req.query.q || "").trim();
    const { employees, enriched, empLink } = await resolveBreakActor(req);
    const role = String(enriched?.role || "").toLowerCase();
    let scoped = employees;
    if (["admin", "rtm", "ceo", "hr"].includes(role)) {
      scoped = companyContext.filterEmployeesByCompany(employees, company);
    } else if (role === "op") {
      scoped = roles.filterEmployeesForUser(employees, enriched);
    } else if (role === "tl") {
      scoped = roles.filterEmployeesForUser(employees, enriched);
      if (empLink && !scoped.some((e) => String(e.id) === String(empLink))) {
        const self = employees.find((e) => String(e.id) === String(empLink));
        if (self) scoped = [...scoped, self];
      }
    } else {
      scoped = empLink ? employees.filter((e) => String(e.id) === String(empLink)) : [];
    }
    const ids = scoped.map((e) => String(e.id));
    let takes = await takesRepo.listTakes({ egyptDate, company, employeeIds: ids, q: "" });
    takes = takesRepo.enrichTakesWithNames(takes, scoped);
    if (q) {
      const needle = q.toLowerCase();
      takes = takes.filter(
        (t) =>
          String(t.americanName || "").toLowerCase().includes(needle) ||
          String(t.employeeId || "").toLowerCase().includes(needle) ||
          String(t.breakName || "").toLowerCase().includes(needle)
      );
    }
    res.json({ takes, date: egyptDate, company });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

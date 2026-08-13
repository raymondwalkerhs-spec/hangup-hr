const express = require("express");
const roles = require("../lib/roles");
const salesClients = require("../lib/sales-clients-repo");
const breaksRepo = require("../lib/break-schedules-repo");
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
  return (breaks || []).filter((b) => {
    const units = Array.isArray(b.units) ? b.units : [];
    if (!units.length) return co === "hangup";
    const hasHs2 = units.some((u) => companyContext.isHs2Unit(u));
    const hasHangup = units.some((u) => !companyContext.isHs2Unit(u));
    if (co === "hs2") return hasHs2;
    return hasHangup;
  });
}

router.get("/breaks", async (req, res) => {
  try {
    const company = resolveCompany(req);
    const breaks = filterBreaksForCompany(await breaksRepo.readBreakSchedules(), company);
    const manage = canManageSalesConfig(req.userRole);
    res.json({
      breaks: manage ? breaks : breaks.filter((b) => b.active),
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
    const brk = await breaksRepo.upsertBreakSchedule({ ...req.body, id: req.params.id });
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

router.get("/breaks/active", async (req, res) => {
  try {
    const breaks = await breaksRepo.readBreakSchedules();
    const active = breaksRepo.activeBreakForUser(breaks, req.userRole);
    res.json({ activeBreak: active, revision: await getRevision() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

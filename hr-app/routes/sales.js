const express = require("express");
const business = require("../lib/business-repo");
const salesScope = require("../lib/sales-scope");
const periodGrid = require("../lib/sales-period-grid");
const teamDashboard = require("../lib/team-dashboard");
const hrmsRepo = require("../lib/hrms-repo");
const roles = require("../lib/roles");
const store = require("../lib/data-store");
const companyContext = require("../lib/company-context");
const notify = require("../lib/notify-store");
const { fetchAuthUsers } = require("../lib/auth");

const router = express.Router();

function scopedEmployees(req, opts = {}) {
  let employees = store.getEmployees({ hideOut: opts.hideOut !== undefined ? opts.hideOut : false });
  employees = companyContext.filterEmployeesByCompany(employees, req.query.company);
  return employees;
}

function filterSalesByCompany(sales, employees) {
  const ids = new Set(employees.map((e) => e.id));
  return sales.filter((s) => !s.agentId || ids.has(s.agentId));
}

function enrichSaleAgent(emp) {
  return { team: emp?.team || "", unit: emp?.unit || "" };
}

async function notifySaleEvent(sale, type, title, body, extraUsers = []) {
  const users = new Set(extraUsers.map((u) => String(u).toLowerCase()));
  users.add(String(sale.submittedBy).toLowerCase());
  if (sale.agentId) users.add(String(sale.agentId).toLowerCase());
  await notify.createNotificationsForUsers([...users], {
    type,
    title,
    body,
    entityType: "sale",
    entityId: sale.id,
  });
}

async function notifyCallback(sale, employees) {
  const users = new Set();
  if (sale.closerId) users.add(String(sale.closerId).toLowerCase());
  if (sale.submittedBy) users.add(String(sale.submittedBy).toLowerCase());
  const agent = employees.find((e) => e.id === sale.agentId);
  if (agent?.team) {
    const tl = employees.find(
      (e) => e.team === agent.team && /^TL/i.test(String(e.id || ""))
    );
    if (tl) users.add(String(tl.id).toLowerCase());
  }
  if (agent?.unit) {
    const op = employees.find(
      (e) => e.unit === agent.unit && /^OP/i.test(String(e.id || ""))
    );
    if (op) users.add(String(op.id).toLowerCase());
  }
  if (sale.callbackVisibleToAgent && sale.agentId) {
    users.add(String(sale.agentId).toLowerCase());
  }
  await notify.createNotificationsForUsers([...users], {
    type: "sale_callback",
    title: "Sale needs callback",
    body: `${sale.fullName}: ${sale.feedback || "See feedback"}`,
    entityType: "sale",
    entityId: sale.id,
  });
}

router.get("/", async (req, res) => {
  try {
    const employees = scopedEmployees(req);
    const grants = await business.readSalesVisibilityGrants(req.username);
    let sales = await business.readSales({
      from: req.query.from,
      to: req.query.to,
      agentId: req.query.agentId,
      team: req.query.team,
      unit: req.query.unit,
      status: req.query.status,
    });
    sales = salesScope.filterSalesForUser(sales, req.userRole, employees, grants);
    sales = filterSalesByCompany(sales, employees);
    res.json({ sales, devices: business.SALE_DEVICES, statuses: business.SALE_STATUSES });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/period-grid", async (req, res) => {
  try {
    const employees = store.getEmployees();
    const grants = await business.readSalesVisibilityGrants(req.username);
    const period = req.query.period || "day";
    const date = req.query.date;
    const fromQ = req.query.from;
    const toQ = req.query.to;
    const bounds = periodGrid.buildPeriodBounds(period, date);
    const from = fromQ || bounds.from;
    const to = toQ || bounds.to;

    let sales = await business.readSales({ from, to });
    sales = salesScope.filterSalesForUser(sales, req.userRole, employees, grants);
    sales = filterSalesByCompany(sales, employees);

    const attendanceRecords = [];
    for (const ym of periodGrid.attendanceMonthsInRange(from, to)) {
      attendanceRecords.push(...store.getAttendanceEvents(ym));
    }

    const grid = periodGrid.buildPeriodGrid({
      sales,
      employees,
      attendanceRecords: periodGrid.filterAttendanceForRange(attendanceRecords, from, to),
      period,
      date,
      from,
      to,
    });
    res.json(grid);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/team-dashboard", async (req, res) => {
  try {
    const employees = scopedEmployees(req);
    const grants = await business.readSalesVisibilityGrants(req.username);
    const period = req.query.period || "day";
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const { from, to } = periodGrid.buildPeriodBounds(period === "week" ? "week" : "day", date);

    let sales = await business.readSales({ from, to });
    sales = salesScope.filterSalesForUser(sales, req.userRole, employees, grants);
    sales = filterSalesByCompany(sales, employees);

    let teamsMeta = [];
    try {
      teamsMeta = await hrmsRepo.readOrgTeams();
    } catch {
      teamsMeta = [];
    }

    const attendanceRecords = [];
    for (const ym of periodGrid.attendanceMonthsInRange(from, to)) {
      attendanceRecords.push(...store.getAttendanceEvents(ym));
    }
    const attendance = periodGrid.filterAttendanceForRange(attendanceRecords, from, to);

    if (period === "week") {
      const dashboard = teamDashboard.buildWeekDashboard({
        from,
        to,
        sales,
        employees,
        attendanceRecords: attendance,
        teamsMeta,
      });
      return res.json({ period: "week", ...dashboard });
    }

    const dashboard = teamDashboard.buildDayDashboard({
      date: from,
      sales,
      employees,
      attendanceRecords: attendance,
      teamsMeta,
    });
    res.json({ period: "day", ...dashboard });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/dashboard", async (req, res) => {
  try {
    const employees = scopedEmployees(req);
    const grants = await business.readSalesVisibilityGrants(req.username);
    let sales = await business.readSales({
      from: req.query.from,
      to: req.query.to,
    });
    sales = salesScope.filterSalesForUser(sales, req.userRole, employees, grants);
    sales = filterSalesByCompany(sales, employees);
    const dashboard = salesScope.buildSalesDashboard(sales, {
      period: req.query.period || "day",
      date: req.query.date,
      groupBy: req.query.groupBy || "team",
    });
    res.json(dashboard);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/visibility-grants", async (req, res) => {
  if (!salesScope.canApproveSale(req.userRole) && req.userRole.role !== "op") {
    return res.status(403).json({ error: "No permission" });
  }
  try {
    const grants = await business.readSalesVisibilityGrants(req.query.grantee || "");
    res.json({ grants });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/visibility-grants", async (req, res) => {
  const { granteeUsername, scopeType, scopeValue } = req.body;
  if (!granteeUsername || !scopeType) {
    return res.status(400).json({ error: "granteeUsername and scopeType required" });
  }
  try {
    const authUsers = await fetchAuthUsers();
    const grantee = authUsers.find(
      (u) => u.user.toLowerCase() === String(granteeUsername).toLowerCase()
    );
    const granteeRole = roles.normalizeRole(grantee?.role || "agent");
    if (!salesScope.canGrantVisibility(req.userRole.role, granteeRole, scopeType)) {
      return res.status(403).json({ error: "Cannot grant this visibility" });
    }
    if (req.userRole.role === "tl" && granteeRole === "agent" && scopeType !== "team") {
      return res.status(403).json({ error: "TL cannot grant cross-team visibility to agents" });
    }
    const grant = await business.createSalesVisibilityGrant(
      { granteeUsername, scopeType, scopeValue },
      req.username
    );
    res.json({ ok: true, grant });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/visibility-grants/:id", async (req, res) => {
  try {
    await business.deleteSalesVisibilityGrant(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  const {
    phoneNumber,
    fullName,
    device,
    price,
    client,
    agentId,
    closerId,
    status,
    submissionDate,
    effectiveDate,
  } = req.body;
  if (!phoneNumber || !fullName || !device || !agentId) {
    return res.status(400).json({ error: "phoneNumber, fullName, device, agentId required" });
  }
  const emp = store.getEmployeeById(agentId);
  if (!emp) return res.status(404).json({ error: "Agent not found" });
  if (!roles.canAccessEmployee(req.userRole, emp) && !salesScope.canApproveSale(req.userRole)) {
    return res.status(403).json({ error: "No access to this agent" });
  }
  const initialStatus = salesScope.initialSaleStatus(req.userRole.role, status);
  const geo = enrichSaleAgent(emp);
  try {
    const sale = await business.createSale(
      {
        phoneNumber,
        fullName,
        device,
        price,
        client,
        agentId,
        closerId: closerId || req.userRole.employeeId || "",
        status: initialStatus,
        submissionDate: submissionDate || new Date().toISOString().slice(0, 10),
        effectiveDate: effectiveDate || submissionDate || new Date().toISOString().slice(0, 10),
        team: geo.team,
        unit: geo.unit,
      },
      req.username
    );
    if (sale.status === "pending") {
      const authUsers = await fetchAuthUsers();
      const approvers = authUsers
        .filter((u) => salesScope.canApproveSale({ role: roles.normalizeRole(u.role) }))
        .map((u) => u.user);
      await notify.createNotificationsForUsers(approvers, {
        type: "sale_pending",
        title: "Sale pending approval",
        body: `${sale.fullName} — agent ${agentId}`,
        entityType: "sale",
        entityId: sale.id,
      });
    }
    res.json({ ok: true, sale });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const existing = await business.getSale(req.params.id);
    if (!existing) return res.status(404).json({ error: "Sale not found" });
    const employees = store.getEmployees();
    const grants = await business.readSalesVisibilityGrants(req.username);
    const visible = salesScope.filterSalesForUser([existing], req.userRole, employees, grants);
    if (!visible.length) return res.status(403).json({ error: "No access" });

    const { action, feedback, callbackVisibleToAgent, effectiveDate } = req.body;
    let patch = {};

    if (action === "approve" && salesScope.canApproveSale(req.userRole)) {
      patch.status = existing.status === "postdated" ? "passed" : "passed";
      patch.reviewedBy = req.username;
    } else if (action === "deny" && salesScope.canApproveSale(req.userRole)) {
      patch.status = "denied";
      patch.feedback = feedback || "";
      patch.reviewedBy = req.username;
    } else if (action === "callback" && salesScope.canApproveSale(req.userRole)) {
      patch.status = "callback";
      patch.feedback = feedback || "";
      patch.callbackVisibleToAgent = callbackVisibleToAgent === true;
      patch.reviewedBy = req.username;
    } else if (action === "resolve_callback") {
      patch.status = "pending";
      patch.feedback = feedback || existing.feedback;
    } else if (req.body.edit === true || (!action && roles.canEditSale(req.userRole))) {
      if (!roles.canEditSale(req.userRole)) {
        return res.status(403).json({ error: "No permission to edit sales" });
      }
      const fields = [
        "phoneNumber", "fullName", "device", "price", "client", "agentId",
        "closerId", "effectiveDate", "submissionDate", "status", "feedback",
      ];
      for (const f of fields) {
        if (req.body[f] !== undefined) patch[f] = req.body[f];
      }
      if (patch.agentId) {
        const emp = store.getEmployeeById(patch.agentId);
        if (!emp) return res.status(404).json({ error: "Agent not found" });
        const geo = enrichSaleAgent(emp);
        patch.team = geo.team;
        patch.unit = geo.unit;
      }
    } else if (req.body.status) {
      if (!salesScope.canApproveSale(req.userRole)) {
        return res.status(403).json({ error: "Approver required" });
      }
      patch = { ...req.body };
    } else {
      return res.status(400).json({ error: "Invalid action" });
    }
    if (effectiveDate) patch.effectiveDate = effectiveDate;

    const sale = await business.updateSale(req.params.id, patch, req.username);

    if (patch.status === "callback") {
      await notifyCallback(sale, employees);
    } else if (patch.status === "passed" || patch.status === "denied") {
      await notifySaleEvent(
        sale,
        "sale_review",
        `Sale ${patch.status}`,
        `${sale.fullName} — ${feedback || ""}`,
        [sale.submittedBy]
      );
    }
    res.json({ ok: true, sale });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

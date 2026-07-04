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
const notifyRouting = require("../lib/notify-routing");
const salesFieldAccess = require("../lib/sales-field-access");
const salesClients = require("../lib/sales-clients-repo");
const egyptDatetime = require("../lib/egypt-datetime");
const salesCatalog = require("../lib/sales-field-catalog");
const salesFilter = require("../lib/sales-filter");
const salesListColumns = require("../lib/sales-list-columns");
const salesActionPerms = require("../lib/sales-action-permissions");
const workingDayLib = require("../lib/sales-working-day");

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

async function recalcAgentSalesFromSale(sale, actor) {
  if (!sale?.agentId) return;
  const wd = sale.workingDay || workingDayLib.computeWorkingDay(sale.submissionDate);
  const ym = String(wd || "").slice(0, 7);
  if (!ym) return;
  try {
    await store.recalcSalesCountForEmployee(ym, sale.agentId, actor || "system");
  } catch (_) {
    /* non-fatal */
  }
}

function enrichSaleAgent(emp) {
  return { team: emp?.team || "", unit: emp?.unit || "" };
}

async function validateSaleUnitTeam(unit, team) {
  const u = String(unit || "").trim();
  const t = String(team || "").trim();
  if (!u || !t) return { ok: false, error: "Unit and team are required" };
  const orgTeams = await hrmsRepo.readOrgTeams();
  const match = (orgTeams || []).find((row) => row.name === t && row.unit === u);
  if (!match) return { ok: false, error: "Invalid unit/team combination" };
  if (match.dialsSales === false) return { ok: false, error: "Only dialing teams can be selected" };
  return { ok: true, unit: u, team: t };
}

function normalizePaymentMethod(method) {
  const m = String(method || "").trim().toLowerCase();
  if (m === "card") return "Card";
  if (m === "bank account" || m === "bank") return "Bank account";
  return String(method || "").trim();
}

function validatePaymentForm(formData) {
  const fd = formData || {};
  const method = normalizePaymentMethod(fd.paymentMethod);
  if (!method) return { ok: false, error: "Payment method is required" };
  if (method === "Card") {
    if (!String(fd.cardNumber || "").trim()) return { ok: false, error: "Card number is required when payment method is Card" };
    if (!String(fd.cardExpDate || "").trim()) return { ok: false, error: "Card expiration is required when payment method is Card" };
    if (!String(fd.cvv || "").trim()) return { ok: false, error: "CVV is required when payment method is Card" };
  }
  if (method === "Bank account") {
    if (!String(fd.routingNumber || "").trim()) return { ok: false, error: "Routing number is required for bank account payment" };
    if (!String(fd.bankName || "").trim()) return { ok: false, error: "Bank name is required for bank account payment" };
    if (!String(fd.bankAccountNumber || "").trim()) return { ok: false, error: "Bank account number is required for bank account payment" };
  }
  return { ok: true, method };
}

function scrubPaymentForm(formData, method) {
  const fd = { ...(formData || {}) };
  fd.paymentMethod = method;
  if (method === "Bank account") {
    for (const key of salesCatalog.PAYMENT_CARD_KEYS) delete fd[key];
  }
  if (method === "Card") {
    for (const key of salesCatalog.PAYMENT_BANK_KEYS) delete fd[key];
  }
  return fd;
}

async function notifySaleEvent(sale, type, title, body, extraEmployeeIds = []) {
  const empIds = [...(extraEmployeeIds || [])];
  if (sale.agentId) empIds.push(sale.agentId);
  const users = new Set(await notifyRouting.resolveUsernamesForEmployees(empIds));
  users.add(String(sale.submittedBy).toLowerCase());
  await notify.createNotificationsForUsers([...users], {
    type,
    title,
    body,
    entityType: "sale",
    entityId: sale.id,
  });
}

async function notifySaleAssignments(sale, prev = {}) {
  const prevForm = prev.formData || {};
  const newForm = sale.formData || {};
  const tasks = [];
  if (newForm.reviewer && newForm.reviewer !== prevForm.reviewer) {
    tasks.push(
      notifyRouting.notifySaleAssignment({
        sale,
        type: "sale_reviewer_assigned",
        title: "Sale assigned for review",
        body: `${sale.fullName} — review requested`,
        employeeIds: [newForm.reviewer],
      })
    );
  }
  if (newForm.assignVerifier && newForm.assignVerifier !== prevForm.assignVerifier) {
    tasks.push(
      notifyRouting.notifySaleAssignment({
        sale,
        type: "sale_verifier_assigned",
        title: "Sale assigned for verification",
        body: `${sale.fullName} — verify requested`,
        employeeIds: [newForm.assignVerifier],
      })
    );
  }
  if (sale.agentId && sale.agentId !== prev.agentId) {
    tasks.push(
      notifyRouting.notifySaleAssignment({
        sale,
        type: "sale_agent_assigned",
        title: "Sale assigned to you",
        body: `${sale.fullName} — agent assignment`,
        employeeIds: [sale.agentId],
      })
    );
  }
  if (sale.closerId && sale.closerId !== prev.closerId) {
    tasks.push(
      notifyRouting.notifySaleAssignment({
        sale,
        type: "sale_agent_assigned",
        title: "Sale assigned as closer",
        body: `${sale.fullName} — closer assignment`,
        employeeIds: [sale.closerId],
      })
    );
  }
  await Promise.all(tasks);
}

async function notifyCallback(sale, employees) {
  const empIds = [];
  if (sale.closerId) empIds.push(sale.closerId);
  if (sale.agentId && sale.callbackVisibleToAgent) empIds.push(sale.agentId);
  const agent = employees.find((e) => e.id === sale.agentId);
  if (agent?.team) {
    const tl = employees.find(
      (e) => e.team === agent.team && /^TL/i.test(String(e.id || ""))
    );
    if (tl) empIds.push(tl.id);
  }
  if (agent?.unit) {
    const op = employees.find(
      (e) => e.unit === agent.unit && /^OP/i.test(String(e.id || ""))
    );
    if (op) empIds.push(op.id);
  }
  const users = new Set(await notifyRouting.resolveUsernamesForEmployees(empIds));
  if (sale.submittedBy) users.add(String(sale.submittedBy).toLowerCase());
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
    const dateBasis = req.query.dateBasis || "workingDay";
    let sales = await business.readSales({
      from: req.query.from,
      to: req.query.to,
      agentId: req.query.agentId,
      closerId: req.query.closerId,
      client: req.query.client,
      team: req.query.team,
      unit: req.query.unit,
      status: req.query.status,
      dateBasis,
    });
    sales = salesScope.filterSalesForUser(sales, req.userRole, employees, grants);
    sales = filterSalesByCompany(sales, employees);
    if (req.query.filter) {
      sales = salesFilter.applySalesFilter(sales, req.query.filter);
    }
    sales = await salesFieldAccess.redactSalesForRole(sales, req.userRole);
    const listColumns = await salesListColumns.getVisibleColumnsForUser(req.userRole?.role);
    res.json({ sales, devices: business.SALE_DEVICES, statuses: business.SALE_STATUSES, listColumns });
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

    let sales = await business.readSales({
      from,
      to,
      dateBasis: req.query.dateBasis || "submission",
    });
    sales = salesScope.filterSalesForUser(sales, req.userRole, employees, grants);
    sales = filterSalesByCompany(sales, employees);
    sales = await salesFieldAccess.redactSalesForRole(sales, req.userRole);

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
    sales = await salesFieldAccess.redactSalesForRole(sales, req.userRole);

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
      dateBasis: req.query.dateBasis || "submission",
    });
    sales = salesScope.filterSalesForUser(sales, req.userRole, employees, grants);
    sales = filterSalesByCompany(sales, employees);
    sales = await salesFieldAccess.redactSalesForRole(sales, req.userRole);
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
  const { granteeUsername, scopeType, scopeValue, temporaryHours } = req.body;
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
    const hours = temporaryHours != null ? Number(temporaryHours) : null;
    const grant = await business.createSalesVisibilityGrant(
      {
        granteeUsername,
        scopeType,
        scopeValue,
        temporaryHours: hours || (["tl", "agent"].includes(granteeRole) ? 24 : null),
      },
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
  if (!roles.canSubmitSales(req.userRole)) {
    return res.status(403).json({ error: "You may not submit new sales" });
  }
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
  if (!agentId) {
    return res.status(400).json({ error: "agentId required" });
  }
  const emp = store.getEmployeeById(agentId);
  if (!emp) return res.status(404).json({ error: "Agent not found" });
  if (!roles.canAccessEmployee(req.userRole, emp) && !salesScope.canApproveSale(req.userRole)) {
    return res.status(403).json({ error: "No access to this agent" });
  }
  const initialStatus = salesScope.initialSaleStatus(
    req.userRole.role,
    salesScope.canApproveSale(req.userRole) ? status : undefined
  );
  try {
    const sanitizedForm = await salesFieldAccess.sanitizeIncomingFormData(
      req.body.formData || req.body,
      req.userRole,
      { create: true }
    );
    const payload = salesFieldAccess.buildPayloadFromBody(req.body, sanitizedForm);
    const paymentCheck = validatePaymentForm(payload.formData || sanitizedForm);
    if (!paymentCheck.ok) return res.status(400).json({ error: paymentCheck.error });

    const unitTeam = await validateSaleUnitTeam(req.body.unit || payload.formData?.unit, req.body.team || payload.formData?.team);
    if (!unitTeam.ok) return res.status(400).json({ error: unitTeam.error });

    const mergedForm = scrubPaymentForm(
      { ...sanitizedForm, ...(payload.formData || {}), unit: unitTeam.unit, team: unitTeam.team },
      paymentCheck.method
    );
    const catalogResolved = await salesClients.validateAndResolveCatalogSale({
      ...req.body,
      ...payload,
      formData: mergedForm,
    });
    if (!catalogResolved.phoneNumber && !payload.phoneNumber) {
      return res.status(400).json({ error: "phoneNumber required" });
    }
    if (!catalogResolved.fullName && !payload.fullName) {
      return res.status(400).json({ error: "fullName required" });
    }
    if (!catalogResolved.device && !payload.device) {
      return res.status(400).json({ error: "device required" });
    }
    if (!catalogResolved.client && !payload.client) {
      const hasCatalog = await salesClients.catalogHasActiveProducts().catch(() => false);
      if (hasCatalog) {
        return res.status(400).json({ error: "client required — select from Client & device catalog" });
      }
    }
    if (!agentId) return res.status(400).json({ error: "agentId required" });
    const agentEmp = store.getEmployeeById(agentId);
    if (agentEmp?.team && unitTeam.team && agentEmp.team !== unitTeam.team) {
      const { teamsMatch } = require("../lib/team-names");
      if (!teamsMatch(agentEmp.team, unitTeam.team)) {
        return res.status(400).json({ error: "Agent must belong to the selected team" });
      }
    }
    const egyptSubmission = egyptDatetime.egyptNowFormatted();
    const dates = workingDayLib.enrichSaleDates({}, egyptSubmission);
    const sale = await business.createSale(
      {
        phoneNumber: payload.phoneNumber,
        fullName: payload.fullName,
        device: catalogResolved.device || payload.device,
        price: catalogResolved.price != null ? catalogResolved.price : payload.price,
        client: catalogResolved.client || payload.client,
        agentId,
        closerId: closerId || req.userRole.employeeId || "",
        status: initialStatus,
        submissionDate: dates.submissionDate,
        effectiveDate: payload.effectiveDate || dates.workingDay,
        feedback: payload.feedback || "",
        team: unitTeam.team,
        unit: unitTeam.unit,
        formData: catalogResolved.formData || mergedForm,
      },
      req.username
    );
    if (sale.status === "pending") {
      const dispatch = require("../lib/notify-dispatch");
      const submitterRole = roles.normalizeRole(req.userRole?.role);
      if (submitterRole === "agent") {
        await dispatch.dispatchNotification({
          actionKey: "sale_agent_submitted",
          type: "sale_agent_submitted",
          title: "New sale submitted",
          body: `${sale.fullName} — agent ${agentId}`,
          entityType: "sale",
          entityId: sale.id,
          actor: req.username,
        });
      }
      await dispatch.dispatchNotification({
        actionKey: "sale_pending",
        type: "sale_pending",
        title: "Sale pending approval",
        body: `${sale.fullName} — agent ${agentId}`,
        entityType: "sale",
        entityId: sale.id,
        actor: req.username,
      });
    }
    await notifySaleAssignments(sale, {});
    await recalcAgentSalesFromSale(sale, req.username);
    res.json({ ok: true, sale: (await salesFieldAccess.redactSalesForRole([sale], req.userRole))[0] });
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
      const ticketOnly = req.body.qualityTicket === true;
      if (ticketOnly) {
        if (!roles.canWorkQualityTicket(req.userRole)) {
          return res.status(403).json({ error: "No permission for quality tickets" });
        }
      } else if (!roles.canEditSale(req.userRole)) {
        return res.status(403).json({ error: "No permission to edit sales" });
      }
      const sanitizedForm = await salesFieldAccess.sanitizeIncomingFormData(
        { ...(existing.formData || {}), ...(req.body.formData || {}) },
        req.userRole,
        { create: false, sale: existing }
      );
      const built = salesFieldAccess.buildPayloadFromBody(req.body, sanitizedForm);
      patch = {
        phoneNumber: built.phoneNumber || existing.phoneNumber,
        fullName: built.fullName || existing.fullName,
        device: built.device || existing.device,
        price: built.price != null ? built.price : existing.price,
        client: built.client != null ? built.client : existing.client,
        effectiveDate: built.effectiveDate || existing.effectiveDate,
        submissionDate: built.submissionDate || existing.submissionDate,
        status: built.status || existing.status,
        feedback: built.feedback != null ? built.feedback : existing.feedback,
        formData: sanitizedForm,
      };
      if (req.body.agentId) patch.agentId = req.body.agentId;
      if (req.body.closerId !== undefined) patch.closerId = req.body.closerId;
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

    await notifySaleAssignments(sale, existing);

    if (patch.status === "callback") {
      await notifyCallback(sale, employees);
    } else if (patch.status === "passed" || patch.status === "denied") {
      await notifySaleEvent(
        sale,
        "sale_review",
        `Sale ${patch.status}`,
        `${sale.fullName} — ${feedback || ""}`,
        []
      );
    }
    const [redacted] = await salesFieldAccess.redactSalesForRole([sale], req.userRole);
    await recalcAgentSalesFromSale(sale, req.username);
    if (existing.agentId && existing.agentId !== sale.agentId) {
      await recalcAgentSalesFromSale(existing, req.username);
    }
    res.json({ ok: true, sale: redacted });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const saleStorage = require("../lib/sale-attachment-storage");
const saleAttachmentCache = require("../lib/sale-attachment-cache");
const fs = require("fs");

router.get("/export", async (req, res) => {
  if (!roles.canViewSales(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  if (!roles.canExportSales(req.userRole)) {
    return res.status(403).json({ error: "Export not allowed for your role" });
  }
  try {
    const employees = scopedEmployees(req);
    const grants = await business.readSalesVisibilityGrants(req.username);
    let sales = await business.readSales({
      from: req.query.from,
      to: req.query.to,
      agentId: req.query.agentId,
      closerId: req.query.closerId,
      team: req.query.team,
      unit: req.query.unit,
      status: req.query.status,
      dateBasis: req.query.dateBasis || "submission",
    });
    sales = salesScope.filterSalesForUser(sales, req.userRole, employees, grants);
    sales = filterSalesByCompany(sales, employees);
    sales = await salesFieldAccess.redactSalesForRole(sales, req.userRole);
    if (req.query.saleId) {
      sales = sales.filter((s) => s.id === req.query.saleId);
    }
    const format = String(req.query.format || "csv").toLowerCase();
    const salesExport = require("../lib/sales-export");
    const subtitle = [req.query.from, req.query.to].filter(Boolean).join(" → ") || "All visible sales";
    const { buffer, contentType, ext } = await salesExport.buildExport({
      sales,
      employees,
      format,
      meta: {
        title: req.query.saleId ? "Hangup Portal — Sale export" : "Hangup Portal — Sales export",
        subtitle,
      },
    });
    const stamp = new Date().toISOString().slice(0, 10);
    const name = req.query.saleId ? `sale-${req.query.saleId}` : `sales-${stamp}`;
    res.type(contentType).attachment(`${name}.${ext}`).send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/field-catalog", async (req, res) => {
  try {
    const perms = await business.readSalesFieldPermissions();
    const permMap = Object.fromEntries(perms.map((p) => [p.fieldKey, p]));
    const role = req.userRole?.role || "agent";
    const allFields = req.query.allFields === "1" && roles.canManageAll(req.userRole);
    const fields = allFields
      ? salesCatalog.FIELDS
      : salesCatalog.listFieldsForRole(role, permMap);
    res.json({
      fields,
      sections: salesCatalog.listSections(),
      attachmentKinds: salesCatalog.listAttachmentKindsForRole(role),
      permissions: perms,
      storageConfigured: saleStorage.isConfigured(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/field-permissions/:fieldKey", async (req, res) => {
  if (!roles.canManageSalesFieldPermissions(req.userRole)) {
    return res.status(403).json({ error: "Admin/RTM/HR only" });
  }
  try {
    const perm = await business.upsertSalesFieldPermission(req.params.fieldKey, req.body);
    salesFieldAccess.invalidatePermissionsCache();
    res.json({ ok: true, permission: perm });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/field-permissions/seed", async (req, res) => {
  if (!roles.canManageSalesFieldPermissions(req.userRole)) {
    return res.status(403).json({ error: "Admin/RTM/HR only" });
  }
  try {
    const { getSupabaseAdmin } = require("../lib/supabase-client");
    await salesCatalog.seedDefaultPermissions(getSupabaseAdmin());
    await salesActionPerms.seedDefaults();
    await salesListColumns.seedDefaultColumns();
    salesFieldAccess.invalidatePermissionsCache();
    salesListColumns.invalidateCache();
    salesActionPerms.invalidateCache();
    const perms = await business.readSalesFieldPermissions();
    res.json({ ok: true, count: perms.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/list-columns", async (req, res) => {
  try {
    const all = await salesListColumns.listColumns();
    const visible = await salesListColumns.getVisibleColumnsForUser(req.userRole?.role);
    res.json({ columns: all, visibleColumns: visible });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/list-columns/:columnKey", async (req, res) => {
  if (!roles.canManageSalesFieldPermissions(req.userRole)) {
    return res.status(403).json({ error: "Admin/RTM only" });
  }
  try {
    const col = await salesListColumns.upsertColumn(decodeURIComponent(req.params.columnKey), req.body);
    salesListColumns.invalidateCache();
    res.json({ column: col });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/list-columns/seed", async (req, res) => {
  if (!roles.canManageSalesFieldPermissions(req.userRole)) {
    return res.status(403).json({ error: "Admin/RTM only" });
  }
  try {
    const result = await salesListColumns.seedDefaultColumns();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/action-permissions", async (req, res) => {
  if (!roles.canManageSalesFieldPermissions(req.userRole)) {
    return res.status(403).json({ error: "Admin/RTM only" });
  }
  try {
    const actions = await salesActionPerms.loadMap();
    res.json({ actions: Object.values(actions) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/attachments/:attachmentId/file", async (req, res) => {
  try {
    const att = await business.getSaleAttachment(req.params.attachmentId);
    if (!att) return res.status(404).json({ error: "Attachment not found" });
    const sale = await business.getSale(att.saleId);
    if (!sale) return res.status(404).json({ error: "Sale not found" });
    const employees = store.getEmployees();
    const grants = await business.readSalesVisibilityGrants(req.username);
    const visible = salesScope.filterSalesForUser([sale], req.userRole, employees, grants);
    if (!visible.length) return res.status(403).json({ error: "No access" });

    const file = await saleAttachmentCache.getOrFetch(att);
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.fileName)}"`);
    res.setHeader("X-Cache-Hit", file.fromCache ? "1" : "0");
    fs.createReadStream(file.filePath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id/attachments", async (req, res) => {
  try {
    const attachments = await business.readSaleAttachments(req.params.id);
    res.json({ attachments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/attachments", async (req, res) => {
  try {
    const { fileName, contentBase64, kind } = req.body || {};
    if (!contentBase64 || !fileName) return res.status(400).json({ error: "fileName and contentBase64 required" });
    const buffer = Buffer.from(contentBase64, "base64");
    const uploaded = await saleStorage.uploadSaleAttachmentBuffer({
      saleId: req.params.id,
      kind: kind || "recording",
      fileName,
      buffer,
    });
    const att = await business.createSaleAttachment(
      {
        saleId: req.params.id,
        kind,
        fileName: uploaded.fileName,
        dropboxPath: uploaded.dropboxPath,
        dropboxLink: uploaded.dropboxLink,
      },
      req.username
    );
    res.status(201).json({ ok: true, attachment: att });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/attachments/:attachmentId", async (req, res) => {
  if (!roles.canEditSale(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  try {
    const att = await business.deleteSaleAttachment(req.params.attachmentId);
    if (att?.dropboxPath) {
      try {
        await saleStorage.deleteSaleAttachmentFile(att.dropboxPath);
      } catch {
        /* optional */
      }
    }
    try {
      await saleAttachmentCache.evict(att?.id || req.params.attachmentId);
    } catch {
      /* optional */
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

async function assertAttachmentAccess(req, attachmentId) {
  const att = await business.getSaleAttachment(attachmentId);
  if (!att) return { error: "Attachment not found", status: 404 };
  const sale = await business.getSale(att.saleId);
  if (!sale) return { error: "Sale not found", status: 404 };
  const employees = store.getEmployees();
  const grants = await business.readSalesVisibilityGrants(req.username);
  const visible = salesScope.filterSalesForUser([sale], req.userRole, employees, grants);
  if (!visible.length) return { error: "No access", status: 403 };
  return { att, sale };
}

router.get("/attachments/:attachmentId/download", async (req, res) => {
  try {
    const access = await assertAttachmentAccess(req, req.params.attachmentId);
    if (access.error) return res.status(access.status).json({ error: access.error });
    const file = await saleAttachmentCache.getOrFetch(access.att);
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.fileName)}"`);
    fs.createReadStream(file.filePath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/attachments/:attachmentId/share-link", async (req, res) => {
  try {
    const access = await assertAttachmentAccess(req, req.params.attachmentId);
    if (access.error) return res.status(access.status).json({ error: access.error });
    const att = access.att;
    const storagePath = att.dropboxPath;
    if (!storagePath || !saleStorage.isSupabaseStoragePath(storagePath)) {
      return res.status(400).json({
        error: "File not in Supabase storage. Run migrate-sale-attachments-to-supabase if this is a legacy sale.",
      });
    }
    const { url, expiresInDays } = await saleStorage.createShareUrl(storagePath);
    await business.updateSaleAttachmentDropboxLink(att.id, url);
    res.json({
      url,
      expiresInDays,
      storage: "supabase",
      note: `Signed link (~${expiresInDays} days). Use Share link again anytime to refresh.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/attachments/:attachmentId/replace", async (req, res) => {
  if (!roles.canEditSale(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  try {
    const access = await assertAttachmentAccess(req, req.params.attachmentId);
    if (access.error) return res.status(access.status).json({ error: access.error });
    const { fileName, contentBase64 } = req.body || {};
    if (!contentBase64 || !fileName) return res.status(400).json({ error: "fileName and contentBase64 required" });
    const buffer = Buffer.from(contentBase64, "base64");
    const att = access.att;
    if (att.dropboxPath) {
      try {
        await saleStorage.deleteSaleAttachmentFile(att.dropboxPath);
      } catch {
        /* optional */
      }
    }
    const uploaded = await saleStorage.uploadSaleAttachmentBuffer({
      saleId: att.saleId,
      kind: att.kind || "recording",
      fileName,
      buffer,
    });
    const updated = await business.replaceSaleAttachment(att.id, {
      fileName: uploaded.fileName,
      dropboxPath: uploaded.dropboxPath,
      dropboxLink: uploaded.dropboxLink,
    }, req.username);
    try {
      await saleAttachmentCache.evict(att.id);
    } catch {
      /* optional */
    }
    res.json({ ok: true, attachment: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

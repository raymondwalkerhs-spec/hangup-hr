/**
 * RPM Checks + Q Feedback API
 */
const express = require("express");
const roles = require("../lib/roles");
const store = require("../lib/data-store");
const companyContext = require("../lib/company-context");
const rpmChecksRepo = require("../lib/rpm-checks-repo");
const autoLink = require("../lib/rpm-check-auto-link");
const rpmRepo = require("../lib/rpm-sales-repo");
const hrmsRepo = require("../lib/hrms-repo");
const saleSubmitScope = require("../lib/sale-submit-scope");
const {
  canManuallySetFeedback,
  isTerminalFeedback,
  normalizeCheckStatus,
  normalizeFeedbackStatus,
} = require("../lib/rpm-check-status");
const { stripMemberId } = require("../lib/rpm-member-id");
const { currentWorkingDay } = require("../lib/sales-working-day");
const { getCached, setCached, idempotencyKeyFromReq } = require("../lib/idempotency-cache");

const router = express.Router();

function sendCheckMutationError(res, err) {
  if (err.code === "TABLE_MISSING") {
    return res.status(503).json({ error: err.message, available: false });
  }
  if (err.code === "MEMBER_DAY_EXISTS") {
    return res.status(409).json({
      error: err.message,
      code: "MEMBER_DAY_EXISTS",
      existing: err.existing
        ? {
            id: err.existing.id,
            agentId: err.existing.agentId,
            checkStatus: err.existing.checkStatus,
            feedbackStatus: err.existing.feedbackStatus,
          }
        : null,
    });
  }
  return res.status(400).json({
    error: err.message || String(err),
    field: err.field || undefined,
    code: err.code || undefined,
  });
}

function resolveCompany(req) {
  return companyContext.resolveCompanyContextForUser(
    req.query.company || req.body?.company,
    req.userRole
  );
}

function scopedEmployees(req) {
  let employees = store.getEmployees({ hideOut: false });
  const company = resolveCompany(req);
  employees = companyContext.filterEmployeesByCompany(employees, company);
  if (req.userRole) {
    employees = roles.filterEmployeesForTeamDashboard(employees, req.userRole);
  }
  return employees;
}

function presentEmployee(e) {
  return {
    id: e.id,
    american_name: e.american_name || "",
    team: e.team || "",
    unit: e.unit || "",
  };
}

async function loadSubmitEmployeesAndTeams(req) {
  const employeeAppRole = require("../lib/employee-app-role");
  const company = resolveCompany(req);
  await store.ensureEmployeesFresh();
  const employees = employeeAppRole.enrichEmployeesWithLiveAppRole(
    store.getEmployees({ hideOut: true })
  );
  const orgTeams = await hrmsRepo.readOrgTeams();
  return { company, employees, orgTeams };
}

async function buildChecksAgentScope(req) {
  const { company, employees, orgTeams } = await loadSubmitEmployeesAndTeams(req);
  const payload = saleSubmitScope.buildSubmitScopePayload(req.userRole, employees, orgTeams, {
    company,
  });

  // Checkers: dialing agents in assigned checker units only
  if (
    String(req.userRole?.role || "").toLowerCase() === "checker" ||
    roles.hasCheckerUnitAssignment(req.userRole)
  ) {
    const units = new Set(req.userRole?.checkerUnits || []);
    const dialingTeams = saleSubmitScope.filterDialingOrgTeams(orgTeams, company);
    const teamLeadIds = saleSubmitScope.teamLeadIdsFromOrgTeams(dialingTeams);
    payload.agents = (employees || [])
      .filter(
        (e) =>
          units.has(e.unit) &&
          saleSubmitScope.isDialingEmployee(e, { teamLeadIds })
      )
      .sort((a, b) =>
        String(a.american_name || a.id).localeCompare(String(b.american_name || b.id), undefined, {
          sensitivity: "base",
        })
      );
    payload.lockAgent = false;
    payload.allowedUnits = [...units].sort();
  }

  // Locked agent picker: always default to self when employee is linked
  if (payload.lockAgent && req.userRole?.employeeId) {
    const selfId = String(req.userRole.employeeId);
    if (!(payload.agents || []).some((e) => e.id === selfId)) {
      const self =
        employees.find((e) => e.id === selfId) || {
          id: selfId,
          american_name: selfId,
          team: req.userRole.team || "",
          unit: req.userRole.unit || "",
        };
      payload.agents = [self, ...(payload.agents || [])];
    }
    payload.defaultAgentId = selfId;
  }

  return {
    ...payload,
    agents: (payload.agents || []).map(presentEmployee),
    closers: (payload.closers || []).map(presentEmployee),
  };
}

async function buildFeedbackCloserScope(req, opts = {}) {
  const { company, employees, orgTeams } = await loadSubmitEmployeesAndTeams(req);
  const forCheckCreate = opts.forCheckCreate === true;
  const payload = saleSubmitScope.buildQFeedbackCloserScopePayload(
    req.userRole,
    employees,
    orgTeams,
    { company, forCheckCreate }
  );
  return {
    ...payload,
    closers: (payload.closers || []).map(presentEmployee),
  };
}

function assertCanSubmit(req, res) {
  if (!roles.canSubmitRpmChecks(req.userRole) && !req.userRole?.canSubmitChecksQFeedback) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

function assertCanFeedback(req, res) {
  if (!roles.canSubmitRpmQFeedback(req.userRole) && !req.userRole?.canSubmitChecksQFeedback) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

/** Resolve closer for manual Q feedback (create shortcut or POST /:id/feedback). */
async function resolveFeedbackCloserId(req, body, fallbackCloserId = null, opts = {}) {
  let closerId = String(body?.closerId || fallbackCloserId || "").trim() || null;
  const forCheckCreate = opts.forCheckCreate === true;
  const role = String(req.userRole?.role || "").toLowerCase();
  const canAssignCloser =
    forCheckCreate ||
    role === "tl" ||
    roles.hasLeadTeamAssignment(req.userRole) ||
    ["admin", "ceo", "rtm", "quality", "op"].includes(role) ||
    roles.hasCloserTeamAssignment(req.userRole);
  if (!canAssignCloser || !closerId) {
    closerId = req.userRole?.employeeId || closerId || null;
  }
  if (!closerId) return null;
  try {
    const scope = await buildFeedbackCloserScope(req, { forCheckCreate });
    const allowed = new Set((scope.closers || []).map((e) => e.id));
    if (!allowed.has(closerId)) {
      if (forCheckCreate && req.userRole?.employeeId && closerId === req.userRole.employeeId) {
        return closerId;
      }
      if (scope.lockCloser && req.userRole?.employeeId) {
        closerId = req.userRole.employeeId;
      } else {
        const err = new Error("Closer not allowed for your role");
        err.status = 403;
        throw err;
      }
    }
  } catch (err) {
    if (err.status === 403) throw err;
    /* keep closerId if scope fails */
  }
  return closerId;
}

/** Apply manual Q feedback disposition (not Sale). Used by create shortcut and feedback POST. */
async function applyManualQFeedback(req, checkId, body, { check: knownCheck, forCheckCreate = false } = {}) {
  const { check } = knownCheck ? { check: knownCheck } : await rpmChecksRepo.getCheckById(checkId);
  if (!check) {
    const err = new Error("Not found");
    err.status = 404;
    throw err;
  }
  if (check.checkStatus !== "q") {
    const err = new Error("Feedback only on Q checks");
    err.code = "NOT_ELIGIBLE";
    err.status = 400;
    throw err;
  }
  if (!agentAllowed(req, check.agentId)) {
    const err = new Error("Out of scope");
    err.status = 403;
    throw err;
  }
  const status = normalizeFeedbackStatus(body?.feedbackStatus ?? body?.disposition);
  if (!status) {
    const err = new Error("Invalid feedbackStatus");
    err.status = 400;
    throw err;
  }
  if (status === "sale") {
    const err = new Error("Sale is set by RPM Sales auto-link only");
    err.code = "SALE_AUTO_ONLY";
    err.status = 400;
    throw err;
  }
  if (!canManuallySetFeedback(status)) {
    const err = new Error("Invalid feedbackStatus");
    err.status = 400;
    throw err;
  }
  if (isTerminalFeedback(check.feedbackStatus) && check.feedbackStatus === "sale") {
    const err = new Error("Sale feedback is locked");
    err.status = 400;
    throw err;
  }
  if (check.feedbackStatus === "dropped_with_client" && !roles.canEditRpmQFeedback(req.userRole)) {
    const err = new Error("Dropped is terminal");
    err.status = 400;
    throw err;
  }
  const closerId = await resolveFeedbackCloserId(req, body, check.closerId, { forCheckCreate });
  if (!closerId) {
    const err = new Error("closerId required");
    err.status = 400;
    throw err;
  }
  return rpmChecksRepo.setFeedback(checkId, {
    feedbackStatus: status,
    info: body?.info,
    closerId,
    feedbackBy: req.userRole?.employeeId || req.username,
  });
}

function agentAllowed(req, agentId) {
  const employees = scopedEmployees(req);
  return employees.some((e) => e.id === agentId);
}

/** TL: open Qs on led team; completed feedback only if they submitted it (or sale on team). */
function checkVisibleForQFeedbackList(check, req, allowedIds) {
  const role = String(req.userRole?.role || "").toLowerCase();
  const onTeam = allowedIds.has(check.agentId);
  if (role !== "tl") return onTeam;

  const empId = String(req.userRole?.employeeId || "");
  const uname = String(req.username || req.userRole?.username || "");
  const feedbackBy = String(check.feedbackBy || "");
  const closerId = String(check.closerId || "");
  const isOwn =
    (empId && (closerId === empId || feedbackBy === empId)) ||
    (uname && feedbackBy === uname);

  if (!check.feedbackStatus) return onTeam;
  if (check.feedbackStatus === "sale") return onTeam || isOwn;
  return isOwn || (onTeam && closerId && allowedIds.has(closerId));
}

router.get("/agent-scope", async (req, res) => {
  try {
    if (
      !roles.canSubmitRpmChecks(req.userRole) &&
      !roles.canEditRpmChecks(req.userRole) &&
      !roles.canViewRpmChecks(req.userRole)
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const scope = await buildChecksAgentScope(req);
    res.json(scope);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

router.get("/feedback-scope", async (req, res) => {
  try {
    if (
      !roles.canSubmitRpmQFeedback(req.userRole) &&
      !roles.canEditRpmQFeedback(req.userRole) &&
      !roles.canViewRpmQFeedback(req.userRole)
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const forCheckCreate = req.query.forCheckCreate === "1" || req.query.picker === "check";
    const scope = await buildFeedbackCloserScope(req, { forCheckCreate });
    res.json(scope);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

/** RPM Feedback analysis: closer Q→sale + team active targets. */
router.get("/q-feedback-analysis", async (req, res) => {
  try {
    if (!roles.canViewRpmQFeedbackAnalysis(req.userRole)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const analysisLib = require("../lib/rpm-q-feedback-analysis");
    const company = resolveCompany(req);
    const from = String(req.query.from || currentWorkingDay()).slice(0, 10);
    const to = String(req.query.to || from).slice(0, 10);
    const employees = scopedEmployees(req);
    const orgTeams = await hrmsRepo.readOrgTeams();

    let closerTarget = analysisLib.DEFAULT_CLOSER_TARGET;
    try {
      const cfg = store.getConfig() || {};
      const saved = Number(cfg.rpmQFeedbackCloserTarget);
      if (Number.isFinite(saved) && saved >= 0) closerTarget = saved;
    } catch {
      /* default */
    }
    if (req.query.closerTarget != null && String(req.query.closerTarget).trim() !== "") {
      const override = Number(req.query.closerTarget);
      if (Number.isFinite(override) && override >= 0) closerTarget = override;
    }

    const { checks, available } = await rpmChecksRepo.listChecks({
      company,
      fromDay: from,
      toDay: to,
      limit: 5000,
    });
    if (!available) {
      return res.status(503).json({ error: "rpm_checks table not available", available: false });
    }
    const allowedIds = new Set(employees.map((e) => e.id));
    const scoped = (checks || []).filter((c) => {
      if (String(req.userRole?.role || "").toLowerCase() === "tl") {
        return checkVisibleForQFeedbackList(c, req, allowedIds);
      }
      return allowedIds.has(c.agentId) || allowedIds.has(c.closerId);
    });
    const empById = new Map(employees.map((e) => [e.id, e]));
    const missingClosers = [
      ...new Set(scoped.map((c) => c.closerId).filter((id) => id && !empById.has(id))),
    ];
    if (missingClosers.length) {
      const want = new Set(missingClosers);
      const companyClosers = companyContext.filterEmployeesByCompany(
        store.getEmployees({ hideOut: false }),
        company
      );
      for (const e of companyClosers) {
        if (want.has(e.id)) empById.set(e.id, e);
      }
    }
    const enriched = scoped.map((c) => ({
      ...c,
      closerName: empById.get(c.closerId)?.american_name || c.closerName || "",
      agentName: empById.get(c.agentId)?.american_name || c.agentName || "",
    }));

    const attendanceRecords = [];
    try {
      const periodGrid = require("../lib/sales-period-grid");
      for (const ym of periodGrid.attendanceMonthsInRange(from, to)) {
        attendanceRecords.push(...store.getAttendanceEvents(ym));
      }
    } catch {
      /* optional */
    }

    let appUsers = [];
    try {
      const usersAdmin = require("../lib/users-admin");
      appUsers = await usersAdmin.listAppUsers();
    } catch {
      appUsers = [];
    }

    const analysis = analysisLib.buildLiveQFeedbackAnalysis({
      checks: enriched,
      employees: [...empById.values()],
      orgTeams,
      appUsers,
      attendanceRecords,
      from,
      to,
      closerTarget,
    });
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

router.put("/q-feedback-analysis/closer-target", async (req, res) => {
  try {
    if (!roles.canViewRpmQFeedbackAnalysis(req.userRole)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const role = String(req.userRole?.role || "").toLowerCase();
    if (!["admin", "ceo", "rtm", "op"].includes(role)) {
      return res.status(403).json({ error: "Only OP / RTM / Admin can set closer target" });
    }
    const analysisLib = require("../lib/rpm-q-feedback-analysis");
    let target = Number(req.body?.closerTarget);
    if (!Number.isFinite(target) || target < 0) {
      return res.status(400).json({ error: "closerTarget must be a non-negative number" });
    }
    target = Math.round(target * 100) / 100;
    await store.saveConfigKey("rpmQFeedbackCloserTarget", target, req.username);
    res.json({ closerTarget: target || analysisLib.DEFAULT_CLOSER_TARGET });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

router.get("/dashboard-summary", async (req, res) => {
  try {
    if (!roles.canViewRpmChecksDashboard(req.userRole) && !roles.canSubmitRpmChecks(req.userRole)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const company = resolveCompany(req);
    const workingDay = String(req.query.workingDay || currentWorkingDay()).slice(0, 10);
    const employees = scopedEmployees(req);
    const agentIds = new Set(employees.map((e) => e.id));
    const summary = await rpmChecksRepo.dashboardSummary({ company, workingDay, agentIds });
    res.json({ ...summary, workingDay });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

/** Open Q checks for RPM sale form import (same working day, no feedback). */
router.get("/open-for-sale", async (req, res) => {
  try {
    if (!roles.canImportRpmSaleFromCheck(req.userRole)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const agentId = String(req.query.agentId || "").trim();
    if (!agentId) return res.status(400).json({ error: "agentId required" });
    const company = resolveCompany(req);
    const workingDay = String(req.query.workingDay || currentWorkingDay()).slice(0, 10);

    // Same agent picker scope as RPM sale submit (closer teams, TL leads, etc.).
    // Do not use filterEmployeesForUser — that is attendance-scoped and excludes
    // closer-team agents, which broke Import from open Q for closers.
    const { employees, orgTeams } = await loadSubmitEmployeesAndTeams(req);
    const companyEmployees = companyContext.filterEmployeesByCompany(employees, company);
    const agents = saleSubmitScope.employeesForAgentPicker(req.userRole, companyEmployees, {
      orgTeams,
      program: "rpm",
      teamLeadIds: saleSubmitScope.teamLeadIdsFromOrgTeams(orgTeams),
    });
    if (!agents.some((e) => e.id === agentId)) {
      return res.status(403).json({ error: "Agent out of scope" });
    }

    const { checks, available } = await rpmChecksRepo.listChecks({
      company,
      agentId,
      workingDay,
      openFeedbackOnly: true,
      limit: 200,
    });
    if (!available) {
      return res.status(503).json({ error: "rpm_checks table not available", available: false, checks: [] });
    }
    const open = (checks || []).filter(
      (c) =>
        c.checkStatus === "q" &&
        !c.feedbackStatus &&
        !c.linkedRpmSaleId
    );
    res.json({
      workingDay,
      available: true,
      checks: open.map((c) => ({
        id: c.id,
        memberId: c.memberId || "",
        fullName: c.fullName || "",
        phone: c.phone || "",
        dateOfBirth: c.dateOfBirth || null,
        info: c.info || "",
        createdAt: c.createdAt || null,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

router.get("/", async (req, res) => {
  try {
    if (!roles.canViewRpmChecks(req.userRole) && !roles.canViewRpmQFeedback(req.userRole)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const company = resolveCompany(req);
    const checkStatus = req.query.checkStatus
      ? normalizeCheckStatus(req.query.checkStatus)
      : undefined;
    if (checkStatus === "duplicate" && !roles.canViewRpmCheckDuplicates(req.userRole)) {
      // Submitters may still list their own duplicates via Checks page — allow if can submit
      if (!roles.canSubmitRpmChecks(req.userRole)) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }
    const employees = scopedEmployees(req);
    const allowedIds = new Set(employees.map((e) => e.id));
    const { checks, available } = await rpmChecksRepo.listChecks({
      company,
      workingDay: req.query.workingDay || undefined,
      fromDay: req.query.from || undefined,
      toDay: req.query.to || undefined,
      agentId: req.query.agentId || undefined,
      checkStatus: checkStatus || undefined,
      feedbackStatus: req.query.feedbackStatus || undefined,
      openFeedbackOnly: req.query.openFeedbackOnly === "1" || req.query.openFeedbackOnly === "true",
      team: req.query.team || undefined,
      limit: Number(req.query.limit) || 500,
    });
    if (!available) {
      return res.status(503).json({ error: "rpm_checks table not available", available: false });
    }
    const filtered = checks.filter((c) => {
      if (checkStatus === "q") return checkVisibleForQFeedbackList(c, req, allowedIds);
      return allowedIds.has(c.agentId);
    });
    const byId = new Map(employees.map((e) => [e.id, e]));
    // Closer may be outside scoped employees (other team TL/CL) — resolve american_name for display.
    if (checkStatus === "q") {
      const missing = [
        ...new Set(filtered.map((c) => c.closerId).filter((id) => id && !byId.has(id))),
      ];
      if (missing.length) {
        const want = new Set(missing);
        const companyClosers = companyContext.filterEmployeesByCompany(
          store.getEmployees({ hideOut: false }),
          company
        );
        for (const e of companyClosers) {
          if (want.has(e.id)) byId.set(e.id, e);
        }
      }
    }
    res.json({
      checks: filtered.map((c) => ({
        ...c,
        agentName: byId.get(c.agentId)?.american_name || "",
        closerName: byId.get(c.closerId)?.american_name || "",
      })),
      available: true,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

router.post("/", async (req, res) => {
  try {
    if (!assertCanSubmit(req, res)) return;
    const idem = idempotencyKeyFromReq(req);
    if (idem) {
      const cached = getCached(`rpm-check:${idem}`);
      if (cached) return res.status(200).json(cached);
    }
    const company = resolveCompany(req);
    const agentId = String(req.body?.agentId || "").trim();
    if (!agentId) {
      return res.status(400).json({ error: "agentId required" });
    }
    const preFeedbackStatus = normalizeFeedbackStatus(
      req.body?.feedbackStatus ?? req.body?.disposition
    );
    const wantsFeedbackShortcut =
      Boolean(preFeedbackStatus) && normalizeCheckStatus(req.body?.checkStatus) === "q";
    if (wantsFeedbackShortcut) {
      if (!assertCanFeedback(req, res)) return;
      if (preFeedbackStatus === "sale") {
        return res.status(400).json({
          error: "SALE_AUTO_ONLY",
          message: "Sale is set by RPM Sales auto-link only",
        });
      }
      if (!canManuallySetFeedback(preFeedbackStatus)) {
        return res.status(400).json({ error: "Invalid feedbackStatus" });
      }
      try {
        const closerProbe = await resolveFeedbackCloserId(req, req.body, null, { forCheckCreate: true });
        if (!closerProbe) {
          return res.status(400).json({ error: "closerId required" });
        }
      } catch (err) {
        return res.status(err.status || 400).json({ error: err.message || String(err) });
      }
    } else if (
      normalizeFeedbackStatus(req.body?.feedbackStatus ?? req.body?.disposition) &&
      normalizeCheckStatus(req.body?.checkStatus) !== "q"
    ) {
      return res.status(400).json({ error: "Feedback only on Q checks" });
    }
    let agentOk = false;
    try {
      const scope = await buildChecksAgentScope(req);
      agentOk = (scope.agents || []).some((e) => e.id === agentId);
    } catch {
      agentOk = agentAllowed(req, agentId);
    }
    if (!agentOk) {
      return res.status(403).json({ error: "Agent out of scope" });
    }
    const scope = req.userRole?.checksSubmitScope || "self";
    if (
      scope === "self" &&
      req.userRole?.role === "agent" &&
      !roles.hasLeadTeamAssignment(req.userRole) &&
      agentId !== req.userRole.employeeId &&
      !req.userRole.canSubmitChecksQFeedback
    ) {
      // flagged agents with team scope handled below
    }
    if (
      req.userRole?.canSubmitChecksQFeedback &&
      scope === "self" &&
      agentId !== req.userRole.employeeId &&
      !["admin", "ceo", "rtm", "quality", "tl", "op", "checker"].includes(req.userRole.role) &&
      !roles.hasCloserTeamAssignment(req.userRole) &&
      !roles.hasCheckerUnitAssignment(req.userRole)
    ) {
      return res.status(403).json({ error: "Self scope only" });
    }
    const employees = scopedEmployees(req);
    const emp = employees.find((e) => e.id === agentId);
    const check = await rpmChecksRepo.createCheck({
      company,
      agentId,
      memberId: req.body?.memberId,
      fullName: req.body?.fullName,
      dateOfBirth: req.body?.dateOfBirth,
      phone: req.body?.phone,
      team: req.body?.team || emp?.team,
      unit: req.body?.unit || emp?.unit,
      checkStatus: req.body?.checkStatus,
      info: req.body?.info,
      submittedBy: req.userRole?.employeeId || req.username,
      closerId: req.body?.closerId || null,
      workingDay: req.body?.workingDay,
    });
    let finalCheck = check;
    if (wantsFeedbackShortcut) {
      try {
        finalCheck = await applyManualQFeedback(req, check.id, req.body, { check, forCheckCreate: true });
      } catch (err) {
        return res.status(err.status || 400).json({
          error: err.message || String(err),
          code: err.code || undefined,
          check,
          feedbackError: err.message || String(err),
        });
      }
    } else if (check.checkStatus === "q") {
      try {
        const linked = await autoLink.linkCheckToMatchingSale(check, async ({ agentId: aid, memberIdNormalized, workingDay }) => {
          const sales = await rpmRepo.readRpmSales({});
          const companySales = companyContext.filterSalesByCompanyContext(sales, company);
          const norm = stripMemberId(memberIdNormalized);
          return companySales
            .filter(
              (s) =>
                stripMemberId(s.memberId || s.formData?.memberId) === norm &&
                String(s.workingDay || "") === String(workingDay || "")
            )
            .sort((a, b) => {
              const aSame = String(a.agentId) === String(aid) ? 0 : 1;
              const bSame = String(b.agentId) === String(aid) ? 0 : 1;
              if (aSame !== bSame) return aSame - bSame;
              return String(a.createdAt || a.submissionDate || "").localeCompare(String(b.createdAt || b.submissionDate || ""));
            });
        });
        if (linked) Object.assign(finalCheck, linked);
      } catch {
        /* non-fatal */
      }
    }
    const payload = { check: finalCheck };
    if (idem) setCached(`rpm-check:${idem}`, payload);
    res.status(201).json(payload);
  } catch (err) {
    return sendCheckMutationError(res, err);
  }
});

router.patch("/:id", async (req, res) => {
  try {
    if (!roles.canEditRpmChecks(req.userRole)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { check } = await rpmChecksRepo.getCheckById(req.params.id);
    if (!check) return res.status(404).json({ error: "Not found" });
    if (!agentAllowed(req, check.agentId)) {
      return res.status(403).json({ error: "Out of scope" });
    }
    if (req.body?.agentId && req.body.agentId !== check.agentId) {
      return res.status(400).json({ error: "Cannot change agent; clear sale link via Admin if needed" });
    }
    const updated = await rpmChecksRepo.updateCheck(req.params.id, req.body || {});
    res.json({ check: updated });
  } catch (err) {
    return sendCheckMutationError(res, err);
  }
});

/**
 * Full-row Q Feedback edit (Admin / OP / editors): member fields + disposition + closer.
 * Sale-linked rows keep disposition locked; member/info still editable.
 */
router.patch("/:id/feedback", async (req, res) => {
  try {
    if (!roles.canEditRpmQFeedback(req.userRole)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { check } = await rpmChecksRepo.getCheckById(req.params.id);
    if (!check) return res.status(404).json({ error: "Not found" });
    if (check.checkStatus !== "q") {
      return res.status(400).json({ error: "NOT_ELIGIBLE", message: "Edit only on Q checks" });
    }
    if (!agentAllowed(req, check.agentId)) {
      return res.status(403).json({ error: "Out of scope" });
    }

    const body = req.body || {};
    const saleLocked = check.feedbackStatus === "sale" || Boolean(check.linkedRpmSaleId);

    await rpmChecksRepo.updateCheck(req.params.id, {
      fullName: body.fullName !== undefined ? body.fullName : undefined,
      dateOfBirth: body.dateOfBirth !== undefined ? body.dateOfBirth : undefined,
      phone: body.phone !== undefined ? body.phone : undefined,
      memberId: body.memberId !== undefined ? body.memberId : undefined,
      info: body.info !== undefined ? body.info : undefined,
      team: body.team !== undefined ? body.team : undefined,
      unit: body.unit !== undefined ? body.unit : undefined,
    });

    const statusRaw = body.feedbackStatus ?? body.disposition;
    const clearFeedback = body.clearFeedback === true || statusRaw === null || statusRaw === "";

    let updated;
    if (saleLocked) {
      if (statusRaw != null && statusRaw !== "" && statusRaw !== "sale") {
        return res.status(400).json({ error: "Sale feedback is locked" });
      }
      if (body.closerId !== undefined) {
        updated = await rpmChecksRepo.updateCheck(req.params.id, { closerId: body.closerId || null });
      } else {
        const again = await rpmChecksRepo.getCheckById(req.params.id);
        updated = again.check;
      }
    } else if (clearFeedback) {
      updated = await rpmChecksRepo.clearFeedback(req.params.id);
      if (body.info !== undefined) {
        updated = await rpmChecksRepo.updateCheck(req.params.id, { info: body.info });
      }
    } else if (statusRaw != null && statusRaw !== undefined) {
      const status = String(statusRaw).trim();
      if (status === "sale") {
        return res.status(400).json({ error: "SALE_AUTO_ONLY", message: "Sale is set by RPM Sales auto-link only" });
      }
      if (!canManuallySetFeedback(status)) {
        return res.status(400).json({ error: "Invalid feedbackStatus" });
      }
      let closerId = String(body.closerId || "").trim() || check.closerId || null;
      const role = String(req.userRole?.role || "").toLowerCase();
      const canAssignCloser =
        role === "tl" ||
        roles.hasLeadTeamAssignment(req.userRole) ||
        ["admin", "ceo", "rtm", "quality", "op"].includes(role) ||
        roles.hasCloserTeamAssignment(req.userRole);
      if (!canAssignCloser || !closerId) {
        closerId = req.userRole?.employeeId || closerId || null;
      }
      if (!closerId) {
        return res.status(400).json({ error: "closerId required" });
      }
      try {
        const scope = await buildFeedbackCloserScope(req);
        const allowed = new Set((scope.closers || []).map((e) => e.id));
        if (!allowed.has(closerId)) {
          if (scope.lockCloser && req.userRole?.employeeId) {
            closerId = req.userRole.employeeId;
          } else {
            return res.status(403).json({ error: "Closer not allowed for your role" });
          }
        }
      } catch {
        /* keep closerId if scope fails */
      }
      updated = await rpmChecksRepo.setFeedback(req.params.id, {
        feedbackStatus: status,
        info: body.info,
        closerId,
        feedbackBy: req.userRole?.employeeId || req.username,
      });
    } else {
      if (body.closerId !== undefined) {
        updated = await rpmChecksRepo.updateCheck(req.params.id, { closerId: body.closerId || null });
      } else {
        const again = await rpmChecksRepo.getCheckById(req.params.id);
        updated = again.check;
      }
    }

    res.json({ check: updated });
  } catch (err) {
    return sendCheckMutationError(res, err);
  }
});

router.delete("/:id", async (req, res) => {
  try {
    if (!roles.canEditRpmChecks(req.userRole) && !roles.canSubmitRpmChecks(req.userRole)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { check } = await rpmChecksRepo.getCheckById(req.params.id);
    if (!check) return res.status(404).json({ error: "Not found" });
    if (!agentAllowed(req, check.agentId)) {
      return res.status(403).json({ error: "Out of scope" });
    }
    const deleted = await rpmChecksRepo.softDeleteCheck(req.params.id);
    res.json({ check: deleted });
  } catch (err) {
    res.status(400).json({ error: err.message || String(err) });
  }
});

router.post("/:id/feedback", async (req, res) => {
  try {
    if (!assertCanFeedback(req, res)) return;
    const idem = idempotencyKeyFromReq(req);
    if (idem) {
      const cached = getCached(`rpm-feedback:${idem}`);
      if (cached) return res.status(200).json(cached);
    }
    const updated = await applyManualQFeedback(req, req.params.id, req.body || {});
    const payload = { check: updated };
    if (idem) setCached(`rpm-feedback:${idem}`, payload);
    res.json(payload);
  } catch (err) {
    res.status(err.status || 400).json({
      error: err.message || String(err),
      code: err.code || undefined,
    });
  }
});

module.exports = router;

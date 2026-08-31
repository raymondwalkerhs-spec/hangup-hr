const express = require("express");
const fs = require("fs");
const roles = require("../lib/roles");
const business = require("../lib/business-repo");
const store = require("../lib/data-store");
const salesScope = require("../lib/sales-scope");
const rpmCatalog = require("../lib/sales-rpm-field-catalog");
const rpmFieldAccess = require("../lib/rpm-sales-field-access");
const rpmListColumns = require("../lib/rpm-sales-list-columns");
const rpmAttachmentPerms = require("../lib/sales-rpm-attachment-permissions");
const rpmRepo = require("../lib/rpm-sales-repo");
const rpmStatus = require("../lib/rpm-sales-status");
const saleStorage = require("../lib/sale-attachment-storage");
const saleAttachmentCache = require("../lib/sale-attachment-cache");
const hrmsRepo = require("../lib/hrms-repo");
const workingDayLib = require("../lib/sales-working-day");
const egyptDatetime = require("../lib/egypt-datetime");
const saleSubmitScope = require("../lib/sale-submit-scope");
const saleProgramAccess = require("../lib/sale-program-access");
const rpmSubmitRequired = require("../lib/sales-rpm-submit-required");
const salesClients = require("../lib/sales-clients-repo");
const rpmActionPerms = require("../lib/sales-rpm-action-permissions");
const rpmSubmissionCorrection = require("../lib/rpm-sales-submission-correction");
const companyContext = require("../lib/company-context");

const router = express.Router();

const MAX_ATTACHMENT_BYTES = 35 * 1024 * 1024;

function assertAttachmentPayloadSize(contentBase64) {
  const buf = Buffer.from(String(contentBase64 || ""), "base64");
  if (buf.length > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: `File too large (max ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB)` };
  }
  return { ok: true, buffer: buf };
}

async function canPerformRpmAction(userRole, actionKey) {
  const role = userRole?.role || "agent";
  await rpmActionPerms.loadMap();
  return rpmActionPerms.canPerformActionSync(actionKey, role);
}

function scopedEmployees(req, opts = {}) {
  const employeeAppRole = require("../lib/employee-app-role");
  let employees = store.getEmployees({ hideOut: opts.hideOut !== undefined ? opts.hideOut : false });
  const company = companyContext.resolveCompanyContextForUser(req.query.company, req.userRole);
  employees = companyContext.filterEmployeesByCompany(employees, company);
  if (req.userRole) {
    employees = roles.filterEmployeesForUser(employees, req.userRole);
  }
  return employeeAppRole.enrichEmployeesWithAppRole(employees);
}

function filterRpmForRequest(sales, req) {
  const company = companyContext.resolveCompanyContextForUser(
    req.query.company || req.body?.company,
    req.userRole
  );
  return companyContext.filterSalesByCompanyContext(sales, company);
}

function enrichRpmDisplayNames(sales, employees) {
  const list = employees?.length ? employees : store.getEmployees();
  const byId = new Map((list || []).map((e) => [e.id, e]));
  return (sales || []).map((s) => {
    const fd = s.formData || {};
    const reviewerId = fd.reviewer || "";
    const verifierId = fd.assignVerifier || "";
    return {
      ...s,
      agentDisplayName: byId.get(s.agentId)?.american_name || "",
      closerDisplayName: byId.get(s.closerId)?.american_name || "",
      reviewerDisplayName: byId.get(reviewerId)?.american_name || "",
      verifierDisplayName: byId.get(verifierId)?.american_name || "",
      formData: {
        ...fd,
        agentName: byId.get(s.agentId)?.american_name || fd.agentName || "",
        closerName: byId.get(s.closerId)?.american_name || fd.closerName || "",
        reviewerName: byId.get(reviewerId)?.american_name || fd.reviewerName || "",
        verifierName: byId.get(verifierId)?.american_name || fd.verifierName || "",
      },
    };
  });
}

function rpmRedactOpts(req) {
  return { surface: "main", user: req.userRole };
}

async function assertRpmSaleAccess(req, saleId) {
  const existing = await rpmRepo.getRpmSale(saleId);
  if (!existing) return { error: "Sale not found", status: 404 };
  const employees = scopedEmployees(req);
  const grants = await business.readSalesVisibilityGrants(req.username);
  const visible = salesScope.filterSalesForUser([existing], req.userRole, employees, grants);
  if (!visible.length) return { error: "No access", status: 403 };
  const filtered = filterRpmForRequest([existing], req);
  if (!filtered.length) return { error: "No access", status: 403 };
  return { sale: existing };
}

/** RPM quality ticket workflow: quality / RTM / admin (via workQualityTicket). Agents, TL, OP use view sale only. */
function canOpenRpmQualityTicket(userRole) {
  return roles.canWorkQualityTicket(userRole);
}

async function canUserManageRpmAttachmentKind(userRole, kind) {
  const role = userRole?.role || "agent";
  const attachMap = await rpmAttachmentPerms.loadMap();
  if (!rpmCatalog.canEditAttachmentKind(kind || "recording", role, attachMap)) return false;
  if (roles.canEditSale(userRole)) return true;
  if (roles.canWorkQualityTicket(userRole)) return true;
  return false;
}

async function recalcAgentSalesFromRpmSale(sale, actor) {
  if (!sale?.agentId) return;
  const { isOtherAgentId } = require("../lib/other-agent");
  if (isOtherAgentId(sale.agentId)) return;
  const wd = sale.workingDay || workingDayLib.computeWorkingDay(sale.submissionDate);
  const ym = String(wd || "").slice(0, 7);
  if (!ym) return;
  try {
    await store.recalcSalesCountForEmployee(ym, sale.agentId, actor || "system");
  } catch (_) {
    /* non-fatal */
  }
}

async function validateSaleUnitTeam(unit, team) {
  const { teamsMatch } = require("../lib/team-names");
  const u = String(unit || "").trim();
  const t = String(team || "").trim();
  if (!u || !t) return { ok: false, error: "Unit and team are required" };
  const orgTeams = await hrmsRepo.readOrgTeams();
  const match = (orgTeams || []).find((row) => teamsMatch(row.name, t) && String(row.unit || "") === u);
  if (!match) return { ok: false, error: "Invalid unit/team combination" };
  if (match.dialsSales === false) return { ok: false, error: "Only dialing teams can be selected" };
  return { ok: true, unit: u, team: match.name || t };
}

function enrichSaleAgent(emp) {
  return { team: emp?.team || "", unit: emp?.unit || "" };
}

router.get("/clients", async (req, res) => {
  try {
    const saleCompany = companyContext.resolveCompanyContextForUser(req.query.company, req.userRole);
    const catalog = await salesClients.readSalesClientsCatalog(saleCompany, { saleProgram: "rpm" });
    res.json({ clients: catalog });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/submit-scope", async (req, res) => {
  if (!roles.canSubmitSales(req.userRole) || !(await canPerformRpmAction(req.userRole, "submit_sale"))) {
    return res.status(403).json({ error: "You may not submit new sales" });
  }
  try {
    const employeeAppRole = require("../lib/employee-app-role");
    const company = companyContext.resolveCompanyContextForUser(req.query.company, req.userRole);
    await store.ensureEmployeesFresh();
    const employees = employeeAppRole.enrichEmployeesWithLiveAppRole(store.getEmployees({ hideOut: true }));
    const orgTeams = await hrmsRepo.readOrgTeams();
    const scope = saleSubmitScope.buildSubmitScopePayload(req.userRole, employees, orgTeams, {
      program: "rpm",
      company,
    });
    res.json({
      ...scope,
      enabledPrograms: saleProgramAccess.enabledProgramsForSubmitter(req.userRole, employees),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/identity-check", async (req, res) => {
  if (!roles.canSubmitSales(req.userRole) || !(await canPerformRpmAction(req.userRole, "submit_sale"))) {
    return res.status(403).json({ error: "You may not submit new sales" });
  }
  try {
    const identity = require("../lib/rpm-sale-identity");
    const phoneNumbers = [
      req.query.phone,
      req.query.phoneNumber,
      req.query.alternativePhone,
    ].filter(Boolean);
    let priors = await rpmRepo.findIdentityDuplicateRpmSales({
      phoneNumbers,
      memberId: req.query.memberId,
      limit: 25,
    });
    priors = filterRpmForRequest(priors, req);
    res.json({
      priors: priors.slice(0, 12).map((sale) => ({
        id: sale.id,
        date: identity.saleDateLabel(sale),
        clientFeedback: identity.clientFeedbackLabel(sale),
        phoneNumber: sale.phoneNumber,
        memberId: sale.memberId,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  if (!roles.canSubmitSales(req.userRole) || !(await canPerformRpmAction(req.userRole, "submit_sale"))) {
    return res.status(403).json({ error: "You may not submit new sales" });
  }
  const { agentId, closerId } = req.body;
  if (!agentId) return res.status(400).json({ error: "agentId required" });
  const { isOtherAgentId } = require("../lib/other-agent");
  const otherAgent = isOtherAgentId(agentId);
  const emp = store.getEmployeeById(agentId);
  if (!emp) return res.status(404).json({ error: "Agent not found" });
  if (!otherAgent) {
    const programCheck = saleProgramAccess.assertAgentProgramEnabled(emp, "rpm", req.userRole);
    if (!programCheck.ok) return res.status(403).json({ error: programCheck.error });
  }
  const saleCompany = companyContext.resolveCompanyContextForUser(req.body.company || req.query.company, req.userRole);
  const employeeAppRole = require("../lib/employee-app-role");
  const employees = employeeAppRole.enrichEmployeesWithLiveAppRole(
    companyContext.filterEmployeesByCompany(store.getEmployees({ hideOut: true }), saleCompany)
  );
  const orgTeams = await hrmsRepo.readOrgTeams();
  const assignment = saleSubmitScope.validateSaleSubmitAssignment(
    req.userRole,
    {
      agentId,
      closerId,
      unit: emp.unit || req.body.unit || req.body.formData?.unit,
      team: emp.team || req.body.team || req.body.formData?.team,
    },
    employees,
    {
      program: "rpm",
      teamLeadIds: saleSubmitScope.teamLeadIdsFromOrgTeams(orgTeams),
      orgTeams,
    }
  );
  if (!assignment.ok) return res.status(403).json({ error: assignment.error });
  let unitTeam;
  if (otherAgent) {
    unitTeam = {
      ok: true,
      unit: String(req.body.unit || req.body.formData?.unit || assignment.unit || "").trim(),
      team: String(req.body.team || req.body.formData?.team || assignment.team || "").trim(),
    };
  } else {
    unitTeam = await validateSaleUnitTeam(
      emp.unit || assignment.unit || req.body.unit || req.body.formData?.unit,
      emp.team || assignment.team || req.body.team || req.body.formData?.team
    );
    if (!unitTeam.ok) return res.status(400).json({ error: unitTeam.error });
  }
  try {
    const sanitizedForm = await rpmFieldAccess.sanitizeIncomingFormData(req.body.formData || req.body, req.userRole, {
      create: true,
    });
    if (Array.isArray(req.body.formData?.medicalConditions)) {
      sanitizedForm.medicalConditions = req.body.formData.medicalConditions;
    } else if (req.body.medicalConditions) {
      sanitizedForm.medicalConditions = req.body.medicalConditions;
    }
    const built = rpmFieldAccess.buildPayloadFromBody(req.body, sanitizedForm);
    const submitValidation = rpmSubmitRequired.validateRpmSaleSubmitPayload({
      ...req.body,
      ...built,
      agentId,
      closerId: assignment.closerId,
      unit: unitTeam.unit,
      team: unitTeam.team,
      formData: sanitizedForm,
    });
    if (!submitValidation.ok) {
      return res.status(400).json({ error: "Validation failed", errors: submitValidation.errors });
    }
    const egyptSubmission = egyptDatetime.egyptNowFormatted();
    const dates = workingDayLib.enrichSaleDates({}, egyptSubmission);
    const dup = await rpmRepo.findRecentDuplicateRpmSale({
      phoneNumber: built.phoneNumber,
      agentId,
      ignoreAgent: otherAgent,
      workingDay: dates.workingDay,
    });
    if (dup) return res.status(409).json({ error: "Sale already submitted", saleId: dup.id });

    const identity = require("../lib/rpm-sale-identity");
    const phoneCandidates = [
      built.phoneNumber,
      sanitizedForm.alternativePhone,
      sanitizedForm.alternativePhoneNumber,
      sanitizedForm.altPhone,
      sanitizedForm.phoneNumber,
    ].filter(Boolean);
    let priorDupes = [];
    try {
      priorDupes = await rpmRepo.findIdentityDuplicateRpmSales({
        phoneNumbers: phoneCandidates,
        memberId: built.memberId || sanitizedForm.memberId,
        limit: 25,
      });
    } catch (dupErr) {
      console.warn("rpm identity duplicate check failed:", dupErr?.message || dupErr);
    }

    const initialStatus = salesScope.initialSaleStatus(req.userRole.role, undefined);
    const sale = await rpmRepo.createRpmSale(
      {
        phoneNumber: built.phoneNumber,
        fullName: built.fullName,
        client: built.client,
        memberId: built.memberId,
        agentId,
        closerId: assignment.closerId,
        status: initialStatus,
        submissionDate: dates.submissionDate,
        effectiveDate: built.effectiveDate || dates.workingDay,
        feedback: built.feedback || "",
        team: unitTeam.team,
        unit: unitTeam.unit,
        formData: {
          ...sanitizedForm,
          unit: unitTeam.unit,
          team: unitTeam.team,
          agentName: emp.american_name || (otherAgent ? "Other" : ""),
        },
      },
      req.username
    );
    try {
      const autoLink = require("../lib/rpm-check-auto-link");
      await autoLink.linkSaleToMatchingCheck(sale, {
        company: companyContext.getCompanyForUnit(sale.unit || sale.formData?.unit) ||
          companyContext.resolveCompanyContextForUser(req.body?.company, req.userRole),
      });
    } catch (linkErr) {
      console.warn("rpm check auto-link failed:", linkErr?.message || linkErr);
    }
    const closerEmp = store.getEmployeeById(assignment.closerId);
    if (closerEmp?.american_name) {
      await rpmRepo.updateRpmSale(
        sale.id,
        { formData: { ...sale.formData, closerName: closerEmp.american_name } },
        req.username
      );
    }
    if (priorDupes.length) {
      try {
        const dispatch = require("../lib/notify-dispatch");
        const closerName = closerEmp?.american_name || assignment.closerId || req.username || "Closer";
        const reasons = [];
        const newPhones = identity.collectRpmSalePhones({
          phoneNumber: built.phoneNumber,
          formData: sanitizedForm,
        });
        const newMid = identity.normalizeMemberIdKey(built.memberId || sanitizedForm.memberId);
        const phoneHit = priorDupes.some((p) => identity.phonesOverlap(newPhones, identity.collectRpmSalePhones(p)));
        const midHit = newMid && priorDupes.some((p) => identity.normalizeMemberIdKey(p.memberId) === newMid);
        if (phoneHit) reasons.push("phone");
        if (midHit) reasons.push("Member ID");
        const summary = identity.formatDuplicatePriorSummary(priorDupes.slice(0, 12));
        await dispatch.dispatchNotification({
          actionKey: "rpm_sale_duplicate",
          type: "rpm_sale_duplicate",
          title: "RPM duplicate sale submitted",
          body: `${closerName} submitted ${built.fullName || "a sale"} with duplicate ${reasons.join(" / ") || "identity"}. Previous sales: ${summary || "see Sales log"}.`,
          entityType: "sale",
          entityId: String(sale.id),
          actor: req.username,
          context: { company: saleCompany },
        });
      } catch (notifyErr) {
        console.warn("rpm duplicate notify failed:", notifyErr?.message || notifyErr);
      }
    }
    await recalcAgentSalesFromRpmSale(sale, req.username);
    const [redacted] = await rpmFieldAccess.redactSalesForRole([sale], req.userRole, rpmRedactOpts(req));
    res.json({
      ok: true,
      sale: redacted,
      duplicateWarning: priorDupes.length
        ? {
            count: priorDupes.length,
            priors: priorDupes.slice(0, 12).map((p) => ({
              id: p.id,
              date: identity.saleDateLabel(p),
              clientFeedback: identity.clientFeedbackLabel(p),
              phoneNumber: p.phoneNumber,
              memberId: p.memberId,
            })),
          }
        : null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/", async (req, res) => {
  if (!roles.canViewSales(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  try {
    const employees = scopedEmployees(req);
    const grants = await business.readSalesVisibilityGrants(req.username);
    const role = String(req.userRole?.role || "agent").toLowerCase();
    const restrictToToday =
      (role === "agent" || role === "tl") && roles.canViewSalesThisMonth(req.userRole) !== true;
    const todayWorkingDay = workingDayLib.currentWorkingDay();
    const qFrom = restrictToToday ? undefined : req.query.from;
    const qTo = restrictToToday ? undefined : req.query.to;
    const qDay = restrictToToday ? todayWorkingDay : req.query.day;
    let sales = await rpmRepo.readRpmSales({
      from: qFrom,
      to: qTo,
      agentId: req.query.agentId,
      closerId: req.query.closerId,
      team: req.query.team,
      unit: req.query.unit,
      status: req.query.status,
      retransfer: req.query.retransfer,
      day: qDay,
      client: req.query.client,
      reviewerFeedback: req.query.reviewerFeedback,
      clientFeedback: req.query.clientFeedback,
      sort: req.query.sort,
    });
    sales = salesScope.filterSalesForUser(sales, req.userRole, employees, grants);
    sales = filterRpmForRequest(sales, req);
    if (req.query.duplicates === "1" || req.query.duplicates === "true") {
      sales = rpmRepo.filterAndGroupDuplicateRpmSales(sales);
    }
    sales = enrichRpmDisplayNames(sales, store.getEmployees());
    sales = await rpmFieldAccess.redactSalesForRole(sales, req.userRole, rpmRedactOpts(req));
    const listColumns = await rpmListColumns.getVisibleColumnsForUser(req.userRole?.role);
    res.json({
      sales,
      listColumns,
      statuses: ["passed", "pending", "denied", "callback"],
      program: "rpm",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/field-catalog", async (req, res) => {
  try {
    const perms = await business.readRpmSalesFieldPermissions();
    const permMap = Object.fromEntries(perms.map((p) => [p.fieldKey, p]));
    const attachMap = await rpmAttachmentPerms.loadMap();
    const role = req.userRole?.role || "agent";
    const surface = String(req.query.surface || "main").toLowerCase();
    const allFields = req.query.allFields === "1" && roles.canManageAll(req.userRole);
    let sale = null;
    if (req.query.saleId) {
      const access = await assertRpmSaleAccess(req, String(req.query.saleId));
      if (access.error) return res.status(access.status).json({ error: access.error });
      sale = access.sale;
    }
    const fieldOpts = { user: req.userRole, sale, surface, attachPermMap: attachMap };
    let fields;
    if (allFields) {
      fields = rpmCatalog.FIELDS.filter((f) => !rpmCatalog.isSystemHiddenField(f)).map((f) =>
        rpmCatalog.mapFieldForRole(f, role, permMap[f.key], { ...fieldOpts, surface })
      );
    } else if (surface === "quality") {
      fields = rpmCatalog.listFieldsForRoleOnSurface(role, permMap, "quality", fieldOpts);
    } else if (surface === "submit") {
      if (!roles.canSubmitSales(req.userRole)) {
        return res.status(403).json({ error: "You may not submit new sales" });
      }
      fields = rpmCatalog.listFieldsForSubmit(role);
    } else {
      fields = rpmCatalog.listFieldsForRole(role, permMap, { ...fieldOpts, surface: "main" });
    }
    const attachmentKinds =
      surface === "submit"
        ? rpmCatalog.listAttachmentKindsForSubmit(role)
        : rpmCatalog.listAttachmentKindsForRole(role, { attachPermMap: attachMap, ...fieldOpts });
    res.json({
      fields,
      sections: rpmCatalog.listSections(),
      attachmentKinds,
      attachmentPermissions: Object.values(attachMap),
      permissions: perms,
      storageConfigured: saleStorage.isConfigured(),
      surface,
      program: "rpm",
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
    const perm = await business.upsertRpmSalesFieldPermission(req.params.fieldKey, req.body);
    rpmFieldAccess.invalidatePermissionsCache();
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
    await rpmCatalog.seedDefaultPermissions(getSupabaseAdmin());
    await rpmActionPerms.seedDefaults();
    await rpmListColumns.seedDefaultColumns();
    rpmFieldAccess.invalidatePermissionsCache();
    rpmListColumns.invalidateCache();
    rpmAttachmentPerms.invalidateCache();
    const perms = await business.readRpmSalesFieldPermissions();
    res.json({ ok: true, count: perms.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/attachment-permissions/:attachmentKey", async (req, res) => {
  if (!roles.canManageSalesFieldPermissions(req.userRole)) {
    return res.status(403).json({ error: "Admin/RTM/HR only" });
  }
  try {
    const { viewRoles, editRoles, label } = req.body || {};
    if (!Array.isArray(viewRoles) || !Array.isArray(editRoles)) {
      return res.status(400).json({ error: "viewRoles and editRoles arrays required" });
    }
    const attachment = await rpmAttachmentPerms.upsert(req.params.attachmentKey, {
      label,
      viewRoles,
      editRoles,
    });
    res.json({ ok: true, attachment });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/list-columns", async (req, res) => {
  try {
    const all = await rpmListColumns.listColumns();
    const visible = await rpmListColumns.getVisibleColumnsForUser(req.userRole?.role);
    res.json({ columns: all, visibleColumns: visible, program: "rpm" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/list-columns", async (req, res) => {
  if (!roles.canManageSalesFieldPermissions(req.userRole)) {
    return res.status(403).json({ error: "Admin/RTM only" });
  }
  try {
    const updates = Array.isArray(req.body?.columns) ? req.body.columns : req.body;
    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: "columns array required" });
    }
    const cols = await rpmListColumns.upsertColumnsBatch(updates);
    rpmListColumns.invalidateCache();
    res.json({ ok: true, columns: cols });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/list-columns/seed", async (req, res) => {
  if (!roles.canManageSalesFieldPermissions(req.userRole)) {
    return res.status(403).json({ error: "Admin/RTM only" });
  }
  try {
    const result = await rpmListColumns.seedDefaultColumns();
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
    const actions = await rpmActionPerms.listAll();
    res.json({ actions, permissions: actions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/action-permissions/:actionKey", async (req, res) => {
  if (!roles.canManageSalesFieldPermissions(req.userRole)) {
    return res.status(403).json({ error: "Admin/RTM only" });
  }
  try {
    const { allowedRoles, label } = req.body || {};
    if (!Array.isArray(allowedRoles)) {
      return res.status(400).json({ error: "allowedRoles array required" });
    }
    const action = await rpmActionPerms.upsertActionPermission(req.params.actionKey, {
      label,
      allowedRoles,
    });
    res.json({ ok: true, action });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/:id/attachments", async (req, res) => {
  try {
    const access = await assertRpmSaleAccess(req, req.params.id);
    if (access.error) return res.status(access.status).json({ error: access.error });
    const attachments = await rpmRepo.readRpmSaleAttachments(req.params.id);
    const role = req.userRole?.role || "agent";
    const attachMap = await rpmAttachmentPerms.loadMap();
    const filtered = attachments.filter(
      (a) => !a.kind || rpmCatalog.canViewAttachmentKind(a.kind, role, attachMap)
    );
    res.json({ attachments: filtered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/attachments", async (req, res) => {
  try {
    const access = await assertRpmSaleAccess(req, req.params.id);
    if (access.error) return res.status(access.status).json({ error: access.error });
    if (!roles.canWorkQualityTicket(req.userRole) && !roles.canEditSale(req.userRole)) {
      return res.status(403).json({ error: "No permission to upload attachments" });
    }
    const { readUploadBuffer } = require("../lib/read-upload-buffer");
    const parsed = await readUploadBuffer(req, {
      assertSize: (payload) => {
        if (Buffer.isBuffer(payload)) {
          if (payload.length > MAX_ATTACHMENT_BYTES) {
            return { ok: false, error: `File too large (max ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB)` };
          }
          return { ok: true, buffer: payload };
        }
        return assertAttachmentPayloadSize(payload);
      },
    });
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const fileName = parsed.fileName;
    const kindKey = parsed.kind || "recording";
    if (!(await canUserManageRpmAttachmentKind(req.userRole, kindKey))) {
      return res.status(403).json({ error: "No permission to upload this attachment type" });
    }
    const buffer = parsed.buffer;
    const uploaded = await saleStorage.uploadRpmSaleAttachmentBuffer({
      saleId: req.params.id,
      kind: kindKey,
      fileName,
      buffer,
    });
    const att = await rpmRepo.createRpmSaleAttachment(
      {
        rpmSaleId: req.params.id,
        kind: kindKey,
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
  try {
    const att = await rpmRepo.getRpmSaleAttachment(req.params.attachmentId);
    if (!att) return res.status(404).json({ error: "Attachment not found" });
    const access = await assertRpmSaleAccess(req, att.rpmSaleId);
    if (access.error) return res.status(access.status).json({ error: access.error });
    if (!(await canUserManageRpmAttachmentKind(req.userRole, att.kind))) {
      return res.status(403).json({ error: "No permission" });
    }
    await rpmRepo.deleteRpmSaleAttachment(att.id, req.username);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/attachments/:attachmentId/file", async (req, res) => {
  try {
    const att = await rpmRepo.getRpmSaleAttachment(req.params.attachmentId);
    if (!att) return res.status(404).json({ error: "Attachment not found" });
    const access = await assertRpmSaleAccess(req, att.rpmSaleId);
    if (access.error) return res.status(access.status).json({ error: access.error });
    const role = req.userRole?.role || "agent";
    const attachMap = await rpmAttachmentPerms.loadMap();
    if (!rpmCatalog.canViewAttachmentKind(att.kind, role, attachMap)) {
      return res.status(403).json({ error: "No permission" });
    }
    const file = await saleAttachmentCache.getOrFetch(att);
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.fileName)}"`);
    res.setHeader("X-Cache-Hit", file.fromCache ? "1" : "0");
    fs.createReadStream(file.filePath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/attachments/:attachmentId/download", async (req, res) => {
  try {
    const att = await rpmRepo.getRpmSaleAttachment(req.params.attachmentId);
    if (!att) return res.status(404).json({ error: "Attachment not found" });
    const access = await assertRpmSaleAccess(req, att.rpmSaleId);
    if (access.error) return res.status(access.status).json({ error: access.error });
    const role = req.userRole?.role || "agent";
    const attachMap = await rpmAttachmentPerms.loadMap();
    if (!rpmCatalog.canViewAttachmentKind(att.kind, role, attachMap)) {
      return res.status(403).json({ error: "No permission" });
    }
    const file = await saleAttachmentCache.getOrFetch(att);
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.fileName)}"`);
    fs.createReadStream(file.filePath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const access = await assertRpmSaleAccess(req, req.params.id);
    if (access.error) return res.status(access.status).json({ error: access.error });
    const existing = access.sale;

    // This deliberately bypasses the configurable general edit permission:
    // only Admin/RTM can correct a historic RPM submission timestamp.
    if (req.body.submissionDateTime !== undefined) {
      if (!rpmSubmissionCorrection.canCorrectSubmissionDate(req.userRole)) {
        return res.status(403).json({ error: "Only RTM, Admin, or CEO can correct RPM submission date and time" });
      }
      const submissionDate = rpmSubmissionCorrection.normalizeSubmissionDateTime(req.body.submissionDateTime);
      const patch = {
        submissionDate,
        submissionTime: workingDayLib.computeSubmissionTime(submissionDate),
        workingDay: workingDayLib.computeWorkingDay(submissionDate),
      };
      const before = existing;
      const sale = await rpmRepo.updateRpmSale(req.params.id, patch, req.username);
      try {
        const saleEditHistory = require("../lib/sale-edit-history");
        await saleEditHistory.recordSaleDiff({
          program: "rpm",
          saleId: req.params.id,
          before,
          after: sale,
          changedBy: req.username,
          source: "submission_correction",
          employees: store.getEmployees({ hideOut: false, includeDeleted: true }),
        });
      } catch (histErr) {
        console.warn("sale edit history (rpm correction):", histErr.message);
      }
      await recalcAgentSalesFromRpmSale(sale, req.username);
      const [redacted] = await rpmFieldAccess.redactSalesForRole([sale], req.userRole, rpmRedactOpts(req));
      return res.json({ ok: true, sale: redacted });
    }

    let responseSurface = "main";

    const canEditRpm =
      roles.canEditSale(req.userRole) || (await canPerformRpmAction(req.userRole, "edit_sale"));
    if (
      req.body.edit === true ||
      canEditRpm ||
      roles.canWorkQualityTicket(req.userRole) ||
      (req.body.qualityTicket === true && canOpenRpmQualityTicket(req.userRole))
    ) {
      const ticketOnly = req.body.qualityTicket === true;
      if (ticketOnly) responseSurface = "quality";
      if (ticketOnly) {
        if (!canOpenRpmQualityTicket(req.userRole)) {
          return res.status(403).json({ error: "No permission for quality tickets" });
        }
      } else if (!canEditRpm) {
        return res.status(403).json({ error: "No permission to edit sales" });
      }

      const mergedForm = { ...(existing.formData || {}), ...(req.body.formData || {}) };
      const sanitizedForm = await rpmFieldAccess.sanitizeIncomingFormData(mergedForm, req.userRole, {
        create: false,
        sale: existing,
        qualityTicket: ticketOnly,
        surface: ticketOnly ? "quality" : "main",
      });

      const synced = rpmStatus.syncSaleStatusFromQuality(sanitizedForm);

      const employees = scopedEmployees(req, { hideOut: false });
      const employeeAppRole = require("../lib/employee-app-role");
      const { validateQualityAssignees, isNonDialingReviewer } = require("../lib/sales-quality-assignees");
      const rpmEmpById = new Map(employees.map((e) => [e.id, e]));
      const assignCheck = validateQualityAssignees(synced.formData, (id) => {
        const scoped = rpmEmpById.get(id);
        const emp = scoped || store.getEmployeeById(id);
        return emp ? employeeAppRole.enrichEmployeeWithLiveAppRole(emp) : null;
      });
      if (!assignCheck.ok) return res.status(400).json({ error: assignCheck.error });

      const built = rpmFieldAccess.buildPayloadFromBody(req.body, synced.formData);
      const nextMember = built.memberId || existing.memberId;
      if (String(nextMember || "") !== String(existing.memberId || "") || built.memberId) {
        const memberCheck = require("../lib/rpm-member-id").validateMemberId(nextMember || "");
        if (!memberCheck.ok) return res.status(400).json({ error: memberCheck.message, field: "memberId" });
      }

      const { submissionDate: _ignoredSubmissionDate, ...safeForm } = synced.formData || {};
      const patch = {
        phoneNumber: built.phoneNumber || existing.phoneNumber,
        fullName: built.fullName || existing.fullName,
        client: built.client != null ? built.client : existing.client,
        memberId: built.memberId || existing.memberId,
        effectiveDate: built.effectiveDate || existing.effectiveDate,
        status: ticketOnly ? synced.status : built.status || existing.status,
        feedback: built.feedback != null ? built.feedback : existing.feedback,
        formData: safeForm,
        reviewedBy: ticketOnly ? req.username : existing.reviewedBy,
      };

      const canReassign = roles.canReassignSaleLead(req.userRole);
      if (req.body.agentId) {
        const emp = store.getEmployeeById(req.body.agentId);
        if (!emp) return res.status(404).json({ error: "Agent not found" });
        const liveEmp = employeeAppRole.enrichEmployeeWithLiveAppRole(emp);
        if (isNonDialingReviewer(liveEmp)) {
          /* Reviewer IDs (e.g. HR-2 Eva / Quality) are not sale agents. */
        } else if (!roles.canAccessEmployee(req.userRole, emp)) {
          return res.status(403).json({ error: "No access to assign this agent" });
        } else {
          const reassigning = String(req.body.agentId) !== String(existing.agentId || "");
          if (canReassign && (ticketOnly || req.body.edit === true) && reassigning) {
            const orgTeams = await hrmsRepo.readOrgTeams();
            const assignment = saleSubmitScope.validateSaleSubmitAssignment(
              req.userRole,
              {
                agentId: req.body.agentId,
                closerId: req.body.closerId ?? existing.closerId,
                unit: req.body.unit || existing.unit,
                team: req.body.team || existing.team,
              },
              employees,
              {
                program: "rpm",
                orgTeams,
                teamLeadIds: saleSubmitScope.teamLeadIdsFromOrgTeams(orgTeams),
              }
            );
            if (!assignment.ok) return res.status(403).json({ error: assignment.error });
            patch.agentId = req.body.agentId;
            if (req.body.closerId !== undefined) patch.closerId = assignment.closerId;
          } else if (reassigning) {
            patch.agentId = req.body.agentId;
          }
        }
      }
      if (req.body.closerId !== undefined && patch.closerId === undefined) patch.closerId = req.body.closerId;
      if (canReassign && (req.body.unit || req.body.team)) {
        const ut = await validateSaleUnitTeam(
          req.body.unit || patch.unit || existing.unit,
          req.body.team || patch.team || existing.team
        );
        if (!ut.ok) return res.status(400).json({ error: ut.error });
        patch.unit = ut.unit;
        patch.team = ut.team;
      } else if (patch.agentId && !canReassign) {
        const emp = store.getEmployeeById(patch.agentId);
        if (!emp) return res.status(404).json({ error: "Agent not found" });
        const geo = enrichSaleAgent(emp);
        patch.team = geo.team;
        patch.unit = geo.unit;
      } else if (patch.agentId && canReassign && !req.body.unit && !req.body.team) {
        const emp = store.getEmployeeById(patch.agentId);
        if (emp) {
          const geo = enrichSaleAgent(emp);
          patch.team = geo.team;
          patch.unit = geo.unit;
        }
      }

      const sale = await rpmRepo.updateRpmSale(req.params.id, patch, req.username);
      try {
        const saleEditHistory = require("../lib/sale-edit-history");
        await saleEditHistory.recordSaleDiff({
          program: "rpm",
          saleId: req.params.id,
          before: existing,
          after: sale,
          changedBy: req.username,
          source: ticketOnly ? "quality_ticket" : "edit",
          employees: store.getEmployees({ hideOut: false, includeDeleted: true }),
        });
      } catch (histErr) {
        console.warn("sale edit history (rpm edit):", histErr.message);
      }
      await recalcAgentSalesFromRpmSale(sale, req.username);
      if (existing.agentId && existing.agentId !== sale.agentId) {
        await recalcAgentSalesFromRpmSale(existing, req.username);
      }
      const [redacted] = await rpmFieldAccess.redactSalesForRole([sale], req.userRole, {
        surface: responseSurface,
      });
      res.json({ ok: true, sale: redacted });
      return;
    }

    return res.status(400).json({ error: "Invalid action" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/:id/history", async (req, res) => {
  try {
    const access = await assertRpmSaleAccess(req, req.params.id);
    if (access.error) return res.status(access.status).json({ error: access.error });
    const saleEditHistory = require("../lib/sale-edit-history");
    if (!saleEditHistory.canViewSaleHistory(req.userRole)) {
      return res.status(403).json({ error: "No permission to view sale history" });
    }
    let entries = await saleEditHistory.listSaleHistory("rpm", req.params.id);
    entries = await saleEditHistory.redactHistoryForRole(entries, req.userRole, "rpm");
    res.json({ history: entries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  if (!roles.canDeleteSales(req.userRole)) {
    return res.status(403).json({ error: "No permission to delete sales" });
  }
  try {
    const access = await assertRpmSaleAccess(req, req.params.id);
    if (access.error) return res.status(access.status).json({ error: access.error });
    await rpmRepo.deleteRpmSaleCompletely(req.params.id, req.username);
    if (access.sale?.agentId) {
      await recalcAgentSalesFromRpmSale(access.sale, req.username);
    }
    res.json({ ok: true, id: req.params.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const access = await assertRpmSaleAccess(req, req.params.id);
    if (access.error) return res.status(access.status).json({ error: access.error });
    const [redacted] = await rpmFieldAccess.redactSalesForRole([access.sale], req.userRole, rpmRedactOpts(req));
    res.json({ sale: redacted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

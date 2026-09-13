const express = require("express");
const roles = require("../lib/roles");
const hrms = require("../lib/hrms-repo");
const payrollGates = require("../lib/payroll-gates");
const { useSupabase } = require("../lib/backend");
const store = require("../lib/data-store");
const changelog = require("../lib/changelog");
const { mondayOfWeek, fridayOfWeek } = require("../lib/employment-periods");
const { statusOptions, isOutStatus } = require("../lib/employee-status");
const requestRules = require("../lib/request-rules");
const leaveAttendance = require("../lib/leave-attendance");
const leaveRequestAccess = require("../lib/leave-request-access");
const auditNotify = require("../lib/notify-routing");
const departureDeductions = require("../lib/departure-deductions");
const { employeeEquipmentLookupIds } = require("../lib/equipment-clearance");

const companyContext = require("../lib/company-context");

const router = express.Router();
const {
  parseCompany,
  assertEmployeeInCompanyContext,
  requireEmployeeInContext,
  unitInCompanyContext,
  teamInCompanyContext,
} = require("../lib/request-company-guard");

router.param("employeeId", (req, res, next, employeeId) => {
  if (!requireEmployeeInContext(req, res, employeeId)) return;
  next();
});

function requireSupabase(_req, res, next) {
  if (!useSupabase()) return res.status(503).json({ error: "Requires DATA_BACKEND=supabase" });
  next();
}

router.use(requireSupabase);

router.get("/org-structure", async (req, res) => {
  try {
    const companyCtx = require("../lib/company-context");
    const company = companyCtx.resolveCompanyContextForUser(req.query.company, req.userRole);
    let structure = await hrms.getLiveOrgStructure(company);
    if (company === "hs2" && !roles.canManageHs2Company(req.userRole)) {
      structure.units = (structure.units || []).filter((s) => companyCtx.isHs2Unit(s.unit));
      structure.orgUnits = (structure.orgUnits || []).filter((u) => companyCtx.isHs2Unit(u.name || u.unit || u));
    } else if (company !== "hs2") {
      structure.units = (structure.units || []).filter((s) => !companyCtx.isHs2Unit(s.unit));
      structure.orgUnits = companyCtx.filterOrgUnitsForRole(structure.orgUnits, req.userRole);
    }
    if (roles.canViewOrgScoped(req.userRole)) {
      structure = hrms.filterOrgStructureForRole(structure, req.userRole);
    }
    res.json(structure);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/teams", async (req, res) => {
  try {
    const companyCtx = require("../lib/company-context");
    const company = companyCtx.resolveCompanyContextForUser(req.query.company, req.userRole);
    const canView = roles.canViewOrgFull(req.userRole) || roles.canManageOrgStructure(req.userRole) ||
      (roles.canViewOrgScoped(req.userRole) && ["op", "tl"].includes(req.userRole?.role));
    if (!canView) {
      return res.status(403).json({ error: "No permission for org team metadata" });
    }
    const teams = await hrms.readOrgTeams();
    const orgUnits = companyCtx.filterOrgUnitsForRole(hrms.ORG_UNITS, req.userRole);
    let teamList = teams;
    if (company === "hs2" && !roles.canManageHs2Company(req.userRole)) {
      teamList = teams.filter((t) => companyCtx.isHs2Unit(t.unit));
    } else if (company !== "hs2" && !roles.canManageHs2Company(req.userRole)) {
      teamList = teams.filter((t) => !companyCtx.isHs2Unit(t.unit));
    }
    res.json({ teams: teamList, orgUnits });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/teams", async (req, res) => {
  if (!roles.canManageOrgStructure(req.userRole)) return res.status(403).json({ error: "Admin/HR only" });
  const unit = String(req.body?.unit || "").trim();
  if (unit && !unitInCompanyContext(unit, req)) {
    return res.status(403).json({ error: "Unit not in company context" });
  }
  try {
    const team = await hrms.createOrgTeam(req.body, req.username);
    res.status(201).json({ ok: true, team });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.patch("/teams/:id", async (req, res) => {
  if (!roles.canManageOrgStructure(req.userRole)) return res.status(403).json({ error: "Admin/HR only" });
  try {
    if (!(await teamInCompanyContext(req.params.id, req))) {
      return res.status(403).json({ error: "Team not in company context" });
    }
    const nextUnit = req.body?.unit ? String(req.body.unit).trim() : "";
    if (nextUnit && !unitInCompanyContext(nextUnit, req)) {
      return res.status(403).json({ error: "Unit not in company context" });
    }
    const team = await hrms.updateOrgTeam(req.params.id, req.body, req.username);
    res.json({ ok: true, team });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/teams/:id/relocate", async (req, res) => {
  if (!roles.canManageOrgStructure(req.userRole)) return res.status(403).json({ error: "Admin/HR only" });
  try {
    if (!(await teamInCompanyContext(req.params.id, req))) {
      return res.status(403).json({ error: "Team not in company context" });
    }
    const newUnit = String(req.body?.unit || "").trim();
    if (!newUnit) return res.status(400).json({ error: "unit required" });
    if (!unitInCompanyContext(newUnit, req)) {
      return res.status(403).json({ error: "Unit not in company context" });
    }
    const reassignIds = req.body?.reassignIds !== false;
    const result = await hrms.relocateTeamToUnit(req.params.id, newUnit, {
      reassignIds,
      username: req.username,
    });
    await store.refreshCache();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete("/teams/:id", async (req, res) => {
  if (!roles.canManageOrgStructure(req.userRole)) return res.status(403).json({ error: "Admin/HR only" });
  try {
    if (!(await teamInCompanyContext(req.params.id, req))) {
      return res.status(403).json({ error: "Team not in company context" });
    }
    const result = await hrms.deleteOrgTeam(req.params.id, req.username);
    await store.refreshCache();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete("/units/:unit", async (req, res) => {
  if (!roles.canManageOrgStructure(req.userRole)) return res.status(403).json({ error: "Admin/HR only" });
  if (!unitInCompanyContext(decodeURIComponent(req.params.unit), req)) {
    return res.status(403).json({ error: "Unit not in company context" });
  }
  try {
    const result = await hrms.deleteOrgUnit(req.params.unit, req.username);
    await store.refreshCache();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/employment-periods/:employeeId", async (req, res) => {
  try {
    const periods = await hrms.getEmploymentPeriods(req.params.employeeId);
    res.json({ periods });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/employment-periods/:employeeId", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) return res.status(403).json({ error: "HR/admin only" });
  try {
    const { startDate, endDate, notes } = req.body;
    if (!startDate) return res.status(400).json({ error: "startDate required" });
    const period = await hrms.insertEmploymentPeriodRecord(
      req.params.employeeId,
      { startDate, endDate, notes },
      req.username
    );
    res.json({ ok: true, period });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/employment-periods/:employeeId/rehire", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) return res.status(403).json({ error: "HR/admin only" });
  try {
    const { startDate, notes } = req.body;
    const employeeDepart = require("../lib/employee-depart");
    const emp = store.getEmployeeById(req.params.employeeId);
    const oldDepart = String(emp?.depart_date || "").slice(0, 10);
    const period = await hrms.addEmploymentPeriod(req.params.employeeId, { startDate, notes }, req.username);
    await store.updateEmployee(req.params.employeeId, { status: "Active", employment_date: startDate, depart_date: null }, req.username);
    let clearedOutCount = 0;
    if (oldDepart) {
      try {
        clearedOutCount = await employeeDepart.clearPostDepartAutoOut(
          req.params.employeeId,
          oldDepart,
          store,
          req.username
        );
      } catch (clearErr) {
        console.warn("[hrms] rehire clear post-depart OUT failed:", clearErr.message);
      }
    }
    res.json({ ok: true, period, clearedOutCount });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/employment-periods/:employeeId/clear-depart", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) return res.status(403).json({ error: "HR/admin only" });
  try {
    const employeeDepart = require("../lib/employee-depart");
    const result = await employeeDepart.clearEmployeeDepart(req.params.employeeId, {
      store,
      username: req.username,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/employment-periods/:employeeId/depart", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) return res.status(403).json({ error: "HR/admin only" });
  try {
    const { departDate, status, notice_type: noticeType, skipDepartDate } = req.body;
    const employeeDepart = require("../lib/employee-depart");
    const resolvedDate = employeeDepart.resolveDepartDate(
      skipDepartDate || !departDate ? null : departDate
    );

    const result = await employeeDepart.executeEmployeeDepart(
      req.params.employeeId,
      resolvedDate,
      { status, notice_type: noticeType },
      { store, username: req.username }
    );

    res.json({ ok: true, departDate: result.departDate, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/status-options", (_req, res) => {
  res.json({ statuses: statusOptions() });
});

router.get("/action-plans/:employeeId", async (req, res) => {
  try {
    const plans = await hrms.getActionPlans(req.params.employeeId);
    res.json({ plans });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/action-plans", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) return res.status(403).json({ error: "HR/admin only" });
  try {
    const { employeeId, weekStart, weekEnd, notes } = req.body;
    if (!employeeId) return res.status(400).json({ error: "employeeId required" });
    const emp = store.getEmployeeById(employeeId);
    if (!emp || !assertEmployeeInCompanyContext(emp, req)) {
      return res.status(404).json({ error: "Employee not found" });
    }
    const start = weekStart || mondayOfWeek(req.body.anchorDate);
    const end = weekEnd || fridayOfWeek(start);
    const plan = await hrms.createActionPlan({ employeeId, weekStart: start, weekEnd: end, notes }, req.username);
    res.status(201).json({ ok: true, plan });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/action-plans/:id/cancel", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) return res.status(403).json({ error: "HR/admin only" });
  try {
    const plan = await hrms.getActionPlan(req.params.id);
    if (!plan) return res.status(404).json({ error: "Action plan not found" });
    const emp = store.getEmployeeById(plan.employeeId || plan.employee_id);
    if (!emp || !assertEmployeeInCompanyContext(emp, req)) {
      return res.status(404).json({ error: "Action plan not found" });
    }
    const cancelled = await hrms.cancelActionPlan(req.params.id, req.username);
    res.json({ ok: true, plan: cancelled });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/onboarding/:employeeId", async (req, res) => {
  try {
    res.json({ checklist: await hrms.getOnboarding(req.params.employeeId) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/onboarding/:employeeId", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) return res.status(403).json({ error: "HR/admin only" });
  try {
    const checklist = await hrms.saveOnboarding(req.params.employeeId, req.body, req.username);
    res.json({ ok: true, checklist });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const trainingPhases = require("../lib/training-phases");

router.get("/training/:employeeId", async (req, res) => {
  if (
    !roles.canManageTrainingProgram(req.userRole) &&
    !roles.canViewTrainingPayPreview(req.userRole) &&
    req.userRole?.employeeId !== req.params.employeeId
  ) {
    return res.status(403).json({ error: "Not allowed" });
  }
  try {
    const program = await trainingPhases.getProgram(req.params.employeeId);
    res.json({
      program,
      statuses: trainingPhases.PHASE_STATUSES,
      statusLabels: trainingPhases.STATUS_LABELS,
      outcomes: trainingPhases.PROGRAM_OUTCOMES,
      outcomeLabels: trainingPhases.OUTCOME_LABELS,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/training/:employeeId", async (req, res) => {
  if (!roles.canManageTrainingProgram(req.userRole)) return res.status(403).json({ error: "No permission" });
  try {
    const phase1Start = req.body?.phase1Start || req.body?.phase1_start;
    if (!phase1Start) return res.status(400).json({ error: "phase1Start required" });
    const program = await trainingPhases.createProgram(req.params.employeeId, phase1Start, req.username);
    res.status(201).json({ ok: true, program });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.patch("/training/phases/:phaseId", async (req, res) => {
  if (!roles.canManageTrainingProgram(req.userRole)) return res.status(403).json({ error: "No permission" });
  try {
    const program = await trainingPhases.updatePhase(req.params.phaseId, req.body || {}, req.username);
    res.json({ ok: true, program });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/training/:employeeId/recalculate", async (req, res) => {
  if (!roles.canManageTrainingProgram(req.userRole)) return res.status(403).json({ error: "No permission" });
  try {
    const from = Number(req.body?.fromPhase || req.body?.fromPhaseNumber || 1);
    const program = await trainingPhases.recalculateFromPhase(req.params.employeeId, from, req.username);
    res.json({ ok: true, program });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put("/training/:employeeId/active", async (req, res) => {
  if (!roles.canManageTrainingProgram(req.userRole)) return res.status(403).json({ error: "No permission" });
  try {
    const program = await trainingPhases.setProgramActive(req.params.employeeId, req.body?.active, req.username);
    res.json({ ok: true, program });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.patch("/training/:employeeId/outcome", async (req, res) => {
  if (!roles.canManageTrainingProgram(req.userRole)) return res.status(403).json({ error: "No permission" });
  try {
    const program = await trainingPhases.updateProgramOutcome(req.params.employeeId, req.body || {}, req.username);
    res.json({ ok: true, program });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/training/:employeeId/promote", async (req, res) => {
  if (!roles.canManageTrainingProgram(req.userRole)) return res.status(403).json({ error: "No permission" });
  try {
    const program = await trainingPhases.promoteToAgent(
      req.params.employeeId,
      {
        promotionDate: req.body?.promotionEffectiveDate || req.body?.promotionDate,
        passedOnDate:  req.body?.passedOnDate,
        exception:     req.body?.exception === true,
      },
      req.username
    );
    const emp = store.getEmployeeById(req.params.employeeId);
    res.json({ ok: true, program, employee: emp });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/training/:employeeId/pay-preview", async (req, res) => {
  if (!roles.canViewTrainingPayPreview(req.userRole)) return res.status(403).json({ error: "No permission" });
  try {
    const ym = req.query.month || roles.localYearMonth();
    const emp = store.getEmployeeById(req.params.employeeId);
    if (!emp) return res.status(404).json({ error: "Employee not found" });
    const records = store.getAttendanceEvents(ym).filter((r) => r.employeeId === emp.id);
    const {
      TRAINING_DAILY_RATE,
      TRAINING_MONTHLY_SALARY,
    } = require("../lib/training-pay-rules");
    const preview = await trainingPhases.getTrainingPayPreview(req.params.employeeId, ym, {
      attendance: records,
      traineeDailyRate: TRAINING_DAILY_RATE,
    });
    res.json({
      month: ym,
      preview,
      traineeMonthlyRate: TRAINING_MONTHLY_SALARY,
      traineeDailyRate: TRAINING_DAILY_RATE,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/resignation/:employeeId/no-notice-deduction", async (req, res) => {
  if (!roles.canManageResignationPayRules(req.userRole)) return res.status(403).json({ error: "No permission" });
  try {
    const emp = store.getEmployeeById(req.params.employeeId);
    if (!emp) return res.status(404).json({ error: "Employee not found" });
    const { applyNoNoticeDeduction } = require("../lib/resignation-payroll");
    const created = await applyNoNoticeDeduction(emp, req.body?.departDate, store, req.username);
    res.json({ ok: true, deductions: created });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/resignation/:employeeId/notice-sales-preview", async (req, res) => {
  if (!roles.canManageResignationPayRules(req.userRole)) return res.status(403).json({ error: "No permission" });
  try {
    const emp = store.getEmployeeById(req.params.employeeId);
    if (!emp) return res.status(404).json({ error: "Employee not found" });
    const departDate = req.query.departDate || emp.depart_date;
    const {
      countPassedSalesInNoticeWindow,
      noticePayPercent,
      calcNoticePeriodBasicScale,
    } = require("../lib/resignation-payroll");
    const passedSalesInNotice = await countPassedSalesInNoticeWindow(emp, departDate, store);
    const payPercent = noticePayPercent(passedSalesInNotice);
    res.json({
      ok: true,
      departDate: String(departDate || "").slice(0, 10),
      passedSalesInNotice,
      payPercent,
      meetsMinimum: passedSalesInNotice >= 5,
      previewNote:
        passedSalesInNotice < 5
          ? "Below 5 passed sales — notice-period basic cancelled"
          : `${payPercent}% of month basic applies`,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/resignation/:employeeId/notice-pay-scale", async (req, res) => {
  if (!roles.canManageResignationPayRules(req.userRole)) return res.status(403).json({ error: "No permission" });
  try {
    const emp = store.getEmployeeById(req.params.employeeId);
    if (!emp) return res.status(404).json({ error: "Employee not found" });
    const { applyNoticePeriodPayAdjustment } = require("../lib/resignation-payroll");
    const scale = await applyNoticePeriodPayAdjustment(emp, req.body?.month || roles.localYearMonth(), {
      passedSalesInNotice: req.body?.passedSalesInNotice,
      store,
      username: req.username,
    });
    res.json({ ok: true, scale });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/offboarding/:employeeId", async (req, res) => {
  try {
    const [offboarding, clearance] = await Promise.all([
      hrms.getOffboarding(req.params.employeeId),
      hrms.getClearanceItems(req.params.employeeId),
    ]);
    res.json({ offboarding, clearance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/offboarding/:employeeId", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) return res.status(403).json({ error: "HR/admin only" });
  try {
    const offboarding = await hrms.saveOffboarding(req.params.employeeId, req.body, req.username);
    res.json({ ok: true, offboarding });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put("/clearance/:employeeId/:itemKey", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) return res.status(403).json({ error: "HR/admin only" });
  try {
    const item = await hrms.saveClearanceItem(
      req.params.employeeId,
      req.params.itemKey,
      req.body.status,
      req.body.notes,
      req.username
    );
    res.json({ ok: true, item });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/clearance-board", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) return res.status(403).json({ error: "HR/admin only" });
  try {
    const company = parseCompany(req);
    const leavers = companyContext
      .filterEmployeesByCompany(store.getEmployees({ hideOut: false }), company)
      .filter((e) => isOutStatus(e.status) || e.depart_date);
    const rows = await hrms.buildClearanceBoard(leavers);
    const counts = {
      leavers: rows.length,
      blocked: rows.filter((r) => r.blocked).length,
      devices: rows.filter((r) => (r.unreturned || []).length > 0).length,
      formPending: rows.filter((r) => String(r.form?.status || "pending") === "pending").length,
      filesPending: rows.filter((r) => String(r.files?.status || "pending") === "pending").length,
      clearanceComplete: rows.filter((r) => r.clearanceComplete).length,
      payrollReady: rows.filter((r) => r.payrollReady).length,
    };
    res.json({ rows, counts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/equipment", async (req, res) => {
  if (!roles.canViewEquipmentInventory(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  try {
    const companyCtx = require("../lib/company-context");
    const company = companyCtx.resolveCompanyContextForUser(req.query.company, req.userRole);
    const store = require("../lib/data-store");
    const [equipment, assignments] = await Promise.all([
      hrms.readAllEquipment(company),
      hrms.readEquipmentAssignments(null, company),
    ]);
    let scopedAssignments = assignments;
    if (roles.canViewEquipmentUnit(req.userRole) && !roles.canViewEquipmentAll(req.userRole)) {
      const unit = req.userRole?.unit;
      const empIds = new Set(
        store.getEmployees({ hideOut: false }).filter((e) => e.unit === unit).map((e) => e.id)
      );
      scopedAssignments = assignments.filter((a) => empIds.has(a.employeeId));
    }
    const employees = companyCtx.filterEmployeesByCompany(
      store.getEmployees({ hideOut: false }),
      company
    );
    const empById = new Map(employees.map((e) => [e.id, e]));
    const units = [...new Set(employees.map((e) => e.unit).filter(Boolean))].sort();
    const teams = [...new Set(employees.map((e) => e.team).filter(Boolean))].sort();
    const positions = [...new Set(employees.map((e) => e.position).filter(Boolean))].sort();
    const deviceTypes = [...new Set(equipment.map((e) => e.itemType).filter(Boolean))].sort();
    res.json({ equipment, assignments: scopedAssignments, employees, empById, units, teams, positions, deviceTypes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/equipment/:employeeId", async (req, res) => {
  const store = require("../lib/data-store");
  const targetId = req.params.employeeId;
  const emp = store.getEmployeeById(targetId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  const selfIds = new Set(employeeEquipmentLookupIds({
    id: req.userRole?.employeeId,
    former_ids: store.getEmployeeById(req.userRole?.employeeId)?.former_ids,
    archived_app_id: store.getEmployeeById(req.userRole?.employeeId)?.archived_app_id,
  }));
  const allowed =
    roles.canViewEquipmentAll(req.userRole) ||
    (roles.canViewEquipmentUnit(req.userRole) &&
      req.userRole?.unit &&
      emp.unit === req.userRole.unit) ||
    selfIds.has(String(targetId)) ||
    (req.userRole?.employeeId && req.userRole.employeeId === targetId);
  if (!allowed) {
    return res.status(403).json({ error: "No permission" });
  }
  try {
    const lookupIds = employeeEquipmentLookupIds(emp);
    const assignments = await hrms.readEquipmentAssignments(lookupIds.length ? lookupIds : targetId);
    res.json({ assignments });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/equipment", async (req, res) => {
  if (!roles.canIssueEquipment(req.userRole)) return res.status(403).json({ error: "No permission to issue equipment" });
  try {
    await store.ensureEmployeesFresh();
    const company = parseCompany(req);
    if (req.body?.employeeId) {
      const emp = store.getEmployeeById(req.body.employeeId);
      if (!emp) {
        return res.status(400).json({ error: "Employee not found" });
      }
      if (!assertEmployeeInCompanyContext(emp, req)) {
        return res.status(403).json({ error: "Employee not in company context" });
      }
    } else {
      const unit = String(req.body?.unit || "").trim();
      if (unit && !unitInCompanyContext(unit, req)) {
        return res.status(403).json({ error: "Unit not in company context" });
      }
    }
    const equipment = await hrms.createEquipment({ ...req.body, company }, req.username);
    res.json({ ok: true, equipment });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.patch("/equipment/:id", async (req, res) => {
  if (!roles.canIssueEquipment(req.userRole)) return res.status(403).json({ error: "No permission to edit equipment" });
  try {
    const prior = (await hrms.readAllEquipment()).find((e) => String(e.id) === String(req.params.id));
    const equipment = await hrms.updateEquipment(req.params.id, req.body, req.username);
    const actor = String(req.username || "").trim().toLowerCase();
    if (actor && actor !== auditNotify.AUDIT_ADMIN && actor !== auditNotify.CEO_USERNAME) {
      await auditNotify.auditNotify({
        actor: req.username,
        action: "equipment_edit",
        title: "Equipment updated",
        body: prior
          ? `${prior.assetTag} (${prior.itemType || "—"}) updated`
          : `${equipment.assetTag} updated`,
        entityType: "equipment",
        entityId: String(equipment.id),
      });
    }
    res.json({ ok: true, equipment });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/equipment/assign", async (req, res) => {
  if (!roles.canIssueEquipment(req.userRole)) return res.status(403).json({ error: "No permission to issue equipment" });
  try {
    const a = await hrms.assignEquipment(req.body.equipmentId, req.body.employeeId, req.username);
    res.json({ ok: true, assignment: a });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/equipment/return/:assignmentId", async (req, res) => {
  if (!roles.canIssueEquipment(req.userRole)) return res.status(403).json({ error: "No permission to return equipment" });
  try {
    const a = await hrms.returnEquipment(req.params.assignmentId, req.username);
    res.json({ ok: true, assignment: a });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/leave", async (req, res) => {
  try {
    const companyCtx = require("../lib/company-context");
    const company = companyCtx.resolveCompanyContextForUser(req.query.company, req.userRole);
    if (company === "hs2" && !roles.canAccessHs2CompanyContext(req.userRole)) {
      return res.status(403).json({ error: "No access to HS2 leave requests" });
    }
    const requests = await hrms.readLeaveRequests({
      employeeId: req.query.employeeId,
      status: req.query.status,
      company,
    });
    const store = require("../lib/data-store");
    const allEmployees = store.getEmployees({ hideOut: false });
    const companyEmployees = companyCtx.filterEmployeesByCompany(allEmployees, company);
    const employees = roles.filterEmployeesForUser(companyEmployees, req.userRole);
    const visibleIds = new Set(employees.map((e) => e.id));
    const scopedRequests = requests.filter((r) => visibleIds.has(r.employeeId));
    const units = [...new Set(employees.map((e) => e.unit).filter(Boolean))].sort();
    const teams = [...new Set(employees.map((e) => e.team).filter(Boolean))].sort();
    const leaveTypes = [...new Set(scopedRequests.map((r) => r.requestKind || r.leaveType).filter(Boolean))].sort();
    const statuses = [...new Set(scopedRequests.map((r) => r.status).filter(Boolean))].sort();
    res.json({
      requests: scopedRequests,
      canApprove: roles.canApproveLeave(req.username, req.userRole),
      units,
      teams,
      leaveTypes,
      statuses,
      employees,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/leave", async (req, res) => {
  try {
    const companyCtx = require("../lib/company-context");
    const company = companyCtx.resolveCompanyContextForUser(req.query.company || req.body?.company, req.userRole);
    const targetEmp = store.getEmployeeById(req.body.employeeId);
    if (!targetEmp || !companyCtx.employeeInCompanyContext(targetEmp, company)) {
      return res.status(403).json({ error: "Employee not in company context" });
    }
    const validated = requestRules.validateRequestSubmit({
      requestKind: req.body.requestKind || req.body.leaveType,
      employeeId: req.body.employeeId,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      dayFraction: req.body.dayFraction,
      halfDay: req.body.halfDay,
      actor: req.username,
      actorRole: req.userRole,
      targetEmp,
      forEmployeeId: req.body.employeeId,
    });
    const payload = {
      ...req.body,
      requestKind: validated.requestKind,
      leaveType: validated.requestKind,
      paidLeave: validated.paidLeave,
      lateSubmission: validated.lateSubmission,
      dayFraction: validated.dayFraction,
      halfDay: validated.halfDay,
      quarterDay: validated.quarterDay,
      requestedBy: req.username,
      requestedByRole: req.userRole?.role || "",
    };
    // For pause requests the server computes the canonical Mon–Fri week dates
    if (validated.pauseStartDate) payload.startDate = validated.pauseStartDate;
    if (validated.pauseEndDate)   payload.endDate   = validated.pauseEndDate;
    const request = await hrms.createLeaveRequest(payload, req.username);
    const dispatch = require("../lib/notify-dispatch");
    const bits = [];
    if (validated.lateSubmission) bits.push("late same-day");
    if (validated.tlRequested) bits.push("requested by TL/OP");
    const title = bits.length ? `Leave request submitted (${bits.join("; ")})` : "Leave request submitted";
    await dispatch.dispatchNotification({
      actionKey: "leave_submitted",
      type: "leave",
      title,
      body: `${req.body.employeeId}: ${req.body.startDate} – ${req.body.endDate || req.body.startDate}`,
      entityType: "leave",
      entityId: String(request.id),
      actor: req.username,
      context: { company },
    });
    res.status(201).json({ ok: true, request });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put("/leave/:id", async (req, res) => {
  const canApprove = roles.canApproveLeave(req.username, req.userRole);
  try {
    const companyCtx = require("../lib/company-context");
    const company = companyCtx.resolveCompanyContextForUser(req.query.company, req.userRole);
    const prior = (await hrms.readLeaveRequests({ company })).find((r) => String(r.id) === String(req.params.id));
    if (!prior) return res.status(404).json({ error: "Leave request not found" });

    const canOwnerEdit = leaveRequestAccess.canOwnerModifyLeave(req.userRole, req.username, prior);
    if (!canApprove && !canOwnerEdit) {
      const isOwner = leaveRequestAccess.isLeaveOwner(req.userRole, req.username, prior);
      if (isOwner && String(prior.status || "").toLowerCase() !== "pending") {
        return res.status(403).json({ error: "You can only edit or delete your own requests while they are pending." });
      }
      return res.status(403).json({ error: "Only approvers or the submitter may edit a pending request." });
    }
    if (req.body.status && req.body.status !== "pending" && !canApprove) {
      return res.status(403).json({ error: "HR, admin, or executive approval required." });
    }

    let patch = { ...req.body };
    if (!canApprove && canOwnerEdit) {
      if (patch.status && patch.status !== "pending") {
        return res.status(403).json({ error: "Only approvers may change request status." });
      }
      patch.status = "pending";
      patch.employeeId = prior.employeeId;
      const targetEmp = store.getEmployeeById(prior.employeeId);
      const validated = requestRules.validateRequestSubmit({
        requestKind: patch.requestKind || patch.leaveType || prior.requestKind || prior.leaveType,
        employeeId: prior.employeeId,
        startDate: patch.startDate || prior.startDate,
        endDate: patch.endDate || prior.endDate,
        dayFraction: patch.dayFraction ?? prior.dayFraction,
        halfDay: patch.halfDay ?? prior.halfDay,
        actor: req.username,
        actorRole: req.userRole,
        targetEmp,
        forEmployeeId: prior.employeeId,
      });
      patch = {
        ...patch,
        requestKind: validated.requestKind,
        leaveType: validated.requestKind,
        paidLeave: validated.paidLeave,
        lateSubmission: validated.lateSubmission,
        dayFraction: validated.dayFraction,
        halfDay: validated.halfDay,
        quarterDay: validated.quarterDay,
      };
      if (validated.pauseStartDate) patch.startDate = validated.pauseStartDate;
      if (validated.pauseEndDate) patch.endDate = validated.pauseEndDate;
    }

    const request = await hrms.updateLeaveRequest(req.params.id, patch, req.username);
    if (request.status === "approved") {
      const records = leaveAttendance.leaveAttendanceRecords(request);
      if (records.length) await store.saveAttendanceBatch(records, req.username);
    } else if (prior?.status === "approved" && request.status !== "approved") {
      const records = leaveAttendance.clearLeaveAttendanceRecords(prior);
      if (records.length) await store.saveAttendanceBatch(records, req.username);
    }
    if (canApprove && prior) {
      await auditNotify.auditNotify({
        actor: req.username,
        action: "leave_edit",
        title: "Leave request updated",
        body: `${request.employeeId} ${request.startDate}–${request.endDate} → ${request.status}`,
        entityType: "leave",
        entityId: String(request.id),
        includeHr: true,
      });
    }
    res.json({ ok: true, request });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete("/leave/:id", async (req, res) => {
  try {
    const companyCtx = require("../lib/company-context");
    const company = companyCtx.resolveCompanyContextForUser(req.query.company, req.userRole);
    const prior = (await hrms.readLeaveRequests({ company })).find((r) => String(r.id) === String(req.params.id));
    if (!prior) return res.status(404).json({ error: "Leave request not found" });

    const canApprove = roles.canApproveLeave(req.username, req.userRole);
    const canOwnerDelete = leaveRequestAccess.canOwnerModifyLeave(req.userRole, req.username, prior);
    if (!canApprove && !canOwnerDelete) {
      const isOwner = leaveRequestAccess.isLeaveOwner(req.userRole, req.username, prior);
      if (isOwner && String(prior.status || "").toLowerCase() !== "pending") {
        return res.status(403).json({ error: "You can only edit or delete your own requests while they are pending." });
      }
      return res.status(403).json({ error: "Only approvers or the submitter may delete a pending request." });
    }
    if (prior?.status === "approved") {
      const records = leaveAttendance.clearLeaveAttendanceRecords(prior);
      if (records.length) await store.saveAttendanceBatch(records, req.username);
      await hrms.deleteLeaveRequest(req.params.id);
    } else {
      const recycleBin = require("../lib/recycle-bin");
      await recycleBin.archiveLiveRow({
        table: "leave_requests",
        id: req.params.id,
        company,
        deletedBy: req.username,
      });
    }
    await auditNotify.auditNotify({
      actor: req.username,
      action: "leave_delete",
      title: "Leave request deleted",
      body: prior ? `${prior.employeeId} ${prior.startDate}–${prior.endDate}` : req.params.id,
      entityType: "leave",
      entityId: String(req.params.id),
      includeHr: true,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Leave request documents (medical notes, exam schedules) ──────────────────
// These use the same employee_documents table and storage as HR docs,
// but are attached to a leave request for quick access on the ticket.

router.get("/leave/:id/documents", async (req, res) => {
  try {
    const leaveId = req.params.id;
    const companyCtx = require("../lib/company-context");
    const company = companyCtx.resolveCompanyContextForUser(req.query.company, req.userRole);
    const leaves = await hrms.readLeaveRequests({ company });
    const leave = leaves.find((r) => String(r.id) === String(leaveId));
    if (!leave) return res.status(404).json({ error: "Leave request not found" });
    const { getSupabaseAdmin } = require("../lib/supabase-client");
    const { useSupabase } = require("../lib/backend");
    if (!useSupabase()) return res.json({ documents: [] });
    const { data, error } = await getSupabaseAdmin()
      .from("leave_request_documents")
      .select("*")
      .eq("leave_id", leaveId)
      .order("created_at", { ascending: false });
    if (error) {
      // Table may not exist yet (pre-migration) — return empty gracefully
      if (/does not exist|schema cache/i.test(error.message)) return res.json({ documents: [] });
      throw new Error(error.message);
    }
    res.json({
      documents: (data || []).map((r) => ({
        id: r.id,
        leaveId: r.leave_id,
        employeeId: r.employee_id,
        docType: r.doc_type,
        fileName: r.file_name,
        storagePath: r.storage_path || "",
        driveFileId: r.drive_file_id || "",
        notes: r.notes || "",
        uploadedBy: r.uploaded_by || "",
        createdAt: r.created_at,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/leave/:id/documents", async (req, res) => {
  const leaveId = req.params.id;
  const { readUploadBuffer } = require("../lib/read-upload-buffer");
  let fileName;
  let buffer;
  let docType = req.body?.docType;
  let notes = req.body?.notes;
  try {
    const parsed = await readUploadBuffer(req);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    fileName = parsed.fileName;
    buffer = parsed.buffer;
    docType = parsed.kind || parsed.fields?.docType || docType;
    notes = parsed.fields?.notes || notes;
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!fileName || !buffer) {
    return res.status(400).json({ error: "fileName and file required" });
  }
  try {
    const companyCtx = require("../lib/company-context");
    const company = companyCtx.resolveCompanyContextForUser(req.query.company || req.body?.company, req.userRole);
    const leaves = await hrms.readLeaveRequests({ company });
    const leave = leaves.find((r) => String(r.id) === String(leaveId));
    if (!leave) return res.status(404).json({ error: "Leave request not found" });

    // Gate: the employee themselves, HR, admin, or approved leave approvers
    const isSelf = req.userRole?.employeeId === leave.employeeId;
    const isApprover = roles.canApproveLeave(req.username, req.userRole);
    if (!isSelf && !isApprover) {
      return res.status(403).json({ error: "No permission to upload documents for this request" });
    }

    const documents = require("../lib/documents");
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const tmpPath = path.join(os.tmpdir(), `leave-doc-${Date.now()}-${fileName}`);
    fs.writeFileSync(tmpPath, buffer);

    let storagePath = "";
    let driveFileId = "";
    try {
      const uploaded = await documents.uploadEmployeeFile({
        employeeId: leave.employeeId,
        docType: docType || "Medical Note",
        filePath: tmpPath,
        fileName,
        notes: notes || `Leave request ${leaveId}`,
        expiry: null,
      });
      // Also save to employee_documents (same place as HR docs)
      await store.uploadEmployeeDocument(
        { ...uploaded, noExpiry: true },
        req.username
      );
      storagePath = uploaded.storagePath || "";
      driveFileId = uploaded.driveFileId || uploaded.fileId || "";
    } finally {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }

    // Also record in leave_request_documents for easy leave-ticket access
    const { getSupabaseAdmin } = require("../lib/supabase-client");
    const { useSupabase } = require("../lib/backend");
    let savedDoc = { id: null, leaveId, fileName, docType, storagePath, driveFileId };
    if (useSupabase()) {
      const { data, error } = await getSupabaseAdmin()
        .from("leave_request_documents")
        .insert({
          leave_id: leaveId,
          employee_id: leave.employeeId,
          doc_type: docType || "Medical Note",
          file_name: fileName,
          storage_path: storagePath || null,
          drive_file_id: driveFileId || null,
          notes: notes || null,
          uploaded_by: req.username,
        })
        .select()
        .single();
      if (error && !/does not exist|schema cache/i.test(error.message)) {
        throw new Error(error.message);
      }
      if (data) savedDoc = { id: data.id, leaveId, fileName, docType, storagePath, driveFileId };
    }

    res.json({ ok: true, document: savedDoc });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/holidays", async (req, res) => {
  if (!roles.canViewSettingsSection(req.userRole, "holidays")) {
    return res.status(403).json({ error: "No permission to view holidays" });
  }
  try {
    const company = parseCompany(req);
    res.json({ holidays: await hrms.readPublicHolidays({ company }), company });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/holidays", async (req, res) => {
  if (!roles.canViewSettingsSection(req.userRole, "holidays")) {
    return res.status(403).json({ error: "No permission to manage holidays" });
  }
  try {
    const h = await hrms.upsertPublicHoliday(req.body, req.username);
    res.json({ ok: true, holiday: h });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.patch("/holidays/:id", async (req, res) => {
  if (!roles.canViewSettingsSection(req.userRole, "holidays")) {
    return res.status(403).json({ error: "No permission to manage holidays" });
  }
  try {
    const company = parseCompany(req);
    const existing = (await hrms.readPublicHolidays({ company })).find((h) => h.id === req.params.id);
    if (!existing) return res.status(404).json({ error: "Holiday not found" });
    if (
      req.body?.active !== undefined &&
      String(existing.country || "USA").toUpperCase() === "EGY" &&
      !roles.canManageHolidayActivation(req.userRole)
    ) {
      return res.status(403).json({ error: "Only Admin can activate Egyptian holidays" });
    }
    const holiday = await hrms.updatePublicHoliday(req.params.id, req.body, company);
    res.json({ ok: true, holiday });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/holidays/import-federal", async (req, res) => {
  if (!roles.canViewSettingsSection(req.userRole, "holidays")) {
    return res.status(403).json({ error: "No permission to manage holidays" });
  }
  try {
    const { getUsFederalHolidays } = require("../scripts/seed-us-federal-holidays");
    const rows = getUsFederalHolidays();
    const company = parseCompany(req);
    const result = await hrms.seedPublicHolidays(rows, req.username, company);
    await auditNotify.auditNotify({
      actor: req.username,
      action: "holiday_import",
      title: "Federal holidays imported",
      body: `${rows.length} rows`,
      entityType: "holiday",
      entityId: "import-federal",
      includeHr: true,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/holidays/import-egyptian", async (req, res) => {
  if (!roles.canManageHolidayActivation(req.userRole)) {
    return res.status(403).json({ error: "Admin only" });
  }
  try {
    const { getEgyptianHolidays } = require("../scripts/seed-egyptian-holidays");
    const rows = getEgyptianHolidays();
    const company = parseCompany(req);
    const result = await hrms.seedPublicHolidays(rows, req.username, company);
    await auditNotify.auditNotify({
      actor: req.username,
      action: "holiday_import",
      title: "Egyptian holidays imported",
      body: `${rows.length} rows (inactive until enabled)`,
      entityType: "holiday",
      entityId: "import-egyptian",
      includeHr: true,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete("/holidays/:id", async (req, res) => {
  if (!roles.canViewSettingsSection(req.userRole, "holidays")) {
    return res.status(403).json({ error: "No permission to manage holidays" });
  }
  try {
    await hrms.deletePublicHoliday(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/payroll-lock/:month", async (req, res) => {
  try {
    const company = parseCompany(req);
    const lock = await hrms.getPayrollMonthLock(req.params.month, company);
    res.json({ lock, company });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/payroll-lock/:month", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) return res.status(403).json({ error: "HR/admin only" });
  try {
    const company = parseCompany(req);
    const result = await hrms.setPayrollMonthLock(
      req.params.month,
      req.body.locked !== false,
      req.username,
      req.body.notes,
      company
    );
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/payroll-gates/:employeeId", async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const gates = await payrollGates.getPayrollBlockers(req.params.employeeId, month);
    res.json(gates);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/notifications", async (req, res) => {
  try {
    const notifyStore = require("../lib/notify-store");
    const companyCtx = require("../lib/company-context");
    const company = companyCtx.resolveCompanyContextForUser(req.query.company, req.userRole);
    const items = await require("../lib/notifications").collectNotifications(
      req.username,
      req.userRole?.role,
      company
    );
    const scopedIds = new Set(
      companyCtx
        .filterEmployeesByCompany(store.getEmployees({ hideOut: false }), company)
        .map((e) => e.id)
    );
    const { notificationItemInCompany } = require("../lib/notifications");
    const unreadAll = await notifyStore.readNotifications(req.username, { unreadOnly: true, limit: 200, company });
    const unread = [];
    for (const n of unreadAll) {
      if (await notificationItemInCompany(n, company, scopedIds)) unread.push(n);
    }
    res.json({
      notifications: items,
      unreadCount: unread.length,
      totalCount: items.length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/notification-routing", async (req, res) => {
  if (!["admin", "ceo", "rtm", "hr"].includes(req.userRole?.role)) {
    return res.status(403).json({ error: "Admin or RTM only" });
  }
  try {
    const routingConfig = require("../lib/notification-routing-config");
    const company = parseCompany(req);
    const rules = await routingConfig.listRules(company);
    res.json({ rules, company });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/notification-routing/:actionKey", async (req, res) => {
  if (!["admin", "ceo", "rtm"].includes(req.userRole?.role)) {
    return res.status(403).json({ error: "Admin or RTM only" });
  }
  try {
    const routingConfig = require("../lib/notification-routing-config");
    const company = parseCompany(req);
    const rule = await routingConfig.upsertRule(decodeURIComponent(req.params.actionKey), {
      recipientRoles: req.body.recipientRoles,
      recipientUsernames: req.body.recipientUsernames,
      enabled: req.body.enabled,
      label: req.body.label,
      description: req.body.description,
    }, company);
    res.json({ ok: true, rule });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/notification-routing/seed", async (req, res) => {
  if (!["admin", "ceo", "rtm"].includes(req.userRole?.role)) {
    return res.status(403).json({ error: "Admin or RTM only" });
  }
  try {
    const routingConfig = require("../lib/notification-routing-config");
    const company = parseCompany(req);
    const result = await routingConfig.seedDefaultRules(company);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/notifications/read-all", async (req, res) => {
  try {
    const company = parseCompany(req);
    await require("../lib/notify-store").markAllRead(req.username, { company });
    res.json({ ok: true, company });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/notifications/:id/read", async (req, res) => {
  if (req.params.id === "read-all") {
    return res.status(400).json({ error: "Use POST /notifications/read-all" });
  }
  try {
    await require("../lib/notify-store").markNotificationRead(req.params.id, req.username);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/reports/turnover", async (req, res) => {
  try {
    const companyCtx = require("../lib/company-context");
    const company = companyCtx.resolveCompanyContextForUser(req.query.company, req.userRole);
    const report = await require("../lib/reports-extended").buildTurnoverReport(store.getEmployees(), companyCtx, company);
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/reports/attendance-rankings", async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const companyCtx = require("../lib/company-context");
    const company = companyCtx.resolveCompanyContextForUser(req.query.company, req.userRole);
    const report = await require("../lib/reports-extended").buildAttendanceRankings(month, store, companyCtx, company);
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/reports/payroll-compare", async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const companyCtx = require("../lib/company-context");
    const company = companyCtx.resolveCompanyContextForUser(req.query.company, req.userRole);
    const report = await require("../lib/reports-extended").buildPayrollCompare(month, store, company, async (ym) => {
      await store.refreshPayrollAdjustmentsFromSupabase(ym);
      let employees = store.getEmployeesForMonth(ym, { hideOut: false });
      employees = companyCtx.filterEmployeesByCompany(employees, company);
      employees = roles.filterEmployeesForUser(employees, req.userRole);
      return require("../lib/enriched-payroll").buildForEmployees(ym, employees);
    });
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/alerts/employment", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR access required" });
  }
  try {
    const companyCtx = require("../lib/company-context");
    const company = companyCtx.resolveCompanyContextForUser(req.query.company, req.userRole);
    const { todayLocalIsoDate, addCalendarDays } = require("../lib/date-iso");
    const days = Math.min(Number(req.query.days) || 60, 180);
    const today = todayLocalIsoDate();
    const cutoffStr = addCalendarDays(today, days);
    const alerts = [];
    let employees = store.getEmployees();
    if (company) {
      employees = companyCtx.filterEmployeesByCompany(employees, company);
    }
    for (const e of employees) {
      if (e.probation_end_date && e.probation_end_date >= today && e.probation_end_date <= cutoffStr) {
        alerts.push({
          type: "probation",
          employeeId: e.id,
          name: e.american_name || e.arabic_name || e.id,
          date: e.probation_end_date,
        });
      }
      if (e.contract_end_date && e.contract_end_date >= today && e.contract_end_date <= cutoffStr) {
        alerts.push({
          type: "contract",
          employeeId: e.id,
          name: e.american_name || e.arabic_name || e.id,
          date: e.contract_end_date,
        });
      }
    }
    alerts.sort((a, b) => a.date.localeCompare(b.date));
    res.json({ alerts, days });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const customReports = require("../lib/custom-reports");

router.get("/saved-reports", async (req, res) => {
  if (!roles.canManageAll(req.userRole) && !roles.canViewPayroll(req.userRole)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const reports = await customReports.readSavedReports(req.username);
    res.json({ reports, columnSets: customReports.COLUMN_SETS });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/saved-reports", async (req, res) => {
  if (!roles.canManageAll(req.userRole) && !roles.canViewPayroll(req.userRole)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const report = await customReports.upsertSavedReport(req.body, req.username);
    res.json({ ok: true, report });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.patch("/saved-reports/:id", async (req, res) => {
  if (!roles.canManageAll(req.userRole) && !roles.canViewPayroll(req.userRole)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const report = await customReports.upsertSavedReport({ ...req.body, id: req.params.id }, req.username);
    res.json({ ok: true, report });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete("/saved-reports/:id", async (req, res) => {
  if (!roles.canManageAll(req.userRole) && !roles.canViewPayroll(req.userRole)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    await customReports.deleteSavedReport(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/saved-reports/:id/run", async (req, res) => {
  if (!roles.canManageAll(req.userRole) && !roles.canViewPayroll(req.userRole)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const report = await customReports.getSavedReport(req.params.id);
    if (!report) return res.status(404).json({ error: "Report not found" });
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const company = parseCompany(req);
    const csv = await customReports.runReport(report, store, month, company);
    res.type("text/csv").attachment(`${report.name.replace(/[^\w-]+/g, "_")}.csv`).send(csv);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/exports/changelog", async (req, res) => {
  if (!roles.canViewLogs(req.userRole)) return res.status(403).json({ error: "Forbidden" });
  try {
    const company = parseCompany(req);
    const scoped = companyContext.filterEmployeesByCompany(store.getEmployees(), company);
    const limit = Math.min(Number(req.query.limit) || 500, 2000);
    const entries = await changelog.readChangeLog({
      limit,
      employeeIds: new Set(scoped.map((e) => e.id)),
      company,
    });
    if (req.query.format === "csv") {
      const { changelogToCsv } = require("../lib/export-zip");
      res.type("text/csv").attachment("change-log.csv").send(changelogToCsv(entries));
      return;
    }
    res.json({ entries });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/exports/finance-handoff", async (req, res) => {
  if (!roles.canViewLogs(req.userRole)) return res.status(403).json({ error: "Finance handoff restricted to Admin/CEO." });
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const company = parseCompany(req);
    const { buildFinanceHandoffZip } = require("../lib/export-zip");
    const zip = await buildFinanceHandoffZip(month, req.userRole, company);
    res.type("application/zip").attachment(`finance-handoff-${month}.zip`).send(zip);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/attendance/bulk-dayoff", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin only" });
  }
  const date = String(req.body?.date || "").slice(0, 10);
  const scope = req.body?.scope || "federal_active";
  if (!date) return res.status(400).json({ error: "date required" });

  try {
    await assertMonthNotLocked(date.slice(0, 7), req);
    const holidays = await hrms.readPublicHolidays({ company: parseCompany(req), activeOnly: true });
    const holiday = holidays.find((h) => String(h.date || h.holidayDate || "").slice(0, 10) === date);
    if (scope === "federal_active" && (!holiday || holiday.country === "EGY")) {
      return res.status(400).json({ error: "Date is not an active US federal holiday." });
    }

    const month = date.slice(0, 7);
    const company = parseCompany(req);
    const employees = companyContext
      .filterEmployeesByCompany(
        store.getEmployeesForMonth(month, { hideOut: false }),
        company
      )
      .filter((e) => e.status === "Active" || e.status === "Paused");
    const records = employees.map((emp) => ({
      employeeId: emp.id,
      date,
      status: "Day-OFF",
      isWeekendDefault: false,
    }));
    const count = records.length
      ? await store.saveAttendanceBatch(records, req.username)
      : 0;
    res.json({ ok: true, count, date });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

function assertMonthNotLocked(month, req) {
  const company = parseCompany(req);
  return hrms.getPayrollMonthLock(month, company).then((lock) => {
    if (lock) throw new Error(`Payroll for ${month} is locked.`);
  });
}

module.exports = router;

const express = require("express");
const roles = require("../lib/roles");
const hrms = require("../lib/hrms-repo");
const payrollGates = require("../lib/payroll-gates");
const { useSupabase } = require("../lib/backend");
const store = require("../lib/data-store");
const changelog = require("../lib/changelog");
const { mondayOfWeek, fridayOfWeek } = require("../lib/employment-periods");
const { statusOptions } = require("../lib/employee-status");
const requestRules = require("../lib/request-rules");
const leaveAttendance = require("../lib/leave-attendance");
const auditNotify = require("../lib/notify-routing");
const departureDeductions = require("../lib/departure-deductions");

const router = express.Router();

function requireSupabase(_req, res, next) {
  if (!useSupabase()) return res.status(503).json({ error: "Requires DATA_BACKEND=supabase" });
  next();
}

router.use(requireSupabase);

router.get("/org-structure", async (req, res) => {
  try {
    const companyCtx = require("../lib/company-context");
    const company = companyCtx.parseCompanyContext(req.query.company);
    let structure = await hrms.getLiveOrgStructure(company);
    if (roles.canViewOrgScoped(req.userRole)) {
      structure = hrms.filterOrgStructureForRole(structure, req.userRole);
    }
    res.json(structure);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/teams", async (_req, res) => {
  try {
    const teams = await hrms.readOrgTeams();
    res.json({ teams, orgUnits: hrms.ORG_UNITS });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/teams", async (req, res) => {
  if (!roles.canManageOrgStructure(req.userRole)) return res.status(403).json({ error: "Admin/HR only" });
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
    const team = await hrms.updateOrgTeam(req.params.id, req.body, req.username);
    res.json({ ok: true, team });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/teams/:id/relocate", async (req, res) => {
  if (!roles.canManageOrgStructure(req.userRole)) return res.status(403).json({ error: "Admin/HR only" });
  try {
    const newUnit = String(req.body?.unit || "").trim();
    if (!newUnit) return res.status(400).json({ error: "unit required" });
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
    const result = await hrms.deleteOrgTeam(req.params.id, req.username);
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
    const period = await hrms.addEmploymentPeriod(req.params.employeeId, { startDate, notes }, req.username);
    await store.updateEmployee(req.params.employeeId, { status: "Active", employment_date: startDate, depart_date: null }, req.username);
    res.json({ ok: true, period });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/employment-periods/:employeeId/depart", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) return res.status(403).json({ error: "HR/admin only" });
  try {
    const { departDate, status, notice_type: noticeType } = req.body;
    if (!departDate) return res.status(400).json({ error: "departDate required" });

    const notice = noticeType === "without_notice" ? "without_notice" : "with_notice";
    const emp = store.getEmployeeById(req.params.employeeId);
    if (!emp) return res.status(404).json({ error: "Employee not found" });

    await hrms.closeEmploymentPeriod(req.params.employeeId, departDate, req.username);
    const statusLabel = status === "out_still_paid" ? "OUT BUT STILL GET PAID" : "Out";
    await store.updateEmployee(
      req.params.employeeId,
      { status: statusLabel, depart_date: departDate, notice_type: notice },
      req.username
    );

    let deductions = [];
    if (notice === "without_notice") {
      try {
        deductions = await departureDeductions.createNoNoticeDeductions(
          { ...emp, depart_date: departDate },
          departDate,
          store,
          req.username
        );
      } catch (dedErr) {
        console.warn("No-notice deductions failed:", dedErr.message);
      }
    }

    res.json({ ok: true, notice_type: notice, deductions });
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
    const plan = await hrms.cancelActionPlan(req.params.id, req.username);
    res.json({ ok: true, plan });
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
        passedOnDate: req.body?.passedOnDate,
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

router.get("/equipment", async (req, res) => {
  if (!roles.canViewEquipmentInventory(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  try {
    const store = require("../lib/data-store");
    const [equipment, assignments] = await Promise.all([
      hrms.readAllEquipment(),
      hrms.readEquipmentAssignments(),
    ]);
    let scopedAssignments = assignments;
    if (roles.canViewEquipmentUnit(req.userRole) && !roles.canViewEquipmentAll(req.userRole)) {
      const unit = req.userRole?.unit;
      const empIds = new Set(
        store.getEmployees({ hideOut: false }).filter((e) => e.unit === unit).map((e) => e.id)
      );
      scopedAssignments = assignments.filter((a) => empIds.has(a.employeeId));
    }
    res.json({ equipment, assignments: scopedAssignments });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/equipment/:employeeId", async (req, res) => {
  const store = require("../lib/data-store");
  const targetId = req.params.employeeId;
  const emp = store.getEmployeeById(targetId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  const allowed =
    roles.canViewEquipmentAll(req.userRole) ||
    (roles.canViewEquipmentUnit(req.userRole) &&
      req.userRole?.unit &&
      emp.unit === req.userRole.unit) ||
    (req.userRole?.employeeId && req.userRole.employeeId === targetId);
  if (!allowed) {
    return res.status(403).json({ error: "No permission" });
  }
  try {
    const assignments = await hrms.readEquipmentAssignments(targetId);
    res.json({ assignments });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/equipment", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) return res.status(403).json({ error: "HR/admin only" });
  try {
    const equipment = await hrms.createEquipment(req.body, req.username);
    res.json({ ok: true, equipment });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.patch("/equipment/:id", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) return res.status(403).json({ error: "HR/admin only" });
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
  if (!roles.canManageAll(req.userRole)) return res.status(403).json({ error: "HR/admin only" });
  try {
    const a = await hrms.assignEquipment(req.body.equipmentId, req.body.employeeId, req.username);
    res.json({ ok: true, assignment: a });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/equipment/return/:assignmentId", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) return res.status(403).json({ error: "HR/admin only" });
  try {
    const a = await hrms.returnEquipment(req.params.assignmentId, req.username);
    res.json({ ok: true, assignment: a });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/leave", async (req, res) => {
  try {
    const requests = await hrms.readLeaveRequests({
      employeeId: req.query.employeeId,
      status: req.query.status,
    });
    res.json({ requests, canApprove: roles.canApproveLeave(req.username) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/leave", async (req, res) => {
  try {
    const targetEmp = store.getEmployeeById(req.body.employeeId);
    const validated = requestRules.validateRequestSubmit({
      requestKind: req.body.requestKind || req.body.leaveType,
      employeeId: req.body.employeeId,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
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
      requestedBy: req.username,
      requestedByRole: req.userRole?.role || "",
    };
    const request = await hrms.createLeaveRequest(payload, req.username);
    const dispatch = require("../lib/notify-dispatch");
    await dispatch.dispatchNotification({
      actionKey: "leave_submitted",
      type: "leave",
      title: "Leave request submitted",
      body: `${req.body.employeeId}: ${req.body.startDate} – ${req.body.endDate || req.body.startDate}`,
      entityType: "leave",
      entityId: String(request.id),
      actor: req.username,
    });
    if (validated.lateSubmission) {
      await auditNotify.hrWarning({
        actor: req.username,
        title: "Late same-day leave request",
        body: `${req.body.employeeId}: ${req.body.startDate}`,
        entityType: "leave",
        entityId: String(request.id),
      });
    }
    if (validated.tlRequested) {
      await auditNotify.hrWarning({
        actor: req.username,
        title: "Leave requested by TL/OP",
        body: `${req.body.employeeId} — ${validated.requestKind}`,
        entityType: "leave",
        entityId: String(request.id),
      });
    }
    res.status(201).json({ ok: true, request });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put("/leave/:id", async (req, res) => {
  if (req.body.status && req.body.status !== "pending" && !roles.canApproveLeave(req.username)) {
    return res.status(403).json({ error: "Only Mark, Raymond, or Phoebe may approve leave." });
  }
  const canEdit = roles.canApproveLeave(req.username);
  if (!canEdit && Object.keys(req.body).some((k) => k !== "status")) {
    return res.status(403).json({ error: "Only approvers may edit requests." });
  }
  try {
    const prior = (await hrms.readLeaveRequests({})).find((r) => String(r.id) === String(req.params.id));
    const request = await hrms.updateLeaveRequest(req.params.id, req.body, req.username);
    if (request.status === "approved") {
      const records = leaveAttendance.leaveAttendanceRecords(request);
      if (records.length) await store.saveAttendanceBatch(records, req.username);
    } else if (prior?.status === "approved" && request.status !== "approved") {
      const records = leaveAttendance.clearLeaveAttendanceRecords(prior);
      if (records.length) await store.saveAttendanceBatch(records, req.username);
    }
    if (canEdit && prior) {
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
  if (!roles.canApproveLeave(req.username)) {
    return res.status(403).json({ error: "Only Mark, Raymond, or Phoebe may delete leave requests." });
  }
  try {
    const prior = (await hrms.readLeaveRequests({})).find((r) => String(r.id) === String(req.params.id));
    if (prior?.status === "approved") {
      const records = leaveAttendance.clearLeaveAttendanceRecords(prior);
      if (records.length) await store.saveAttendanceBatch(records, req.username);
    }
    await hrms.deleteLeaveRequest(req.params.id);
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

router.get("/holidays", async (req, res) => {
  if (!roles.canViewSettingsSection(req.userRole, "holidays")) {
    return res.status(403).json({ error: "No permission to view holidays" });
  }
  try {
    res.json({ holidays: await hrms.readPublicHolidays() });
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
    const existing = (await hrms.readPublicHolidays()).find((h) => h.id === req.params.id);
    if (!existing) return res.status(404).json({ error: "Holiday not found" });
    if (
      req.body?.active !== undefined &&
      String(existing.country || "USA").toUpperCase() === "EGY" &&
      !roles.canManageHolidayActivation(req.userRole)
    ) {
      return res.status(403).json({ error: "Only Admin can activate Egyptian holidays" });
    }
    const holiday = await hrms.updatePublicHoliday(req.params.id, req.body);
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
    const result = await hrms.seedPublicHolidays(rows, req.username);
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
    const result = await hrms.seedPublicHolidays(rows, req.username);
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
    const lock = await hrms.getPayrollMonthLock(req.params.month);
    res.json({ lock });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/payroll-lock/:month", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) return res.status(403).json({ error: "HR/admin only" });
  try {
    const result = await hrms.setPayrollMonthLock(req.params.month, req.body.locked !== false, req.username, req.body.notes);
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
    const items = await require("../lib/notifications").collectNotifications(req.username, req.userRole?.role);
    const unread = await notifyStore.readNotifications(req.username, { unreadOnly: true, limit: 200 });
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
    const rules = await routingConfig.listRules();
    res.json({ rules });
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
    const rule = await routingConfig.upsertRule(decodeURIComponent(req.params.actionKey), {
      recipientRoles: req.body.recipientRoles,
      recipientUsernames: req.body.recipientUsernames,
      enabled: req.body.enabled,
      label: req.body.label,
      description: req.body.description,
    });
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
    const result = await routingConfig.seedDefaultRules();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/notifications/:id/read", async (req, res) => {
  try {
    await require("../lib/notify-store").markNotificationRead(req.params.id, req.username);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/notifications/read-all", async (req, res) => {
  try {
    await require("../lib/notify-store").markAllRead(req.username);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/reports/turnover", async (req, res) => {
  try {
    const report = await require("../lib/reports-extended").buildTurnoverReport(store.getEmployees());
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/reports/attendance-rankings", async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const report = await require("../lib/reports-extended").buildAttendanceRankings(month, store);
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/reports/payroll-compare", async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const report = await require("../lib/reports-extended").buildPayrollCompare(month, store);
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
    const days = Math.min(Number(req.query.days) || 60, 180);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const alerts = [];
    for (const e of store.getEmployees()) {
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
    const csv = await customReports.runReport(report, store, month);
    res.type("text/csv").attachment(`${report.name.replace(/[^\w-]+/g, "_")}.csv`).send(csv);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/exports/changelog", async (req, res) => {
  if (!roles.canViewLogs(req.userRole)) return res.status(403).json({ error: "Forbidden" });
  try {
    const limit = Math.min(Number(req.query.limit) || 500, 2000);
    const entries = await changelog.readChangeLog({ limit });
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
    const { buildFinanceHandoffZip } = require("../lib/export-zip");
    const zip = await buildFinanceHandoffZip(month, req.userRole);
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
    await assertMonthNotLocked(date.slice(0, 7));
    const holidays = await hrms.readPublicHolidays();
    const holiday = holidays.find((h) => String(h.date || h.holidayDate || "").slice(0, 10) === date);
    if (scope === "federal_active" && (!holiday || holiday.country === "EGY")) {
      return res.status(400).json({ error: "Date is not an active US federal holiday." });
    }

    const month = date.slice(0, 7);
    const employees = store
      .getEmployeesForMonth(month, { hideOut: false })
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

function assertMonthNotLocked(month) {
  return hrms.getPayrollMonthLock(month).then((lock) => {
    if (lock?.locked) throw new Error(`Payroll for ${month} is locked.`);
  });
}

module.exports = router;

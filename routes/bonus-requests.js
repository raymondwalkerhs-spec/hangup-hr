const express = require("express");
const business = require("../lib/business-repo");
const roles = require("../lib/roles");
const store = require("../lib/data-store");
const notify = require("../lib/notify-store");
const { fetchAuthUsers } = require("../lib/auth");
const { TL_BONUS_TYPE } = require("../lib/hr-constants");
const { assertBonusAllowedForEmployee } = require("../lib/bonus-guards");
const companyContext = require("../lib/company-context");
const { assertEmployeeInCompanyContext } = require("../lib/request-company-guard");
const { applyTlBonusTransfer, resolveTlPayerEmployeeId } = require("../lib/tl-bonus-transfer");

const BONUS_REQUEST_TYPES = [TL_BONUS_TYPE];

const router = express.Router();

function filterRequestsForUser(requests, userRole, employees) {
  if (roles.canApproveBonusRequest(userRole)) return requests;
  const scope = roles.scopedEmployeeIds(employees, userRole);
  return requests.filter(
    (r) => r.submittedBy === userRole.username || scope.has(r.employeeId)
  );
}

router.get("/", async (req, res) => {
  try {
    const month = req.query.month || "";
    const status = req.query.status || "";
    const isApprover = roles.canApproveBonusRequest(req.userRole);
    const employees = store.getEmployees();
    const filters = { status };
    // Pending requests are shown across all months so notifications always match the list.
    if (month && status !== "pending") filters.month = month;
    let items = await business.readBonusRequests(
      filters,
      status === "pending" ? { skipCache: true } : {}
    );
    items = filterRequestsForUser(items, req.userRole, employees);
    const company = companyContext.resolveCompanyContextForUser(req.query.company, req.userRole);
    const companyEmployees = companyContext.filterEmployeesByCompany(employees, company);
    const companyEmployeeIds = new Set(companyEmployees.map((e) => e.id));
    items = items.filter((r) => companyEmployeeIds.has(r.employeeId));
    res.json({ requests: items, types: BONUS_REQUEST_TYPES });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  if (!roles.canSubmitBonusRequest(req.userRole)) {
    return res.status(403).json({ error: "No permission to submit bonus requests" });
  }
  const { employeeId, date, amount, type, reason, unit } = req.body;
  if (!employeeId || !date || amount == null) {
    return res.status(400).json({ error: "employeeId, date, amount required" });
  }
  const bonusType = type || TL_BONUS_TYPE;
  if (bonusType !== TL_BONUS_TYPE) {
    return res.status(400).json({ error: `Bonus requests must use type "${TL_BONUS_TYPE}"` });
  }
  const emp = store.getEmployeeById(employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  if (!assertEmployeeInCompanyContext(emp, req)) {
    return res.status(403).json({ error: "No access to this employee" });
  }
  try {
    assertBonusAllowedForEmployee(emp, date);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  try {
    const authUsers = await fetchAuthUsers();
    if (!roles.canReceiveBonusViaRequest(employeeId, authUsers)) {
      return res.status(400).json({
        error: "This employee can only receive bonuses via payslip (HR direct add)",
      });
    }
    const created = await business.createBonusRequest(
      {
        employeeId,
        date,
        amount: Number(amount),
        type: bonusType,
        reason,
        unit: unit || emp.unit || "",
      },
      req.username
    );
    const dispatch = require("../lib/notify-dispatch");
    const companyContext = require("../lib/company-context");
    await dispatch.dispatchNotification({
      actionKey: "bonus_request_submitted",
      type: "bonus_request",
      title: "Bonus request pending approval",
      body: `${employeeId}: ${amount} EGP on ${date}`,
      entityType: "bonus_request",
      entityId: created.id,
      actor: req.username,
      context: { company: companyContext.getCompanyForUnit(emp.unit) },
    });
    res.json({ ok: true, request: created });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch("/:id", async (req, res) => {
  if (!roles.canApproveBonusRequest(req.userRole)) {
    return res.status(403).json({ error: "HR or admin required to approve" });
  }
  const { action, denyReason } = req.body;
  if (!["approve", "deny"].includes(action)) {
    return res.status(400).json({ error: "action must be approve or deny" });
  }
  try {
    const existing = await business.getBonusRequest(req.params.id);
    if (!existing) return res.status(404).json({ error: "Request not found" });
    const reqEmp = store.getEmployeeById(existing.employeeId);
    if (!reqEmp || !assertEmployeeInCompanyContext(reqEmp, req)) {
      return res.status(404).json({ error: "Request not found" });
    }
    if (existing.status !== "pending") {
      return res.status(400).json({ error: "Request already reviewed" });
    }
    if (action === "deny") {
      const updated = await business.updateBonusRequest(
        req.params.id,
        {
          status: "denied",
          reviewedBy: req.username,
          reviewedAt: new Date().toISOString(),
          denyReason: denyReason || "",
        },
        req.username
      );
      await notify.createNotification({
        username: existing.submittedBy,
        type: "bonus_request",
        title: "Bonus request denied",
        body: `${existing.employeeId}: ${denyReason || "No reason given"}`,
        entityType: "bonus_request",
        entityId: existing.id,
      });
      return res.json({ ok: true, request: updated });
    }
    const emp = store.getEmployeeById(existing.employeeId);
    try {
      assertBonusAllowedForEmployee(emp, existing.date);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    if (existing.type === TL_BONUS_TYPE) {
      const deductFromEmployeeId = await resolveTlPayerEmployeeId(existing.submittedBy);
      if (!deductFromEmployeeId) {
        return res.status(400).json({
          error: `Could not resolve TL/OP employee for submitter "${existing.submittedBy}". Link their login to an employee ID first.`,
        });
      }
      await applyTlBonusTransfer(
        {
          employeeId: existing.employeeId,
          deductFromEmployeeId,
          date: existing.date,
          amount: existing.amount,
          reason: existing.reason,
          unit: existing.unit || emp?.unit || "",
        },
        req.username
      );
    } else {
      await store.upsertBonus(
        {
          employeeId: existing.employeeId,
          date: existing.date,
          amount: existing.amount,
          reason: existing.reason,
          type: existing.type,
          unit: existing.unit || emp?.unit || "",
        },
        req.username
      );
    }
    const updated = await business.updateBonusRequest(
      req.params.id,
      {
        status: "approved",
        reviewedBy: req.username,
        reviewedAt: new Date().toISOString(),
        bonusEmployeeId: existing.employeeId,
        bonusDate: existing.date,
        bonusType: existing.type,
      },
      req.username
    );
    await notify.createNotification({
      username: existing.submittedBy,
      type: "bonus_request",
      title: "Bonus request approved",
      body: `${existing.employeeId}: ${existing.amount} EGP`,
      entityType: "bonus_request",
      entityId: existing.id,
    });
    res.json({ ok: true, request: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

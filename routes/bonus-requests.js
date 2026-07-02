const express = require("express");
const business = require("../lib/business-repo");
const roles = require("../lib/roles");
const store = require("../lib/data-store");
const notify = require("../lib/notify-store");
const { fetchAuthUsers } = require("../lib/auth");
const { TL_BONUS_TYPE } = require("../lib/hr-constants");
const { assertBonusAllowedForEmployee } = require("../lib/bonus-guards");

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
    const employees = store.getEmployees();
    let items = await business.readBonusRequests({ month, status });
    items = filterRequestsForUser(items, req.userRole, employees);
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
  if (!roles.canAccessEmployee(req.userRole, emp)) {
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
    const approvers = (authUsers || [])
      .filter((u) => roles.canApproveBonusRequest({ role: roles.normalizeRole(u.role) }))
      .map((u) => u.user);
    await notify.createNotificationsForUsers(approvers, {
      type: "bonus_request",
      title: "Bonus request pending approval",
      body: `${employeeId}: ${amount} EGP on ${date}`,
      entityType: "bonus_request",
      entityId: created.id,
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

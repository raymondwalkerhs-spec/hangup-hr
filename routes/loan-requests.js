const express = require("express");
const loanReq = require("../lib/loan-requests-repo");
const roles = require("../lib/roles");
const store = require("../lib/data-store");
const notify = require("../lib/notify-store");
const companyContext = require("../lib/company-context");
const { parseCompany } = require("../lib/request-company-guard");

const router = express.Router();

router.get("/", async (req, res) => {
  if (!roles.canViewLoanRequests(req.username) && !roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "No permission" });
  }
  try {
    const status = req.query.status || "";
    const unit   = req.query.unit   || "";
    const filters = { status: status || undefined };
    // Executives see all; HR/Admin scoped to unit if provided
    if (!roles.canViewLoanRequests(req.username) && unit) filters.unit = unit;
    const company = companyContext.resolveCompanyContextForUser(req.query.company, req.userRole);
    if (company) filters.company = company;
    let items = await loanReq.readLoanRequests(filters);
    // Apply company context filter (employee fallback for legacy rows)
    if (company) {
      const companyEmployees = companyContext.filterEmployeesByCompany(
        store.getEmployees({ hideOut: false }),
        company
      );
      const companyEmployeeIds = new Set(companyEmployees.map((e) => e.id));
      items = items.filter(
        (r) => companyEmployeeIds.has(r.employeeId) || companyEmployeeIds.has(String(r.submittedBy || "").trim())
      );
    }
    if (!roles.canViewLoanRequests(req.username)) {
      // HR/Admin see their unit's requests; others see only their own
      if (!roles.canManageAll(req.userRole)) {
        items = items.filter(
          (r) => String(r.submittedBy).toLowerCase() === String(req.username).toLowerCase()
        );
      }
    }
    res.json({ requests: items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  if (!roles.canManageAll(req.userRole)) {
    return res.status(403).json({ error: "HR/admin required to submit loan requests" });
  }
  const { employeeId, totalAmount, installmentAmount, installmentsCount, skipCurrentMonth, notes, createdYearMonth } =
    req.body;
  if (!employeeId || !totalAmount) {
    return res.status(400).json({ error: "employeeId and totalAmount required" });
  }
  const emp = store.getEmployeeById(employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  const company = companyContext.getCompanyForUnit(emp.unit);
  if (!companyContext.employeeInCompanyContext(emp, companyContext.resolveCompanyContextForUser(req.query.company || req.body?.company, req.userRole))) {
    return res.status(403).json({ error: "Employee not in company context" });
  }
  try {
    const created = await loanReq.createLoanRequest(
      {
        employeeId,
        totalAmount: Number(totalAmount),
        installmentAmount,
        installmentsCount,
        skipCurrentMonth,
        notes,
        createdYearMonth,
        unit: emp.unit || "",
      },
      req.username
    );
    const dispatch = require("../lib/notify-dispatch");
    await dispatch.dispatchNotification({
      actionKey: "loan_request_submitted",
      type: "loan_request",
      title: "Loan request pending approval",
      body: `${employeeId}: ${totalAmount} EGP`,
      entityType: "loan_request",
      entityId: created.id,
      actor: req.username,
      context: { company },
    }).catch(() => {});
    res.json({ ok: true, request: created });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/:id/approve", async (req, res) => {
  if (!roles.canApproveLoanRequest(req.username)) {
    return res.status(403).json({ error: "Executive approval required" });
  }
  try {
    const existing = await loanReq.getLoanRequest(req.params.id);
    if (!existing) return res.status(404).json({ error: "Request not found" });
    const emp = store.getEmployeeById(existing.employeeId);
    const company = parseCompany(req);
    if (!emp || !companyContext.employeeInCompanyContext(emp, company)) {
      return res.status(404).json({ error: "Request not found" });
    }
    if (existing.status !== "pending") {
      return res.status(400).json({ error: "Request already reviewed" });
    }
    const loan = await store.createEmployeeLoan(
      {
        employeeId: existing.employeeId,
        totalAmount: existing.totalAmount,
        installmentAmount: existing.installmentAmount,
        installmentsCount: existing.installmentsCount,
        skipCurrentMonth: existing.skipCurrentMonth,
        notes: existing.notes,
        createdYearMonth: existing.createdYearMonth || new Date().toISOString().slice(0, 7),
      },
      req.username
    );
    const updated = await loanReq.updateLoanRequest(existing.id, {
      status: "approved",
      reviewedBy: req.username,
      reviewedAt: new Date().toISOString(),
      createdLoanId: loan.id,
    });
    await notify.createNotification({
      username: existing.submittedBy,
      type: "loan_request",
      title: "Loan request approved",
      body: `${existing.employeeId}: ${existing.totalAmount} EGP`,
      entityType: "loan_request",
      entityId: existing.id,
      company,
    });
    res.json({ ok: true, request: updated, loan });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/:id/deny", async (req, res) => {
  if (!roles.canApproveLoanRequest(req.username)) {
    return res.status(403).json({ error: "Executive approval required" });
  }
  const { denyReason } = req.body;
  try {
    const existing = await loanReq.getLoanRequest(req.params.id);
    if (!existing) return res.status(404).json({ error: "Request not found" });
    const emp = store.getEmployeeById(existing.employeeId);
    const company = parseCompany(req);
    if (!emp || !companyContext.employeeInCompanyContext(emp, company)) {
      return res.status(404).json({ error: "Request not found" });
    }
    if (existing.status !== "pending") {
      return res.status(400).json({ error: "Request already reviewed" });
    }
    const updated = await loanReq.updateLoanRequest(existing.id, {
      status: "denied",
      reviewedBy: req.username,
      reviewedAt: new Date().toISOString(),
      denyReason: denyReason || "",
    });
    await notify.createNotification({
      username: existing.submittedBy,
      type: "loan_request",
      title: "Loan request denied",
      body: `${existing.employeeId}: ${denyReason || "No reason given"}`,
      entityType: "loan_request",
      entityId: existing.id,
      company,
    });
    res.json({ ok: true, request: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

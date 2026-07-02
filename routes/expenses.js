const express = require("express");
const business = require("../lib/business-repo");
const roles = require("../lib/roles");
const notify = require("../lib/notify-store");
const auditNotify = require("../lib/notify-routing");
const { uploadBuffer } = require("../lib/storage");

const router = express.Router();

const AUDIT_EXEMPT = new Set([auditNotify.AUDIT_ADMIN, auditNotify.CEO_USERNAME]);

function shouldAuditExpense(actor) {
  const a = String(actor || "").trim().toLowerCase();
  return Boolean(a) && !AUDIT_EXEMPT.has(a);
}

function isExpenseEditPatch(patch) {
  return ["vendorName", "description", "amount", "receiptFileId"].some((k) => patch[k] !== undefined);
}

function requireFinance(req, res, next) {
  if (!roles.canAccessCostsFull(req.userRole, req.username)) {
    return res.status(403).json({ error: "Finance access required" });
  }
  next();
}

function filterExpensesForUser(expenses, userRole, username) {
  if (roles.canAccessCostsFull(userRole, username)) return expenses;
  return expenses.filter(
    (e) => String(e.submittedBy).toLowerCase() === String(username).toLowerCase()
  );
}

router.get("/", async (req, res) => {
  if (!roles.canSubmitExpense(req.userRole, req.username) && !roles.canAccessCostsFull(req.userRole, req.username)) {
    return res.status(403).json({ error: "No permission" });
  }
  try {
    const excludeArchived = req.query.archived !== "true";
    let expenses = await business.readExpenseRequests({
      status: req.query.status,
      excludeArchived,
      starred: req.query.starred === "true",
    });
    expenses = filterExpensesForUser(expenses, req.userRole, req.username);
    res.json({
      expenses,
      statuses: business.EXPENSE_STATUSES,
      priorities: business.EXPENSE_PRIORITIES,
      paymentMethods: business.PAYMENT_METHODS,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  if (!roles.canSubmitExpense(req.userRole, req.username)) {
    return res.status(403).json({ error: "No permission to submit expenses" });
  }
  const { vendorName, description, amount, priority, dueDate, starred } = req.body;
  if (!vendorName || amount == null) {
    return res.status(400).json({ error: "vendorName and amount required" });
  }
  try {
    const expense = await business.createExpenseRequest(
      {
        vendorName,
        description,
        amount: Number(amount),
        priority: priority || "normal",
        dueDate,
        starred,
        submitterRole: req.userRole.role,
      },
      req.username
    );
    if (expense.requiresExecutiveApproval) {
      await notify.createNotificationsForUsers(roles.FINANCE_ACCESS_USERS, {
        type: "expense",
        title: "Expense needs executive approval",
        body: `${vendorName}: ${amount} EGP`,
        entityType: "expense",
        entityId: expense.id,
      });
    }
    res.json({ ok: true, expense });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/:id/receipt", async (req, res) => {
  const expense = await business.getExpenseRequest(req.params.id);
  if (!expense) return res.status(404).json({ error: "Not found" });
  const canSee =
    roles.canAccessCostsFull(req.userRole, req.username) ||
    String(expense.submittedBy).toLowerCase() === String(req.username).toLowerCase();
  if (!canSee) return res.status(403).json({ error: "No access" });

  const { fileName, mimeType, base64 } = req.body;
  if (!base64) return res.status(400).json({ error: "base64 file required" });
  try {
    const buf = Buffer.from(base64, "base64");
    const uploaded = await uploadBuffer({
      employeeId: `expense-${expense.id}`,
      docType: "receipt",
      fileName: fileName || "receipt.pdf",
      kind: "expenses",
      buffer: buf,
      mimeType: mimeType || "application/pdf",
    });
    const updated = await business.updateExpenseRequest(
      req.params.id,
      { receiptFileId: uploaded.fileId || uploaded.path },
      req.username
    );
    res.json({ ok: true, expense: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/petty-cash/funds", requireFinance, async (req, res) => {
  try {
    const funds = await business.getPettyCashFunds();
    res.json({ funds });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/petty-cash/ledger", requireFinance, async (req, res) => {
  try {
    const ledger = await business.getPettyCashLedger(req.query.fundId);
    res.json({ ledger });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/petty-cash/deposit", requireFinance, async (req, res) => {
  const { fundId, amount, notes } = req.body;
  if (!fundId || amount == null) {
    return res.status(400).json({ error: "fundId and amount required" });
  }
  try {
    const result = await business.addPettyCashTransaction(
      { fundId, transactionType: "deposit", amount: Number(amount), notes },
      req.username
    );
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/bills", async (req, res) => {
  if (!roles.canAccessCostsFull(req.userRole, req.username)) {
    return res.status(403).json({ error: "Finance access required" });
  }
  try {
    const bills = await business.readMonthlyBills();
    res.json({ bills, billTypes: business.BILL_TYPES });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/bills", requireFinance, async (req, res) => {
  try {
    const bill = await business.upsertMonthlyBill(req.body, req.username);
    res.json({ ok: true, bill });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/bills/:id", requireFinance, async (req, res) => {
  try {
    await business.deleteMonthlyBill(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/:id/receipt", async (req, res) => {
  const expense = await business.getExpenseRequest(req.params.id);
  if (!expense?.receiptFileId) return res.status(404).json({ error: "No receipt" });
  const canSee =
    roles.canAccessCostsFull(req.userRole, req.username) ||
    String(expense.submittedBy).toLowerCase() === String(req.username).toLowerCase();
  if (!canSee) return res.status(403).json({ error: "No access" });
  try {
    const { getStorageFileStream } = require("../lib/storage");
    const { stream, mimeType } = await getStorageFileStream(expense.receiptFileId);
    res.setHeader("Content-Type", mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="receipt-${expense.id}"`);
    stream.pipe(res);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.patch("/:id", requireFinance, async (req, res) => {
  try {
    const patch = { ...req.body };
    const prior = await business.getExpenseRequest(req.params.id);
    const expense = await business.updateExpenseRequest(req.params.id, patch, req.username);

    await business.syncPettyCashForExpense({ prior, expense, patch, actor: req.username });

    if (shouldAuditExpense(req.username) && isExpenseEditPatch(patch)) {
      await auditNotify.auditNotify({
        actor: req.username,
        action: "expense_edit",
        title: "Expense edited",
        body: prior
          ? `${prior.vendorName} ${prior.amount} EGP → ${expense.vendorName} ${expense.amount} EGP`
          : `${expense.vendorName} ${expense.amount} EGP`,
        entityType: "expense",
        entityId: String(expense.id),
      });
    }

    res.json({ ok: true, expense });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/:id", requireFinance, async (req, res) => {
  try {
    const prior = await business.getExpenseRequest(req.params.id);
    if (!prior) return res.status(404).json({ error: "Not found" });
    await business.reversePettyCashForExpense(prior.id);
    await business.deleteExpenseRequest(req.params.id);
    if (shouldAuditExpense(req.username)) {
      await auditNotify.auditNotify({
        actor: req.username,
        action: "expense_delete",
        title: "Expense deleted",
        body: `${prior.vendorName} ${prior.amount} EGP`,
        entityType: "expense",
        entityId: String(prior.id),
      });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

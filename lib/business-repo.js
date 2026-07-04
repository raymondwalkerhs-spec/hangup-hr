/**
 * Supabase CRUD: bonus requests, sales, expenses, petty cash.
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");
const cache = require("./cache");

function db() {
  return getSupabaseAdmin();
}

function requireSupabase() {
  if (!useSupabase()) throw new Error("Feature requires DATA_BACKEND=supabase");
}

function isMissingTableError(error) {
  const msg = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "");
  return (
    code === "42P01" ||
    msg.includes("does not exist") ||
    msg.includes("could not find the table") ||
    msg.includes("schema cache")
  );
}

// --- Bonus requests ---

function mapBonusRequest(r) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    amount: Number(r.amount),
    date: r.date,
    type: r.type || "Other Bonus",
    reason: r.reason || "",
    unit: r.unit || "",
    status: r.status || "pending",
    submittedBy: r.submitted_by,
    reviewedBy: r.reviewed_by || "",
    reviewedAt: r.reviewed_at || null,
    denyReason: r.deny_reason || "",
    bonusEmployeeId: r.bonus_employee_id || null,
    bonusDate: r.bonus_date || null,
    bonusType: r.bonus_type || null,
    createdAt: r.created_at,
  };
}

async function readBonusRequests(filters = {}, opts = {}) {
  requireSupabase();
  if (!opts.skipCache && cache.isCacheWarm()) {
    const cached = cache.getBusinessCache("bonus_requests");
    if (cached) return filterBonusRequests(cached, filters);
  }
  let q = db().from("bonus_requests").select("*").order("created_at", { ascending: false });
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.month) {
    const prefix = String(filters.month).slice(0, 7);
    q = q.gte("date", `${prefix}-01`).lte("date", `${prefix}-31`);
  }
  if (filters.employeeId) q = q.eq("employee_id", filters.employeeId);
  const { data, error } = await q;
  if (error) {
    if (isMissingTableError(error)) return [];
    throw new Error(`readBonusRequests: ${error.message}`);
  }
  return (data || []).map(mapBonusRequest);
}

function filterBonusRequests(list, filters = {}) {
  let rows = list;
  if (filters.status) rows = rows.filter((r) => r.status === filters.status);
  if (filters.month) {
    const prefix = String(filters.month).slice(0, 7);
    rows = rows.filter((r) => String(r.date || "").startsWith(prefix));
  }
  if (filters.employeeId) rows = rows.filter((r) => r.employeeId === filters.employeeId);
  return rows;
}

async function createBonusRequest(payload, actor) {
  requireSupabase();
  const row = {
    employee_id: payload.employeeId,
    amount: Number(payload.amount),
    date: payload.date,
    type: payload.type || "Other Bonus",
    reason: payload.reason || "",
    unit: payload.unit || "",
    status: "pending",
    submitted_by: actor,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db().from("bonus_requests").insert(row).select().single();
  if (error) throw new Error(error.message);
  return mapBonusRequest(data);
}

async function updateBonusRequest(id, patch, actor) {
  requireSupabase();
  const row = { updated_at: new Date().toISOString() };
  if (patch.status) row.status = patch.status;
  if (patch.reviewedBy) row.reviewed_by = patch.reviewedBy;
  if (patch.reviewedAt) row.reviewed_at = patch.reviewedAt;
  if (patch.denyReason !== undefined) row.deny_reason = patch.denyReason;
  if (patch.bonusEmployeeId) row.bonus_employee_id = patch.bonusEmployeeId;
  if (patch.bonusDate) row.bonus_date = patch.bonusDate;
  if (patch.bonusType) row.bonus_type = patch.bonusType;
  const { data, error } = await db().from("bonus_requests").update(row).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return mapBonusRequest(data);
}

async function getBonusRequest(id) {
  requireSupabase();
  const { data, error } = await db().from("bonus_requests").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapBonusRequest(data) : null;
}

// --- Sales ---

const SALE_DEVICES = ["bracelet", "necklace", "smartwatch"];
const SALE_STATUSES = ["passed", "pending", "postdated", "denied", "callback"];

const workingDay = require("./sales-working-day");

function mapSale(r) {
  const formData = r.form_data && typeof r.form_data === "object" ? r.form_data : {};
  const submissionDate = r.submission_date;
  const workingDayVal =
    r.working_day ||
    workingDay.computeWorkingDay(submissionDate) ||
    String(submissionDate || "").slice(0, 10);
  const submissionTime =
    r.submission_time || workingDay.computeSubmissionTime(submissionDate) || "";
  return {
    id: r.id,
    phoneNumber: r.phone_number || formData.phoneNumber || "",
    fullName: r.full_name || formData.fullName || "",
    device: r.device || formData.deviceType || "",
    price: r.price != null ? Number(r.price) : formData.price != null ? Number(formData.price) : null,
    client: r.client || formData.client || "",
    agentId: r.agent_id,
    closerId: r.closer_id || "",
    submittedBy: r.submitted_by,
    status: r.status,
    submissionDate,
    submissionTime,
    workingDay: workingDayVal,
    effectiveDate: r.effective_date,
    feedback: r.feedback || formData.feedback || "",
    callbackVisibleToAgent: r.callback_visible_to_agent === true,
    team: r.team || formData.team || "",
    unit: r.unit || formData.unit || "",
    reviewedBy: r.reviewed_by || "",
    reviewedAt: r.reviewed_at || null,
    createdAt: r.created_at,
    formData,
  };
}

async function readSales(filters = {}, opts = {}) {
  requireSupabase();
  if (!opts.skipCache && cache.isCacheWarm()) {
    const cached = cache.getBusinessCache("sales");
    if (cached) return filterSales(cached, filters);
  }
  let q = db().from("sales").select("*").order("effective_date", { ascending: false });
  if (filters.agentId) q = q.eq("agent_id", filters.agentId);
  if (filters.closerId) q = q.eq("closer_id", filters.closerId);
  if (filters.team) q = q.eq("team", filters.team);
  if (filters.unit) q = q.eq("unit", filters.unit);
  if (filters.status) q = q.eq("status", filters.status);
  const { data, error } = await q;
  if (error) {
    if (isMissingTableError(error)) return [];
    throw new Error(`readSales: ${error.message}`);
  }
  let rows = (data || []).map(mapSale);
  if (filters.from || filters.to) {
    rows = filterSales(rows, filters);
  }
  return rows;
}

function saleInDateRange(sale, from, to, opts = {}) {
  if (!from && !to) return true;
  const basis = opts.dateBasis || "submission";
  const eff = sale.effectiveDate || "";
  const sub = sale.submissionDate || "";
  const wd = sale.workingDay || workingDay.computeWorkingDay(sub) || String(sub).slice(0, 10);
  if (basis === "workingDay") {
    return (!from || wd >= from) && (!to || wd <= to);
  }
  if (basis === "either") {
    const inEff = (!from || eff >= from) && (!to || eff <= to);
    const inSub = (!from || sub >= from) && (!to || sub <= to);
    const inWd = (!from || wd >= from) && (!to || wd <= to);
    return inEff || inSub || inWd;
  }
  const date = basis === "effective" ? eff || sub : basis === "workingDay" ? wd : sub || eff || wd;
  if (!date) return false;
  return (!from || date >= from) && (!to || date <= to);
}

function filterSales(list, filters = {}) {
  let rows = list;
  if (filters.from || filters.to) {
    rows = rows.filter((s) =>
      saleInDateRange(s, filters.from, filters.to, { dateBasis: filters.dateBasis || "submission" })
    );
  }
  if (filters.agentId) rows = rows.filter((s) => s.agentId === filters.agentId);
  if (filters.closerId) rows = rows.filter((s) => s.closerId === filters.closerId);
  if (filters.team) rows = rows.filter((s) => s.team === filters.team);
  if (filters.unit) rows = rows.filter((s) => s.unit === filters.unit);
  if (filters.status) rows = rows.filter((s) => s.status === filters.status);
  return rows;
}

async function getSale(id) {
  requireSupabase();
  const { data, error } = await db().from("sales").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapSale(data) : null;
}

async function lookupInternalIds(agentId, closerId) {
  const ids = [agentId, closerId].filter(Boolean);
  if (!ids.length) return { agentInternalId: null, closerInternalId: null };
  const { data } = await db().from("employees").select("id, internal_id").in("id", ids);
  const map = new Map((data || []).map((e) => [e.id, e.internal_id]));
  return {
    agentInternalId: agentId ? map.get(agentId) || null : null,
    closerInternalId: closerId ? map.get(closerId) || null : null,
  };
}

async function createSale(payload, actor) {
  requireSupabase();
  const { agentInternalId, closerInternalId } = await lookupInternalIds(payload.agentId, payload.closerId);
  const dates = workingDay.enrichSaleDates(payload, payload.submissionDate);
  const row = {
    phone_number: payload.phoneNumber,
    full_name: payload.fullName,
    device: payload.device,
    price: payload.price != null ? Number(payload.price) : null,
    client: payload.client || "",
    agent_id: payload.agentId,
    closer_id: payload.closerId || null,
    agent_internal_id: agentInternalId,
    closer_internal_id: closerInternalId,
    submitted_by: actor,
    status: payload.status || "pending",
    submission_date: dates.submissionDate,
    submission_time: dates.submissionTime,
    working_day: dates.workingDay,
    effective_date: dates.effectiveDate,
    feedback: payload.feedback || "",
    callback_visible_to_agent: payload.callbackVisibleToAgent === true,
    team: payload.team || "",
    unit: payload.unit || "",
    form_data: payload.formData || {},
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db().from("sales").insert(row).select().single();
  if (error) throw new Error(error.message);
  return mapSale(data);
}

async function updateSale(id, patch, actor) {
  requireSupabase();
  const row = { updated_at: new Date().toISOString() };
  const map = {
    status: "status",
    feedback: "feedback",
    callbackVisibleToAgent: "callback_visible_to_agent",
    effectiveDate: "effective_date",
    reviewedBy: "reviewed_by",
    phoneNumber: "phone_number",
    fullName: "full_name",
    device: "device",
    price: "price",
    client: "client",
    closerId: "closer_id",
    agentId: "agent_id",
    submissionDate: "submission_date",
    submissionTime: "submission_time",
    workingDay: "working_day",
    team: "team",
    unit: "unit",
    formData: "form_data",
  };
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] !== undefined) {
      row[col] = patch[k];
    }
  }
  if (patch.formData !== undefined) {
    row.form_data = patch.formData;
  }
  if (patch.reviewedBy || patch.status) {
    row.reviewed_at = new Date().toISOString();
    row.reviewed_by = actor;
  }
  if (patch.agentId !== undefined || patch.closerId !== undefined) {
    const existing = await getSale(id);
    const agentId = patch.agentId !== undefined ? patch.agentId : existing?.agentId;
    const closerId = patch.closerId !== undefined ? patch.closerId : existing?.closerId;
    const { agentInternalId, closerInternalId } = await lookupInternalIds(agentId, closerId);
    if (patch.agentId !== undefined) row.agent_internal_id = agentInternalId;
    if (patch.closerId !== undefined) row.closer_internal_id = closerInternalId;
  }
  const { data, error } = await db().from("sales").update(row).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return mapSale(data);
}

// --- Sales visibility grants ---

function mapGrant(r) {
  return {
    id: r.id,
    granterUsername: r.granter_username,
    granteeUsername: r.grantee_username,
    scopeType: r.scope_type,
    scopeValue: r.scope_value || "",
    createdAt: r.created_at,
    expiresAt: r.expires_at || null,
  };
}

async function readSalesVisibilityGrants(granteeUsername) {
  requireSupabase();
  let q = db().from("sales_visibility_grants").select("*").order("created_at", { ascending: false });
  if (granteeUsername) q = q.eq("grantee_username", String(granteeUsername).toLowerCase());
  const { data, error } = await q;
  if (error) {
    if (isMissingTableError(error)) return [];
    throw new Error(`readSalesVisibilityGrants: ${error.message}`);
  }
  return (data || []).map(mapGrant);
}

async function createSalesVisibilityGrant(payload, granter) {
  requireSupabase();
  const row = {
    granter_username: String(granter).toLowerCase(),
    grantee_username: String(payload.granteeUsername).toLowerCase(),
    scope_type: payload.scopeType,
    scope_value: payload.scopeValue || "",
  };
  if (payload.expiresAt) row.expires_at = payload.expiresAt;
  else if (payload.temporaryHours) {
    const exp = new Date();
    exp.setHours(exp.getHours() + Number(payload.temporaryHours));
    row.expires_at = exp.toISOString();
  }
  const { data, error } = await db().from("sales_visibility_grants").upsert(row, {
    onConflict: "granter_username,grantee_username,scope_type,scope_value",
  }).select().single();
  if (error) throw new Error(error.message);
  return mapGrant(data);
}

async function deleteSalesVisibilityGrant(id) {
  requireSupabase();
  const { error } = await db().from("sales_visibility_grants").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

// --- Expenses ---

const EXPENSE_STATUSES = ["paid", "pending", "on_hold", "pending_approval", "denied", "archived"];
const EXPENSE_PRIORITIES = ["normal", "important", "emergency"];
const PAYMENT_METHODS = ["instapay", "cash", "wallet", "petty_cash", "own_pocket"];
const BILL_TYPES = ["landline", "internet", "cellphone", "electricity", "water", "maintenance", "other"];

function mapExpense(r) {
  return {
    id: r.id,
    vendorName: r.vendor_name,
    description: r.description || "",
    amount: Number(r.amount),
    status: r.status,
    priority: r.priority || "normal",
    starred: r.starred === true,
    dueDate: r.due_date || null,
    paymentMethod: r.payment_method || "",
    paidBy: r.paid_by || "",
    pettyCashFundId: r.petty_cash_fund_id || null,
    settlementStatus: r.settlement_status || null,
    settlementMethod: r.settlement_method || "",
    receiptFileId: r.receipt_file_id || "",
    cashReceiptNumber: r.cash_receipt_number || "",
    requiresExecutiveApproval: r.requires_executive_approval === true,
    submittedBy: r.submitted_by,
    approvedBy: r.approved_by || "",
    archivedBy: r.archived_by || "",
    archivedAt: r.archived_at || null,
    paidAt: r.paid_at || null,
    denyReason: r.deny_reason || "",
    createdAt: r.created_at,
  };
}

async function readExpenseRequests(filters = {}, opts = {}) {
  requireSupabase();
  if (!opts.skipCache && cache.isCacheWarm()) {
    const cached = cache.getBusinessCache("expenses");
    if (cached) return filterExpenseRequests(cached, filters);
  }
  let q = db().from("expense_requests").select("*").order("created_at", { ascending: false });
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.submittedBy) q = q.eq("submitted_by", filters.submittedBy);
  if (filters.excludeArchived) q = q.neq("status", "archived");
  if (filters.starred) q = q.eq("starred", true);
  const { data, error } = await q;
  if (error) {
    if (isMissingTableError(error)) return [];
    throw new Error(`readExpenseRequests: ${error.message}`);
  }
  return (data || []).map(mapExpense);
}

function filterExpenseRequests(list, filters = {}) {
  let rows = list;
  if (filters.status) rows = rows.filter((r) => r.status === filters.status);
  if (filters.submittedBy) {
    rows = rows.filter(
      (r) => String(r.submittedBy).toLowerCase() === String(filters.submittedBy).toLowerCase()
    );
  }
  if (filters.excludeArchived) rows = rows.filter((r) => r.status !== "archived");
  if (filters.starred) rows = rows.filter((r) => r.starred === true);
  return rows;
}

async function getExpenseRequest(id) {
  requireSupabase();
  const { data, error } = await db().from("expense_requests").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapExpense(data) : null;
}

async function createExpenseRequest(payload, actor) {
  requireSupabase();
  const needsExec = ["hr", "rtm"].includes(String(payload.submitterRole || "").toLowerCase());
  const defaultStatus = needsExec ? "pending_approval" : payload.status || "pending";
  const row = {
    vendor_name: payload.vendorName,
    description: payload.description || "",
    amount: Number(payload.amount),
    status: defaultStatus,
    priority: payload.priority || "normal",
    starred: payload.starred === true,
    due_date: payload.dueDate || null,
    payment_method: payload.paymentMethod || null,
    requires_executive_approval: needsExec,
    submitted_by: actor,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db().from("expense_requests").insert(row).select().single();
  if (error) throw new Error(error.message);
  return mapExpense(data);
}

async function updateExpenseRequest(id, patch, actor) {
  requireSupabase();
  const row = { updated_at: new Date().toISOString() };
  const fields = {
    vendorName: "vendor_name",
    description: "description",
    amount: "amount",
    status: "status",
    priority: "priority",
    starred: "starred",
    dueDate: "due_date",
    paymentMethod: "payment_method",
    paidBy: "paid_by",
    pettyCashFundId: "petty_cash_fund_id",
    settlementStatus: "settlement_status",
    settlementMethod: "settlement_method",
    receiptFileId: "receipt_file_id",
    cashReceiptNumber: "cash_receipt_number",
    approvedBy: "approved_by",
    archivedBy: "archived_by",
    archivedAt: "archived_at",
    paidAt: "paid_at",
    denyReason: "deny_reason",
  };
  for (const [k, col] of Object.entries(fields)) {
    if (patch[k] !== undefined) row[col] = patch[k];
  }
  if (patch.status === "archived" && !row.archived_by) {
    row.archived_by = actor;
    row.archived_at = new Date().toISOString();
  }
  if (patch.status === "paid" && !row.paid_at) {
    row.paid_at = new Date().toISOString();
    row.paid_by = patch.paidBy || actor;
  }
  const { data, error } = await db().from("expense_requests").update(row).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return mapExpense(data);
}

async function deleteExpenseRequest(id) {
  requireSupabase();
  const { error } = await db().from("expense_requests").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

// --- Petty cash ---

async function getPettyCashFunds() {
  requireSupabase();
  const { data, error } = await db().from("petty_cash_funds").select("*").order("fund_name");
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({
    id: r.id,
    fundName: r.fund_name,
    balance: Number(r.balance),
    updatedAt: r.updated_at,
  }));
}

async function getPettyCashLedger(fundId, limit = 100) {
  requireSupabase();
  let q = db().from("petty_cash_ledger").select("*").order("created_at", { ascending: false }).limit(limit);
  if (fundId) q = q.eq("fund_id", fundId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({
    id: r.id,
    fundId: r.fund_id,
    transactionType: r.transaction_type,
    amount: Number(r.amount),
    balanceAfter: Number(r.balance_after),
    linkedExpenseId: r.linked_expense_id || null,
    notes: r.notes || "",
    createdBy: r.created_by,
    createdAt: r.created_at,
  }));
}

async function addPettyCashTransaction({ fundId, transactionType, amount, notes, linkedExpenseId }, actor) {
  requireSupabase();
  const { data: fund, error: fundErr } = await db().from("petty_cash_funds").select("*").eq("id", fundId).single();
  if (fundErr) throw new Error(fundErr.message);
  let balance = Number(fund.balance);
  const amt = Number(amount);
  if (transactionType === "deposit" || transactionType === "adjustment") balance += amt;
  else if (transactionType === "withdrawal") {
    if (balance < amt) {
      throw new Error(
        `Insufficient petty cash balance (${balance.toFixed(2)} EGP available, ${amt.toFixed(2)} EGP needed)`
      );
    }
    balance -= amt;
  } else throw new Error("Invalid transaction type");

  const ledgerRow = {
    fund_id: fundId,
    transaction_type: transactionType,
    amount: amt,
    balance_after: balance,
    linked_expense_id: linkedExpenseId || null,
    notes: notes || "",
    created_by: actor,
  };
  const { error: ledErr } = await db().from("petty_cash_ledger").insert(ledgerRow);
  if (ledErr) throw new Error(ledErr.message);
  const { error: updErr } = await db()
    .from("petty_cash_funds")
    .update({ balance, updated_at: new Date().toISOString() })
    .eq("id", fundId);
  if (updErr) throw new Error(updErr.message);
  return { balance };
}

async function recalculatePettyCashFundBalances(fundId) {
  requireSupabase();
  const { data: rows, error } = await db()
    .from("petty_cash_ledger")
    .select("*")
    .eq("fund_id", fundId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  let balance = 0;
  for (const row of rows || []) {
    const amt = Number(row.amount);
    if (row.transaction_type === "deposit" || row.transaction_type === "adjustment") {
      balance += amt;
    } else if (row.transaction_type === "withdrawal") {
      balance -= amt;
    }
    const { error: rowErr } = await db()
      .from("petty_cash_ledger")
      .update({ balance_after: balance })
      .eq("id", row.id);
    if (rowErr) throw new Error(rowErr.message);
  }

  const { error: fundErr } = await db()
    .from("petty_cash_funds")
    .update({ balance, updated_at: new Date().toISOString() })
    .eq("id", fundId);
  if (fundErr) throw new Error(fundErr.message);
  return { balance };
}

/** When a petty-cash-paid expense amount changes, update the linked ledger withdrawal and rebalance. */
async function reconcilePettyCashExpenseAmount({ expenseId, oldAmount, newAmount, vendorName }) {
  requireSupabase();
  const oldAmt = Number(oldAmount);
  const newAmt = Number(newAmount);
  if (!expenseId || oldAmt === newAmt) return null;

  const rows = await getPettyCashWithdrawalsForExpense(expenseId);
  if (!rows.length) return null;

  const primary = rows[0];
  if (rows.length > 1) {
    for (const row of rows.slice(1)) {
      const { error } = await db().from("petty_cash_ledger").delete().eq("id", row.id);
      if (error) throw new Error(error.message);
    }
  }

  const { error: updErr } = await db()
    .from("petty_cash_ledger")
    .update({
      amount: newAmt,
      notes: `Paid expense ${vendorName || expenseId}`,
    })
    .eq("id", primary.id);
  if (updErr) throw new Error(updErr.message);

  return recalculatePettyCashFundBalances(primary.fund_id);
}

async function getPettyCashLedgerEntry(ledgerId) {
  requireSupabase();
  const { data, error } = await db().from("petty_cash_ledger").select("*").eq("id", ledgerId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    fundId: data.fund_id,
    transactionType: data.transaction_type,
    amount: Number(data.amount),
    balanceAfter: Number(data.balance_after),
    linkedExpenseId: data.linked_expense_id || null,
    notes: data.notes || "",
    createdBy: data.created_by,
    createdAt: data.created_at,
  };
}

/** Edit a posted deposit or adjustment (amount and/or notes), then rebalance the fund. */
async function updatePettyCashLedgerEntry(ledgerId, { amount, notes }, actor) {
  requireSupabase();
  const row = await getPettyCashLedgerEntry(ledgerId);
  if (!row) throw new Error("Ledger entry not found");
  if (!["deposit", "adjustment"].includes(row.transactionType)) {
    throw new Error("Only deposits and adjustments can be edited");
  }

  const patch = {};
  if (amount != null) {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error("Amount must be greater than zero");
    patch.amount = amt;
  }
  if (notes != null) patch.notes = String(notes);

  if (!Object.keys(patch).length) return recalculatePettyCashFundBalances(row.fundId);

  const { error: updErr } = await db().from("petty_cash_ledger").update(patch).eq("id", ledgerId);
  if (updErr) throw new Error(updErr.message);

  return recalculatePettyCashFundBalances(row.fundId);
}

async function getPettyCashWithdrawalsForExpense(expenseId) {
  requireSupabase();
  const { data, error } = await db()
    .from("petty_cash_ledger")
    .select("*")
    .eq("linked_expense_id", expenseId)
    .eq("transaction_type", "withdrawal")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

async function reversePettyCashForExpense(expenseId) {
  requireSupabase();
  const rows = await getPettyCashWithdrawalsForExpense(expenseId);
  if (!rows.length) return null;
  const fundIds = new Set();
  for (const row of rows) {
    const { error } = await db().from("petty_cash_ledger").delete().eq("id", row.id);
    if (error) throw new Error(error.message);
    fundIds.add(row.fund_id);
  }
  for (const fundId of fundIds) {
    await recalculatePettyCashFundBalances(fundId);
  }
  return { reversed: rows.length };
}

function expenseUsesPettyCash(exp) {
  return exp && exp.status === "paid" && exp.paymentMethod === "petty_cash";
}

/** Idempotent petty-cash ledger sync when expense payment method or amount changes. */
async function syncPettyCashForExpense({ prior, expense, patch, actor }) {
  requireSupabase();
  if (!expense?.id) return null;

  const wasPetty = expenseUsesPettyCash(prior);
  const isPetty = expenseUsesPettyCash(expense);

  if (wasPetty && !isPetty) {
    return reversePettyCashForExpense(expense.id);
  }

  if (!isPetty) return null;

  const fundId = patch?.pettyCashFundId || expense.pettyCashFundId;
  if (!fundId) return null;

  const existing = await getPettyCashWithdrawalsForExpense(expense.id);
  if (existing.length) {
    const primary = existing[0];
    if (existing.length > 1) {
      for (const row of existing.slice(1)) {
        await db().from("petty_cash_ledger").delete().eq("id", row.id);
      }
      existing.length = 1;
      await recalculatePettyCashFundBalances(primary.fund_id);
    }
    if (Number(primary.amount) !== Number(expense.amount) || primary.fund_id !== fundId) {
      if (primary.fund_id !== fundId) {
        await reversePettyCashForExpense(expense.id);
        return addPettyCashTransaction(
          {
            fundId,
            transactionType: "withdrawal",
            amount: expense.amount,
            linkedExpenseId: expense.id,
            notes: `Paid expense ${expense.vendorName}`,
          },
          actor
        );
      }
      return reconcilePettyCashExpenseAmount({
        expenseId: expense.id,
        oldAmount: primary.amount,
        newAmount: expense.amount,
        vendorName: expense.vendorName,
      });
    }
    return null;
  }

  return addPettyCashTransaction(
    {
      fundId,
      transactionType: "withdrawal",
      amount: expense.amount,
      linkedExpenseId: expense.id,
      notes: `Paid expense ${expense.vendorName}`,
    },
    actor
  );
}

// --- Monthly bills ---

function mapBill(r) {
  return {
    id: r.id,
    billType: r.bill_type,
    vendor: r.vendor,
    amount: r.amount != null ? Number(r.amount) : null,
    dueDayOfMonth: r.due_day_of_month,
    status: r.status,
    starred: r.starred === true,
    notes: r.notes || "",
    lastPaidAt: r.last_paid_at || null,
    createdBy: r.created_by || "",
    createdAt: r.created_at,
  };
}

async function readMonthlyBills(opts = {}) {
  requireSupabase();
  if (!opts.skipCache && cache.isCacheWarm()) {
    const cached = cache.getBusinessCache("monthly_bills");
    if (cached) return cached;
  }
  const { data, error } = await db().from("monthly_bills").select("*").order("starred", { ascending: false });
  if (error) {
    if (isMissingTableError(error)) return [];
    throw new Error(error.message);
  }
  return (data || []).map(mapBill);
}

async function upsertMonthlyBill(payload, actor) {
  requireSupabase();
  const row = {
    bill_type: payload.billType,
    vendor: payload.vendor,
    amount: payload.amount != null ? Number(payload.amount) : null,
    due_day_of_month: payload.dueDayOfMonth,
    status: payload.status || "pending",
    starred: payload.starred === true,
    notes: payload.notes || "",
    last_paid_at: payload.lastPaidAt || null,
    created_by: actor,
    updated_at: new Date().toISOString(),
  };
  if (payload.id) {
    const { data, error } = await db().from("monthly_bills").update(row).eq("id", payload.id).select().single();
    if (error) throw new Error(error.message);
    return mapBill(data);
  }
  const { data, error } = await db().from("monthly_bills").insert(row).select().single();
  if (error) throw new Error(error.message);
  return mapBill(data);
}

async function deleteMonthlyBill(id) {
  requireSupabase();
  const { error } = await db().from("monthly_bills").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

// --- Sync helpers for cache ---

async function refreshBusinessCache() {
  requireSupabase();
  const [expenses, bills] = await Promise.all([
    readExpenseRequests({}, { skipCache: true }),
    readMonthlyBills({ skipCache: true }),
  ]);
  if (cache.isCacheWarm()) {
    cache.setBusinessCache("expenses", expenses);
    cache.setBusinessCache("monthly_bills", bills);
  }
  return { expenses: expenses.length, bills: bills.length };
}

async function readAllBonusRequests() {
  return readBonusRequests({});
}

async function readAllSales() {
  return readSales({});
}

async function readSalesFieldPermissions() {
  requireSupabase();
  const { data, error } = await db().from("sales_field_permissions").select("*").order("display_order");
  if (error) {
    if (isMissingTableError(error)) return [];
    throw new Error(error.message);
  }
  return (data || []).map((r) => ({
    fieldKey: r.field_key,
    label: r.label,
    section: r.section,
    sensitive: r.sensitive === true,
    viewRoles: r.view_roles || [],
    editRoles: r.edit_roles || [],
    mainViewRoles: r.main_view_roles || r.view_roles || [],
    qualityViewRoles: r.quality_view_roles || [],
    displayOrder: r.display_order || 0,
  }));
}

async function upsertSalesFieldPermission(fieldKey, patch) {
  requireSupabase();
  const row = {
    field_key: fieldKey,
    label: patch.label || fieldKey,
    section: patch.section || "general",
    sensitive: patch.sensitive === true,
    view_roles: patch.viewRoles || [],
    edit_roles: patch.editRoles || [],
    main_view_roles: patch.mainViewRoles || patch.viewRoles || [],
    quality_view_roles: patch.qualityViewRoles || [],
    display_order: patch.displayOrder || 0,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db()
    .from("sales_field_permissions")
    .upsert(row, { onConflict: "field_key" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

function mapSaleAttachment(r) {
  return {
    id: r.id,
    saleId: r.sale_id,
    kind: r.kind,
    fileName: r.file_name,
    dropboxPath: r.dropbox_path,
    dropboxLink: r.dropbox_link || "",
    uploadedBy: r.uploaded_by,
    createdAt: r.created_at,
  };
}

async function readSaleAttachments(saleId) {
  requireSupabase();
  const { data, error } = await db().from("sales_attachments").select("*").eq("sale_id", saleId).order("created_at");
  if (error) {
    if (isMissingTableError(error)) return [];
    throw new Error(error.message);
  }
  return (data || []).map(mapSaleAttachment);
}

async function createSaleAttachment({ saleId, kind, fileName, dropboxPath, dropboxLink }, actor) {
  requireSupabase();
  const { data, error } = await db()
    .from("sales_attachments")
    .insert({
      sale_id: saleId,
      kind,
      file_name: fileName,
      dropbox_path: dropboxPath,
      dropbox_link: dropboxLink || null,
      uploaded_by: actor,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mapSaleAttachment(data);
}

async function getSaleAttachment(id) {
  requireSupabase();
  const { data, error } = await db().from("sales_attachments").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapSaleAttachment(data) : null;
}

async function deleteSaleAttachment(id) {
  requireSupabase();
  const { data, error } = await db().from("sales_attachments").delete().eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return data ? mapSaleAttachment(data) : null;
}

async function replaceSaleAttachment(id, { fileName, dropboxPath, dropboxLink }, actor) {
  requireSupabase();
  const { data, error } = await db()
    .from("sales_attachments")
    .update({
      file_name: fileName,
      dropbox_path: dropboxPath,
      dropbox_link: dropboxLink || null,
      uploaded_by: actor,
    })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mapSaleAttachment(data);
}

async function updateSaleAttachmentDropboxLink(id, dropboxLink) {
  requireSupabase();
  const { data, error } = await db()
    .from("sales_attachments")
    .update({ dropbox_link: dropboxLink })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data ? mapSaleAttachment(data) : null;
}

async function updateSaleAttachmentStorage(id, { storagePath, shareLink, fileName }) {
  requireSupabase();
  const patch = {};
  if (storagePath) patch.dropbox_path = storagePath;
  if (shareLink !== undefined) patch.dropbox_link = shareLink;
  if (fileName) patch.file_name = fileName;
  const { data, error } = await db().from("sales_attachments").update(patch).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return data ? mapSaleAttachment(data) : null;
}

module.exports = {
  SALE_DEVICES,
  SALE_STATUSES,
  EXPENSE_STATUSES,
  EXPENSE_PRIORITIES,
  PAYMENT_METHODS,
  BILL_TYPES,
  readBonusRequests,
  createBonusRequest,
  updateBonusRequest,
  getBonusRequest,
  readSales,
  getSale,
  createSale,
  updateSale,
  readSalesFieldPermissions,
  upsertSalesFieldPermission,
  readSaleAttachments,
  getSaleAttachment,
  createSaleAttachment,
  deleteSaleAttachment,
  replaceSaleAttachment,
  updateSaleAttachmentDropboxLink,
  updateSaleAttachmentStorage,
  readSalesVisibilityGrants,
  createSalesVisibilityGrant,
  deleteSalesVisibilityGrant,
  readExpenseRequests,
  getExpenseRequest,
  createExpenseRequest,
  updateExpenseRequest,
  deleteExpenseRequest,
  getPettyCashFunds,
  getPettyCashLedger,
  getPettyCashLedgerEntry,
  addPettyCashTransaction,
  updatePettyCashLedgerEntry,
  reconcilePettyCashExpenseAmount,
  recalculatePettyCashFundBalances,
  getPettyCashWithdrawalsForExpense,
  reversePettyCashForExpense,
  syncPettyCashForExpense,
  readMonthlyBills,
  upsertMonthlyBill,
  deleteMonthlyBill,
  refreshBusinessCache,
  readAllBonusRequests,
  readAllSales,
};

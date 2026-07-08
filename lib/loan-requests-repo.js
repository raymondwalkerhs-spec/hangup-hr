/**
 * Loan approval requests (HR-02) — visible to mark/phoebe/raymond only.
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");

function db() {
  return getSupabaseAdmin();
}

function requireSupabase() {
  if (!useSupabase()) throw new Error("Feature requires DATA_BACKEND=supabase");
}

function mapLoanRequest(r) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    totalAmount: Number(r.total_amount),
    installmentAmount: Number(r.installment_amount || 0),
    installmentsCount: Number(r.installments_count || 0),
    skipCurrentMonth: r.skip_current_month === true,
    notes: r.notes || "",
    unit: r.unit || "",
    status: r.status,
    submittedBy: r.submitted_by,
    reviewedBy: r.reviewed_by || "",
    reviewedAt: r.reviewed_at || null,
    denyReason: r.deny_reason || "",
    createdLoanId: r.created_loan_id || null,
    createdYearMonth: r.created_year_month || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function readLoanRequests(filters = {}) {
  requireSupabase();
  let q = db().from("loan_requests").select("*").order("created_at", { ascending: false });
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.employeeId) q = q.eq("employee_id", filters.employeeId);
  if (filters.unit) q = q.eq("unit", filters.unit);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map(mapLoanRequest);
}

async function getLoanRequest(id) {
  requireSupabase();
  const { data, error } = await db().from("loan_requests").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapLoanRequest(data) : null;
}

async function createLoanRequest(payload, actor) {
  requireSupabase();
  const row = {
    employee_id: payload.employeeId,
    total_amount: Number(payload.totalAmount),
    installment_amount: Number(payload.installmentAmount || 0),
    installments_count: parseInt(payload.installmentsCount, 10) || 0,
    skip_current_month: payload.skipCurrentMonth === true,
    notes: payload.notes || "",
    status: "pending",
    submitted_by: actor,
    created_year_month: payload.createdYearMonth || new Date().toISOString().slice(0, 7),
    unit: payload.unit || null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db().from("loan_requests").insert(row).select().single();
  if (error) throw new Error(error.message);
  return mapLoanRequest(data);
}

async function updateLoanRequest(id, patch) {
  requireSupabase();
  const row = { updated_at: new Date().toISOString() };
  const fields = {
    status: "status",
    reviewedBy: "reviewed_by",
    reviewedAt: "reviewed_at",
    denyReason: "deny_reason",
    createdLoanId: "created_loan_id",
  };
  for (const [k, col] of Object.entries(fields)) {
    if (patch[k] !== undefined) row[col] = patch[k];
  }
  const { data, error } = await db().from("loan_requests").update(row).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return mapLoanRequest(data);
}

module.exports = {
  readLoanRequests,
  getLoanRequest,
  createLoanRequest,
  updateLoanRequest,
};

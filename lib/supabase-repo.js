/**
 * Supabase data layer — mirrors lib/sheets.js API for data-store.js.
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { mapEmployeeRow, EMPLOYEE_STATUSES } = require("./sheets");
const { isPayrollEligible } = require("./attendance");
const { buildDefaultProfile } = require("./month-profile");
const { nextSplitId } = require("./payroll-splits");
const m = require("./supabase/mappers");

const PROJECT_REF = (process.env.SUPABASE_URL || "").match(/https:\/\/([^.]+)/)?.[1] || "supabase";
const SHEET_ID = PROJECT_REF;

function db() {
  return getSupabaseAdmin();
}

function throwDb(error, context) {
  throw new Error(`${context}: ${error.message}`);
}

async function readEmployees() {
  const { data, error } = await db().from("employees").select("*").order("id");
  if (error) throwDb(error, "readEmployees");
  return (data || []).map(m.mapEmployeeFromDb);
}

async function getEmployeeById(id) {
  const { data, error } = await db().from("employees").select("*").eq("id", id).maybeSingle();
  if (error) throwDb(error, "getEmployeeById");
  return data ? m.mapEmployeeFromDb(data) : null;
}

async function createEmployee(emp, updatedBy = "system") {
  const mapped = mapEmployeeRow(emp);
  if (!mapped.id) throw new Error("Employee ID is required");
  const existing = await getEmployeeById(mapped.id);
  if (existing) throw new Error(`Employee ID ${mapped.id} already exists`);
  const { error } = await db().from("employees").insert(m.employeeToDb(mapped));
  if (error) throwDb(error, "createEmployee");
  return mapped;
}

async function updateEmployee(id, updates, updatedBy = "system") {
  const current = await getEmployeeById(id);
  if (!current) throw new Error("Employee not found");
  const merged = { ...current, ...updates, id };
  const { error } = await db().from("employees").update(m.employeeToDb(merged)).eq("id", id);
  if (error) throwDb(error, "updateEmployee");
  return merged;
}

async function deleteEmployee(id) {
  const { error } = await db().from("employees").delete().eq("id", id);
  if (error) throwDb(error, "deleteEmployee");
  return { ok: true };
}

async function readConfig() {
  const { data, error } = await db().from("app_config").select("key, value");
  if (error) throwDb(error, "readConfig");
  const out = {
    defaultWeekendDays: [6, 0],
    weekendDayNames: ["Saturday", "Sunday"],
    latenessRules: {
      tierA: { label: "Lateness A", beforeHour: 15, amount: 25 },
      tierB: { label: "Lateness B", afterHour: 15, amount: 50 },
    },
    workingDaysByMonth: {},
    hideOutEmployees: true,
    transportAllowanceMonthly: 3000,
  };
  for (const row of data || []) {
    if (!row.key) continue;
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      out[row.key] = row.value;
    }
  }
  return {
    defaultWeekendDays: out.defaultWeekendDays || [6, 0],
    weekendDayNames: out.weekendDayNames || ["Saturday", "Sunday"],
    latenessRules: out.latenessRules,
    workingDaysByMonth: out.workingDaysByMonth || {},
    hideOutEmployees: out.hideOutEmployees !== false,
    transportAllowanceMonthly: Number(out.transportAllowanceMonthly) || 3000,
    taxRules: out.taxRules || { incomeTaxRate: 0, socialInsuranceRate: 0 },
    orgStructure: out.orgStructure || null,
  };
}

async function saveConfigKey(key, value) {
  const val = typeof value === "string" ? value : JSON.stringify(value);
  const { error } = await db().from("app_config").upsert(
    { key, value: val, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error) throwDb(error, "saveConfigKey");
}

async function readPositionRates() {
  const { data, error } = await db().from("position_rates").select("*").order("position");
  if (error) throwDb(error, "readPositionRates");
  return (data || []).map((r) => ({
    position: r.position,
    monthlySalary: Number(r.monthly_salary) || 0,
  }));
}

async function upsertPositionRate(position, monthlySalary) {
  const row = { position, monthly_salary: Number(monthlySalary) || 0, updated_at: new Date().toISOString() };
  const { error } = await db().from("position_rates").upsert(row, { onConflict: "position" });
  if (error) throwDb(error, "upsertPositionRate");
  return { position, monthlySalary: Number(monthlySalary) || 0 };
}

async function deletePositionRate(position) {
  const { error } = await db().from("position_rates").delete().eq("position", position);
  if (error) throwDb(error, "deletePositionRate");
}

async function readAllAttendanceEvents() {
  const { data, error } = await db().from("attendance_events").select("*");
  if (error) throwDb(error, "readAllAttendanceEvents");
  return (data || []).map(m.mapAttendanceFromDb);
}

async function batchUpsertAttendance(records, updatedBy = "system") {
  if (!records?.length) return 0;
  const rows = records.map((r) => m.attendanceToDb(r, updatedBy));
  const { error } = await db().from("attendance_events").upsert(rows, {
    onConflict: "employee_id,date",
  });
  if (error) throwDb(error, "batchUpsertAttendance");
  return records.length;
}

async function readAllBonusEvents() {
  const { data, error } = await db().from("bonus_events").select("*");
  if (error) throwDb(error, "readAllBonusEvents");
  return (data || []).map(m.mapBonusFromDb);
}

async function readAllDeductionEvents() {
  const { data, error } = await db().from("deduction_events").select("*");
  if (error) throwDb(error, "readAllDeductionEvents");
  return (data || []).map(m.mapDeductionFromDb);
}

async function upsertBonusEvent(record, updatedBy = "system") {
  const { error } = await db().from("bonus_events").upsert(m.bonusToDb(record, updatedBy), {
    onConflict: "employee_id,date,type",
  });
  if (error) throwDb(error, "upsertBonusEvent");
}

async function upsertDeductionEvent(record, updatedBy = "system") {
  const { error } = await db().from("deduction_events").upsert(m.deductionToDb(record, updatedBy), {
    onConflict: "employee_id,date,type",
  });
  if (error) throwDb(error, "upsertDeductionEvent");
}

async function deleteBonusEvent(employeeId, date, type) {
  const { error } = await db()
    .from("bonus_events")
    .delete()
    .eq("employee_id", employeeId)
    .eq("date", String(date).slice(0, 10))
    .eq("type", type);
  if (error) throwDb(error, "deleteBonusEvent");
}

async function deleteDeductionEvent(employeeId, date, type) {
  const { error } = await db()
    .from("deduction_events")
    .delete()
    .eq("employee_id", employeeId)
    .eq("date", String(date).slice(0, 10))
    .eq("type", type);
  if (error) throwDb(error, "deleteDeductionEvent");
}

async function readAllPayrollAdjustments() {
  const { data, error } = await db().from("payroll_adjustments").select("*");
  if (error) throwDb(error, "readAllPayrollAdjustments");
  return (data || []).map(m.mapPayrollAdjustmentFromDb);
}

async function upsertPayrollAdjustment(record, updatedBy = "system") {
  const existing = (await readAllPayrollAdjustments()).find(
    (r) => r.employeeId === record.employeeId && r.yearMonth === record.yearMonth
  );
  const merged = {
    employeeId: record.employeeId,
    yearMonth: record.yearMonth,
    extraDays: record.extraDays ?? existing?.extraDays ?? 0,
    twoWeekHold: record.twoWeekHold ?? existing?.twoWeekHold ?? false,
    commissionType: record.commissionType ?? existing?.commissionType ?? "",
    commissionAmount: record.commissionAmount ?? existing?.commissionAmount ?? 0,
    commissionComments: record.commissionComments ?? existing?.commissionComments ?? "",
    position: record.position ?? existing?.position ?? "",
    salaryRaise: record.salaryRaise ?? existing?.salaryRaise ?? 0,
    monthlySalaryOverride:
      record.monthlySalaryOverride !== undefined
        ? record.monthlySalaryOverride
        : existing?.monthlySalaryOverride ?? null,
    paymentMethod: record.paymentMethod ?? existing?.paymentMethod ?? "",
    bankReference: record.bankReference ?? existing?.bankReference ?? "",
    bankName: record.bankName ?? existing?.bankName ?? "",
    payrollStatus: record.payrollStatus ?? existing?.payrollStatus ?? "pending",
    transportEligible: record.transportEligible ?? existing?.transportEligible ?? true,
    monthNotes: record.monthNotes ?? existing?.monthNotes ?? "",
    salesCount: record.salesCount ?? existing?.salesCount ?? 0,
  };
  const { error } = await db()
    .from("payroll_adjustments")
    .upsert(m.payrollAdjustmentToDb(merged, updatedBy), {
      onConflict: "employee_id,year_month",
    });
  if (error) throwDb(error, "upsertPayrollAdjustment");
  return merged;
}

async function bulkSetTransportEligibleForMonth(yearMonth, eligible, updatedBy = "script") {
  const employees = (await readEmployees()).filter(isPayrollEligible);
  const existing = (await readAllPayrollAdjustments()).filter((a) => a.yearMonth === yearMonth);
  const existingIds = new Set(existing.map((a) => a.employeeId));
  let count = 0;

  for (const adj of existing) {
    if (!employees.some((e) => e.id === adj.employeeId)) continue;
    await upsertPayrollAdjustment(
      { ...adj, yearMonth, transportEligible: eligible },
      updatedBy
    );
    count++;
  }

  for (const emp of employees) {
    if (existingIds.has(emp.id)) continue;
    const profile = buildDefaultProfile(emp, yearMonth);
    await upsertPayrollAdjustment(
      { ...profile, transportEligible: eligible },
      updatedBy
    );
    count++;
  }
  return count;
}

async function readCommissionTypes() {
  const { data, error } = await db().from("commission_types").select("*").order("name");
  if (error) throwDb(error, "readCommissionTypes");
  return (data || []).map(m.mapCommissionTypeFromDb);
}

async function upsertCommissionType(type) {
  const row = {
    name: type.name,
    rate_egp: Number(type.rateEgp) || 0,
    description: type.description || "",
    active: type.active !== false,
    updated_at: new Date().toISOString(),
  };
  const { error } = await db().from("commission_types").upsert(row, { onConflict: "name" });
  if (error) throwDb(error, "upsertCommissionType");
  return m.mapCommissionTypeFromDb(row);
}

async function deleteCommissionType(name) {
  const { error } = await db().from("commission_types").delete().eq("name", name);
  if (error) throwDb(error, "deleteCommissionType");
}

async function readAllCommissionTiers() {
  const { data, error } = await db().from("commission_tiers").select("*");
  if (error) throwDb(error, "readAllCommissionTiers");
  return (data || []).map(m.mapCommissionTierFromDb);
}

async function writeCommissionTiersForMonth(yearMonth, tiers) {
  const { error: delErr } = await db().from("commission_tiers").delete().eq("year_month", yearMonth);
  if (delErr) throwDb(delErr, "writeCommissionTiersForMonth(delete)");
  const rows = (tiers || []).map((t) => ({
    year_month: yearMonth,
    min_sales: Number(t.minSales) || 0,
    bonus_amount: Number(t.bonusAmount) || 0,
    label: t.label || `${t.minSales}+ sales`,
  }));
  if (rows.length) {
    const { error } = await db().from("commission_tiers").insert(rows);
    if (error) throwDb(error, "writeCommissionTiersForMonth(insert)");
  }
  return rows.map((r) => ({
    yearMonth: r.year_month,
    minSales: r.min_sales,
    bonusAmount: r.bonus_amount,
    label: r.label,
  }));
}

async function readAllEmployeeLoans() {
  const { data, error } = await db().from("employee_loans").select("*");
  if (error) throwDb(error, "readAllEmployeeLoans");
  return (data || []).map(m.mapLoanFromDb);
}

async function appendEmployeeLoan(loan, createdBy = "system") {
  const { computeStartYearMonth } = require("./loans");
  const createdYearMonth = loan.createdYearMonth || new Date().toISOString().slice(0, 7);
  const skipCurrentMonth = loan.skipCurrentMonth === true;
  const startYearMonth =
    loan.startYearMonth || computeStartYearMonth(createdYearMonth, skipCurrentMonth);
  const row = {
    id: loan.id || `L-${Date.now()}`,
    employee_id: loan.employeeId,
    total_amount: Number(loan.totalAmount) || 0,
    installment_amount: Number(loan.installmentAmount) || 0,
    installments_count: parseInt(loan.installmentsCount, 10) || 1,
    installments_paid: 0,
    start_year_month: startYearMonth,
    skip_current_month: m.boolToDb(skipCurrentMonth),
    created_year_month: createdYearMonth,
    notes: loan.notes || "",
    status: "active",
    created_by: createdBy,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await db().from("employee_loans").insert(row);
  if (error) throwDb(error, "appendEmployeeLoan");
  return m.mapLoanFromDb(row);
}

async function updateEmployeeLoan(loan) {
  if (!loan?.id) throw new Error("Loan id required");
  const row = {
    employee_id: loan.employeeId,
    total_amount: Number(loan.totalAmount) || 0,
    installment_amount: Number(loan.installmentAmount) || 0,
    installments_count: Number(loan.installmentsCount) || 0,
    installments_paid: Number(loan.installmentsPaid) || 0,
    start_year_month: loan.startYearMonth || "",
    skip_current_month: m.boolToDb(loan.skipCurrentMonth),
    created_year_month: loan.createdYearMonth || "",
    notes: loan.notes || "",
    status: loan.status || "active",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db()
    .from("employee_loans")
    .update(row)
    .eq("id", loan.id)
    .select()
    .maybeSingle();
  if (error) throwDb(error, "updateEmployeeLoan");
  if (!data) throw new Error(`Loan ${loan.id} not found`);
  return m.mapLoanFromDb(data);
}

async function deleteEmployeeLoan(id) {
  const { count, error: payErr } = await db()
    .from("loan_payments")
    .select("*", { count: "exact", head: true })
    .eq("loan_id", id);
  if (payErr) throwDb(payErr, "deleteEmployeeLoan(check)");
  if (count > 0) throw new Error("Cannot delete loan with recorded payments");
  const { error } = await db().from("employee_loans").delete().eq("id", id);
  if (error) throwDb(error, "deleteEmployeeLoan");
  return true;
}

async function readAllLoanPayments() {
  const { data, error } = await db().from("loan_payments").select("*");
  if (error) throwDb(error, "readAllLoanPayments");
  return (data || []).map(m.mapLoanPaymentFromDb);
}

async function appendLoanPayment(payment, recordedBy = "system") {
  const row = {
    loan_id: payment.loanId,
    employee_id: payment.employeeId,
    year_month: payment.yearMonth,
    amount: Number(payment.amount) || 0,
    installment_number: payment.installmentNumber ?? null,
    recorded_by: recordedBy,
    recorded_at: new Date().toISOString(),
  };
  const { error } = await db().from("loan_payments").insert(row);
  if (error) throwDb(error, "appendLoanPayment");
  return {
    loanId: row.loan_id,
    employeeId: row.employee_id,
    yearMonth: row.year_month,
    amount: row.amount,
    installmentNumber: row.installment_number,
    recordedBy: row.recorded_by,
    recordedAt: row.recorded_at,
  };
}

async function readAllPayrollSplits() {
  const { data, error } = await db().from("payroll_splits").select("*");
  if (error) throwDb(error, "readAllPayrollSplits");
  return (data || []).map(m.mapSplitFromDb);
}

async function appendPayrollSplit(split, createdBy = "system") {
  const row = {
    id: split.id || nextSplitId(),
    employee_id: split.employeeId,
    year_month: split.yearMonth,
    amount: Number(split.amount) || 0,
    split_kind: split.splitKind || "payment",
    status: split.status || "pending",
    defer_to_month: split.deferToMonth || "",
    notes: split.notes || "",
    created_by: createdBy,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await db().from("payroll_splits").insert(row);
  if (error) throwDb(error, "appendPayrollSplit");
  return m.mapSplitFromDb(row);
}

async function updatePayrollSplit(split, updatedBy = "system") {
  const existing = (await readAllPayrollSplits()).find((s) => s.id === split.id);
  if (!existing) throw new Error(`Split ${split.id} not found`);
  const merged = {
    ...existing,
    ...split,
    id: existing.id,
    employeeId: existing.employeeId,
    yearMonth: existing.yearMonth,
    createdBy: existing.createdBy,
    createdAt: existing.createdAt,
  };
  const { error } = await db()
    .from("payroll_splits")
    .update({
      amount: Number(merged.amount) || 0,
      split_kind: merged.splitKind,
      status: merged.status,
      defer_to_month: merged.deferToMonth || "",
      notes: merged.notes || "",
      updated_at: new Date().toISOString(),
    })
    .eq("id", split.id);
  if (error) throwDb(error, "updatePayrollSplit");
  return merged;
}

async function deletePayrollSplit(id) {
  const { error } = await db().from("payroll_splits").delete().eq("id", id);
  if (error) throwDb(error, "deletePayrollSplit");
  return true;
}

async function readAllEmployeeDocuments() {
  const { data, error } = await db().from("employee_documents").select("*");
  if (error) throwDb(error, "readAllEmployeeDocuments");
  return (data || []).map(m.mapDocumentFromDb);
}

async function appendEmployeeDocument(doc, updatedBy = "system") {
  const now = new Date().toISOString();
  const row = {
    employee_id: doc.employeeId,
    doc_type: doc.docType || "",
    file_name: doc.fileName || "",
    storage_path: doc.storagePath || doc.driveFileId || "",
    public_url: doc.driveLink || doc.publicUrl || "",
    drive_file_id: doc.driveFileId || doc.storagePath || "",
    drive_link: doc.driveLink || "",
    uploaded_at: doc.uploadedAt || now,
    expiry: doc.expiry || "",
    notes: doc.notes || "",
    no_expiry: doc.noExpiry === true,
    updated_by: updatedBy,
  };
  const { error } = await db().from("employee_documents").insert(row);
  if (error) throwDb(error, "appendEmployeeDocument");
  return m.mapDocumentFromDb(row);
}

async function readAllEmployeeWarnings() {
  const { data, error } = await db().from("employee_warnings").select("*");
  if (error) throwDb(error, "readAllEmployeeWarnings");
  return (data || []).map(m.mapWarningFromDb).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

async function appendEmployeeWarning(warning, createdBy = "system") {
  const row = {
    id: warning.id || `W-${Date.now()}`,
    employee_id: warning.employeeId,
    date: String(warning.date || new Date().toISOString().slice(0, 10)).slice(0, 10),
    type: warning.type || "Note",
    title: warning.title || "",
    content: warning.content || "",
    severity: warning.severity || "normal",
    warning_level: warning.warningLevel || warning.warning_level || "",
    created_by: createdBy,
    created_at: new Date().toISOString(),
  };
  const { error } = await db().from("employee_warnings").insert(row);
  if (error) throwDb(error, "appendEmployeeWarning");
  return m.mapWarningFromDb(row);
}

async function verifySheetAccess() {
  const { error } = await db().from("employees").select("id").limit(1);
  if (error) throw new Error(`Supabase: ${error.message}`);
  return { ok: true, backend: "supabase", project: PROJECT_REF };
}

module.exports = {
  SHEET_ID,
  EMPLOYEE_STATUSES,
  mapEmployeeRow,
  readEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  readConfig,
  saveConfigKey,
  readPositionRates,
  upsertPositionRate,
  deletePositionRate,
  readAllAttendanceEvents,
  batchUpsertAttendance,
  readAllBonusEvents,
  readAllDeductionEvents,
  upsertBonusEvent,
  upsertDeductionEvent,
  deleteBonusEvent,
  deleteDeductionEvent,
  readAllPayrollAdjustments,
  upsertPayrollAdjustment,
  bulkSetTransportEligibleForMonth,
  readCommissionTypes,
  upsertCommissionType,
  deleteCommissionType,
  readAllCommissionTiers,
  writeCommissionTiersForMonth,
  readAllEmployeeLoans,
  appendEmployeeLoan,
  updateEmployeeLoan,
  deleteEmployeeLoan,
  readAllLoanPayments,
  appendLoanPayment,
  readAllPayrollSplits,
  appendPayrollSplit,
  updatePayrollSplit,
  deletePayrollSplit,
  readAllEmployeeDocuments,
  appendEmployeeDocument,
  readAllEmployeeWarnings,
  appendEmployeeWarning,
  verifySheetAccess,
};

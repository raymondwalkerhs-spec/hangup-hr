/**
 * Supabase data layer — mirrors lib/sheets.js API for data-store.js.
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { EMPLOYEE_STATUSES, mapEmployeeRow } = require("./entity-mappers");
const { isPayrollEligible } = require("./attendance");
const { buildDefaultProfile } = require("./month-profile");
const { nextSplitId, shiftMonth } = require("./payroll-splits");
const m = require("./supabase/mappers");
const companyContext = require("./company-context");
const { sanitizePostgrestFilterValue } = require("./postgrest-filter");

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
    showLegacyEmployees: out.showLegacyEmployees === true,
    transportAllowanceMonthly: Number(out.transportAllowanceMonthly) || 3000,
    taxRules: out.taxRules || { incomeTaxRate: 0, socialInsuranceRate: 0 },
    taxRulesByCompany: out.taxRulesByCompany || {},
    orgStructure: out.orgStructure || null,
    attendanceFpRulesByMonth: out.attendanceFpRulesByMonth || {},
    attendanceFpRulesByCompany: out.attendanceFpRulesByCompany || {},
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

async function readPositionRates(company) {
  let q = db().from("position_rates").select("*").order("position");
  if (company) q = q.eq("company", company);
  const { data, error } = await q;
  if (error) throwDb(error, "readPositionRates");
  return (data || []).map((r) => ({
    position: r.position,
    monthlySalary: Number(r.monthly_salary) || 0,
    company: r.company || "hangup",
  }));
}

async function upsertPositionRate(position, monthlySalary, company) {
  const row = {
    position,
    monthly_salary: Number(monthlySalary) || 0,
    company: company || "hangup",
    updated_at: new Date().toISOString(),
  };
  const { error } = await db().from("position_rates").upsert(row, { onConflict: "company,position" });
  if (error) throwDb(error, "upsertPositionRate");
  return { position, monthlySalary: Number(monthlySalary) || 0, company: row.company };
}

async function deletePositionRate(position) {
  const { error } = await db().from("position_rates").delete().eq("position", position);
  if (error) throwDb(error, "deletePositionRate");
}

async function readAllPositionRateMonthly() {
  const { data, error } = await db().from("position_rate_monthly").select("*").order("year_month").order("position");
  if (error) {
    if (isMissingTableError(error)) return [];
    throwDb(error, "readAllPositionRateMonthly");
  }
  return (data || []).map((r) => ({
    yearMonth: r.year_month,
    position: r.position,
    monthlySalary: Number(r.monthly_salary) || 0,
    company: r.company || "hangup",
  }));
}

async function readPositionRatesForMonth(yearMonth, company) {
  const ym = String(yearMonth || "").slice(0, 7);
  const { data, error } = await db()
    .from("position_rate_monthly")
    .select("*")
    .eq("year_month", ym)
    .order("position");
  if (error) {
    if (isMissingTableError(error)) return readPositionRates(company);
    throwDb(error, "readPositionRatesForMonth");
  }
  if (!data?.length) return readPositionRates(company);
  return data.map((r) => ({
    position: r.position,
    monthlySalary: Number(r.monthly_salary) || 0,
    company: r.company || "hangup",
  }));
}

async function upsertPositionRateForMonth(yearMonth, position, monthlySalary, company) {
  const ym = String(yearMonth || "").slice(0, 7);
  const row = {
    year_month: ym,
    position,
    monthly_salary: Number(monthlySalary) || 0,
    company: company || "hangup",
    updated_at: new Date().toISOString(),
  };
  const { error } = await db().from("position_rate_monthly").upsert(row, { onConflict: "year_month,position" });
  if (error) throwDb(error, "upsertPositionRateForMonth");
  return { position, monthlySalary: Number(monthlySalary) || 0, yearMonth: ym, company: row.company };
}

async function deletePositionRateForMonth(yearMonth, position, company = "hangup") {
  const ym = String(yearMonth || "").slice(0, 7);
  const co = String(company || "hangup").toLowerCase() === "hs2" ? "hs2" : "hangup";
  let q = db().from("position_rate_monthly").delete().eq("year_month", ym).eq("position", position);
  q = q.eq("company", co);
  const { error } = await q;
  if (error) throwDb(error, "deletePositionRateForMonth");
}

async function copyPositionRatesMonth(fromMonth, toMonth) {
  const from = String(fromMonth || "").slice(0, 7);
  const to = String(toMonth || "").slice(0, 7);
  const { data, error } = await db().from("position_rate_monthly").select("*").eq("year_month", from);
  if (error) {
    if (isMissingTableError(error)) return 0;
    throwDb(error, "copyPositionRatesMonth");
  }
  if (!data?.length) return 0;
  const rows = data.map((r) => ({
    year_month: to,
    position: r.position,
    monthly_salary: r.monthly_salary,
    company: r.company || "hangup",
    updated_at: new Date().toISOString(),
  }));
  const { error: e2 } = await db().from("position_rate_monthly").upsert(rows, { onConflict: "year_month,position" });
  if (e2) throwDb(e2, "copyPositionRatesMonth");
  return rows.length;
}

function isMissingTableError(error) {
  const msg = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "");
  return code === "42P01" || msg.includes("does not exist") || msg.includes("could not find the table");
}

async function readAttendanceEvents(yearMonth) {
  const ym = String(yearMonth || "").slice(0, 7);
  if (!ym) return [];
  const [year, month] = ym.split("-").map(Number);
  const startDate = `${ym}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${ym}-${String(lastDay).padStart(2, "0")}`;

  const all = [];
  let page = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await db()
      .from("attendance_events")
      .select("*")
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date")
      .order("employee_id")
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throwDb(error, "readAttendanceEvents");
    const batch = (data || []).map(m.mapAttendanceFromDb);
    all.push(...batch);
    if (batch.length < pageSize) break;
    page += 1;
  }
  return all;
}

async function readAllAttendanceEvents() {
  const all = [];
  let page = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await db()
      .from("attendance_events")
      .select("*")
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throwDb(error, "readAllAttendanceEvents");
    const batch = (data || []).map(m.mapAttendanceFromDb);
    all.push(...batch);
    if (batch.length < pageSize) break;
    page += 1;
  }
  return all;
}

async function batchUpsertAttendance(records, updatedBy = "system") {
  if (!records?.length) return 0;
  const rows = records.map((r) => m.attendanceToDb(r, updatedBy));
  const { data, error } = await db().from("attendance_events").upsert(rows, {
    onConflict: "employee_id,date",
  }).select("employee_id,date,status,fp_notes,fp_lateness,transport_override,updated_at");
  if (error) throwDb(error, "batchUpsertAttendance");
  // Verify status persisted — catches silent partial upserts / constraint issues.
  for (const want of records) {
    const got = (data || []).find(
      (r) => r.employee_id === want.employeeId && String(r.date).slice(0, 10) === want.date
    );
    const wantStatus = String(want.status || "").trim();
    const gotStatus = String(got?.status || "").trim();
    if (wantStatus && wantStatus !== gotStatus) {
      throw new Error(
        `batchUpsertAttendance: status not persisted for ${want.employeeId} ${want.date} (wanted "${wantStatus}", got "${gotStatus || "(empty)"}")`
      );
    }
  }
  return records.length;
}

async function deleteAttendanceEvent(employeeId, date) {
  const { error } = await db()
    .from("attendance_events")
    .delete()
    .eq("employee_id", employeeId)
    .eq("date", String(date).slice(0, 10));
  if (error) throwDb(error, "deleteAttendanceEvent");
}

async function deleteAttendanceEventsForEmployeeMonth(employeeId, yearMonth) {
  const prefix = yearMonth + "-01";
  const nextPrefix = shiftMonth(yearMonth, 1) + "-01";
  const { error } = await db()
    .from("attendance_events")
    .delete()
    .eq("employee_id", employeeId)
    .gte("date", prefix)
    .lt("date", nextPrefix);
  if (error) throwDb(error, "deleteAttendanceEventsForEmployeeMonth");
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

async function readPayrollAdjustmentsForMonth(yearMonth) {
  const { data, error } = await db()
    .from("payroll_adjustments")
    .select("*")
    .eq("year_month", yearMonth);
  if (error) throwDb(error, "readPayrollAdjustmentsForMonth");
  return (data || []).map(m.mapPayrollAdjustmentFromDb);
}

async function upsertPayrollAdjustment(record, updatedBy = "system") {
  const startTime = Date.now();
  const logPrefix = `[SUPABASE-UPSERT ${record.employeeId} ${record.yearMonth}]`;
  console.log(`${logPrefix} START - salary: ${record.monthlySalaryOverride}, net: ${record.netSalaryOverride}`);
  
  // Fetch only the specific record we need (not all adjustments)
  console.log(`${logPrefix} [${Date.now() - startTime}ms] Reading existing record...`);
  const { data: existingData, error: readError } = await db()
    .from("payroll_adjustments")
    .select("*")
    .eq("employee_id", record.employeeId)
    .eq("year_month", record.yearMonth)
    .maybeSingle();
  
  console.log(`${logPrefix} [${Date.now() - startTime}ms] Read complete - error: ${readError?.message || 'none'}`);
  
  if (readError && !isMissingTableError(readError)) throwDb(readError, "upsertPayrollAdjustment (read)");
  
  const existing = existingData ? m.mapPayrollAdjustmentFromDb(existingData) : null;
  const emp = await getEmployeeById(record.employeeId);
  const { resolvePaymentMethod, normalizePaymentMethodValue } = require("./hr-constants");
  
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
    netSalaryOverride:
      record.netSalaryOverride !== undefined
        ? record.netSalaryOverride
        : existing?.netSalaryOverride ?? null,
    trainingNetSalaryOverride:
      record.trainingNetSalaryOverride !== undefined
        ? record.trainingNetSalaryOverride
        : existing?.trainingNetSalaryOverride ?? null,
    agentNetSalaryOverride:
      record.agentNetSalaryOverride !== undefined
        ? record.agentNetSalaryOverride
        : existing?.agentNetSalaryOverride ?? null,
    trainingPayrollPaid:
      record.trainingPayrollPaid !== undefined
        ? record.trainingPayrollPaid === true
        : existing?.trainingPayrollPaid === true,
    trainingPhase1PayException:
      record.trainingPhase1PayException !== undefined
        ? record.trainingPhase1PayException === true
        : existing?.trainingPhase1PayException === true,
    trainingPayrollAnchorMonthOverride:
      record.trainingPayrollAnchorMonthOverride !== undefined
        ? String(record.trainingPayrollAnchorMonthOverride || "").trim().slice(0, 7)
        : String(existing?.trainingPayrollAnchorMonthOverride || "").trim().slice(0, 7),
    paymentMethod:
      record.paymentMethod !== undefined
        ? normalizePaymentMethodValue(record.paymentMethod) || ""
        : resolvePaymentMethod(emp, existing) || "",
    bankReference: record.bankReference ?? existing?.bankReference ?? "",
    bankName: record.bankName ?? existing?.bankName ?? "",
    payrollStatus: record.payrollStatus ?? existing?.payrollStatus ?? "pending",
    transportEligible: record.transportEligible ?? existing?.transportEligible ?? true,
    monthNotes: record.monthNotes ?? existing?.monthNotes ?? "",
    salesCount: record.salesCount ?? existing?.salesCount ?? 0,
    noPayroll: record.noPayroll ?? existing?.noPayroll ?? false,
    payslipVisibleToAgent: record.payslipVisibleToAgent ?? existing?.payslipVisibleToAgent ?? false,
    fullTransportGrant: record.fullTransportGrant ?? existing?.fullTransportGrant ?? false,
  };
  
  console.log(`${logPrefix} [${Date.now() - startTime}ms] About to write:`, {
    monthlySalaryOverride: merged.monthlySalaryOverride,
    netSalaryOverride: merged.netSalaryOverride,
  });
  
  const { error } = await db()
    .from("payroll_adjustments")
    .upsert(m.payrollAdjustmentToDb(merged, updatedBy), {
      onConflict: "employee_id,year_month",
    });
  
  console.log(`${logPrefix} [${Date.now() - startTime}ms] Write complete - error: ${error?.message || 'none'}`);
  if (error) throwDb(error, "upsertPayrollAdjustment (write)");
  
  console.log(`${logPrefix} [${Date.now() - startTime}ms] END`);
  return merged;
}

async function syncPayrollAdjustmentsPaymentMethod(employeeId, paymentMethod) {
  const { normalizePaymentMethodValue } = require("./hr-constants");
  const normalized = normalizePaymentMethodValue(paymentMethod) || "";
  const { error } = await db()
    .from("payroll_adjustments")
    .update({
      payment_method: normalized || null,
      updated_at: new Date().toISOString(),
    })
    .eq("employee_id", employeeId);
  if (error) throwDb(error, "syncPayrollAdjustmentsPaymentMethod");
  const { data, error: readError } = await db()
    .from("payroll_adjustments")
    .select("*")
    .eq("employee_id", employeeId);
  if (readError) throwDb(readError, "syncPayrollAdjustmentsPaymentMethod (read)");
  return (data || []).map(m.mapPayrollAdjustmentFromDb);
}

async function bulkSetTransportEligibleForMonth(yearMonth, eligible, updatedBy = "script", { employeeIdFilter } = {}) {
  const employees = (await readEmployees()).filter(isPayrollEligible);
  const scopedEmployees = employeeIdFilter
    ? employees.filter((e) => employeeIdFilter.has(e.id))
    : employees;
  
  // Query only for the specific month, not all adjustments
  const { data: monthData, error: monthError } = await db()
    .from("payroll_adjustments")
    .select("*")
    .eq("year_month", yearMonth);
  
  if (monthError && !isMissingTableError(monthError)) throwDb(monthError, "bulkSetTransportEligibleForMonth (read)");
  
  const existing = (monthData || []).map(m.mapPayrollAdjustmentFromDb);
  const existingIds = new Set(existing.map((a) => a.employeeId));
  let count = 0;

  for (const adj of existing) {
    if (!scopedEmployees.some((e) => e.id === adj.employeeId)) continue;
    await upsertPayrollAdjustment(
      { ...adj, yearMonth, transportEligible: eligible },
      updatedBy
    );
    count++;
  }

  for (const emp of scopedEmployees) {
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

async function writeCommissionTiersForMonth(yearMonth, tiers, company = "hangup") {
  const co = String(company || "hangup").trim().toLowerCase() === "hs2" ? "hs2" : "hangup";
  const { error: delErr } = await db()
    .from("commission_tiers")
    .delete()
    .eq("year_month", yearMonth)
    .eq("company", co);
  if (delErr) throwDb(delErr, "writeCommissionTiersForMonth(delete)");
  const rows = (tiers || []).map((t) => ({
    company: co,
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
    company: r.company,
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

async function updateEmployeeWarning(id, patch) {
  const row = {};
  if (patch.date !== undefined) row.date = String(patch.date).slice(0, 10);
  if (patch.type !== undefined) row.type = patch.type;
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.content !== undefined) row.content = patch.content;
  if (patch.severity !== undefined) row.severity = patch.severity;
  if (patch.warningLevel !== undefined) row.warning_level = patch.warningLevel;
  const { data, error } = await db().from("employee_warnings").update(row).eq("id", id).select().single();
  if (error) throwDb(error, "updateEmployeeWarning");
  return m.mapWarningFromDb(data);
}

async function deleteEmployeeWarning(id) {
  const { error } = await db().from("employee_warnings").delete().eq("id", id);
  if (error) throwDb(error, "deleteEmployeeWarning");
  return { ok: true };
}

async function verifySheetAccess() {
  const { error } = await db().from("employees").select("id").limit(1);
  if (error) throw new Error(`Supabase: ${error.message}`);
  return { ok: true, backend: "supabase", project: PROJECT_REF };
}

async function calculatePayrollCoreFromDb(month, employeeId = null, workingDaysInMonth = null) {
  try {
    const params = { p_month: month };
    if (employeeId) params.p_employee_id = employeeId;
    if (workingDaysInMonth != null && Number(workingDaysInMonth) > 0) {
      params.p_working_days_in_month = Number(workingDaysInMonth);
    } else {
      params.p_working_days_in_month = null;
    }

    const { data: result, error: rpcError } = await db().rpc("calculate_payroll_core", params);

    if (rpcError) {
      console.warn("[payroll-db] DB calculation failed, app should fallback:", rpcError.message);
      return null;
    }

    return result || [];
  } catch (err) {
    console.warn("[payroll-db] DB calculation error, app should fallback:", err.message);
    return null;
  }
}

async function checkPayrollCacheInvalidation(employeeId, month) {
  try {
    const { data, error } = await db()
      .from("payroll_cache_invalidation")
      .select("invalidated_at")
      .eq("employee_id", employeeId)
      .eq("year_month", month)
      .maybeSingle();
    
    if (error) return null;
    return data?.invalidated_at || null;
  } catch {
    return null;
  }
}

// ============================================================
// Interview module — Supabase primary source of truth
// ============================================================

function columnLetter(index) {
  let letter = "";
  while (index >= 0) {
    letter = String.fromCharCode(65 + (index % 26)) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}

const INTERVIEW_STATUS_OPTIONS = ["pending", "on hold", "accepted", "rejected"];
const TRAINING_STATUS_OPTIONS = ["waiting", "on hold", "started", "dropped", "postponed", "cancelled"];
const GRADUATION_STATUS_OPTIONS = ["Graduated", "Not Graduated", "In Progress"];

function candidateFromDb(r) {
  return {
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    submittedBy: r.submitted_by,
    firstInterviewStatus: r.first_interview_status || "pending",
    firstInterviewFeedback: r.first_interview_feedback || "",
    interviewDate: r.interview_date || "",
    interviewer: r.interviewer || "",
    trainingStatus: r.training_status || "waiting",
    trainingStartDate: r.training_start_date || "",
    trainer: r.trainer || "",
    batchNumber: r.batch_number || "",
    company: r.company || "hangup",
    secondInterviewDate: r.second_interview_date || "",
    secondInterviewFeedback: r.second_interview_feedback || "",
    secondInterviewStatus: r.second_interview_status || "",
    secondInterviewer: r.second_interviewer || "",
    timestamp: r.timestamp || "",
    name: r.name || "",
    email: r.email || "",
    phone: r.phone || "",
    whatsapp: r.whatsapp || "",
    dateOfBirth: r.date_of_birth || "",
    address: r.address || "",
    graduationStatus: r.graduation_status || "",
    facultyName: r.faculty_name || "",
    universityName: r.university_name || "",
    nationalId: r.national_id || "",
    previousExperiences: r.previous_experiences || "",
    gender: r.gender || "",
    englishSpeaking: r.english_speaking || "",
    englishWriting: r.english_writing || "",
    englishListening: r.english_listening || "",
    fastPacedRating: r.fast_paced_rating || "",
    availableDays: r.available_days || "",
    currentlyEmployed: r.currently_employed || "",
    preferredWorkingMode: r.preferred_working_mode || "",
    howHeard: r.how_heard || "",
    companyIfYes: r.company_if_yes || "",
  };
}

function candidateToDb(row) {
  return {
    submitted_by: row.submittedBy || null,
    first_interview_status: row.firstInterviewStatus || "pending",
    first_interview_feedback: row.firstInterviewFeedback || "",
    interview_date: row.interviewDate || null,
    interviewer: row.interviewer || null,
    training_status: row.trainingStatus || "waiting",
    training_start_date: row.trainingStartDate || null,
    trainer: row.trainer || null,
    batch_number: row.batchNumber || null,
    company: row.company || "hangup",
    second_interview_date: row.secondInterviewDate || null,
    second_interview_feedback: row.secondInterviewFeedback || "",
    second_interview_status: row.secondInterviewStatus || "",
    second_interviewer: row.secondInterviewer || null,
    timestamp: row.timestamp || null,
    name: row.name || null,
    email: row.email || null,
    phone: row.phone || null,
    whatsapp: row.whatsapp || null,
    date_of_birth: row.dateOfBirth || null,
    address: row.address || null,
    graduation_status: row.graduationStatus || null,
    faculty_name: row.facultyName || null,
    university_name: row.universityName || null,
    national_id: row.nationalId || null,
    previous_experiences: row.previousExperiences || null,
    gender: row.gender || null,
    english_speaking: row.englishSpeaking || null,
    english_writing: row.englishWriting || null,
    english_listening: row.englishListening || null,
    fast_paced_rating: row.fastPacedRating || null,
    available_days: row.availableDays || null,
    currently_employed: row.currentlyEmployed || null,
    preferred_working_mode: row.preferredWorkingMode || null,
    how_heard: row.howHeard || null,
    company_if_yes: row.companyIfYes || null,
    updated_at: new Date().toISOString(),
  };
}

async function readCandidateApplications(userRole, opts = {}) {
  let q = db().from("candidate_applications").select("*").order("created_at", { ascending: false });
  const role = String(userRole?.role || "").toLowerCase();
  const isManageRole = ["admin", "ceo", "hr"].includes(role);
  const isTrainerRole = ["op", "tl"].includes(role);
  const isQualityRole = role === "quality";
  const username = String(userRole?.username || "").trim().toLowerCase();
  const companyFilter =
    opts.company != null
      ? companyContext.parseCompanyContext(opts.company)
      : !isManageRole
        ? companyContext.getCompanyForUser(userRole)
        : "hangup";
  if (companyFilter === "hs2") {
    q = q.eq("company", "hs2");
  } else {
    q = q.neq("company", "hs2");
  }
  if (!isManageRole) {
    q = q.not("interviewer", "is", null);
    q = q.not("trainer", "is", null);
  }
  if (isTrainerRole && username) {
    const safeUser = sanitizePostgrestFilterValue(username);
    q = q.or(`trainer.eq.${role},interviewer.eq.${safeUser},second_interviewer.eq.${safeUser}`);
  } else if (isQualityRole && username) {
    const safeUser = sanitizePostgrestFilterValue(username);
    q = q.or(`interviewer.eq.${safeUser},second_interviewer.eq.${safeUser}`);
  }
  const { data, error } = await q;
  if (error) throwDb(error, "readCandidateApplications");
  let results = (data || []).map(candidateFromDb);
  if (!isManageRole) {
    results = results.filter((c) => c.interviewer && c.trainer);
  }
  return results;
}

async function getCandidateApplication(id, userRole) {
  let q = db().from("candidate_applications").select("*").eq("id", id);
  const company = String(userRole?.company || companyContext.getCompanyForUser(userRole) || "hangup").toLowerCase();
  if (company === "hs2" || company === "hs-2") {
    q = q.eq("company", "hs2");
  } else {
    q = q.neq("company", "hs2");
  }
  const { data, error } = await q.maybeSingle();
  if (error) throwDb(error, "getCandidateApplication");
  return data ? candidateFromDb(data) : null;
}

async function computeBatchNumber(trainingStartDate, trainer, company) {
  if (!trainingStartDate) return null;
  const normalizedCompany = String(company || "hangup").toLowerCase();
  let baseQuery = db()
    .from("candidate_applications")
    .select("batch_number, training_start_date")
    .eq("training_status", "started")
    .not("batch_number", "is", null);
  if (normalizedCompany === "hs2" || normalizedCompany === "hs-2") {
    baseQuery = baseQuery.eq("company", "hs2");
  } else {
    baseQuery = baseQuery.neq("company", "hs2");
  }
  const { data: existingForDate, error: dateError } = await baseQuery
    .eq("training_start_date", trainingStartDate)
    .limit(1);
  if (dateError) {
    console.error("[batch] date lookup error:", dateError.message);
    return null;
  }
  const existingBatch = (existingForDate || []).find((r) => r.batch_number)?.batch_number;
  if (existingBatch) return existingBatch;
  const { data: allBatches, error: batchError } = await baseQuery;
  if (batchError) {
    console.error("[batch] list error:", batchError.message);
    return null;
  }
  const distinctDates = [...new Set((allBatches || []).map((r) => r.training_start_date).filter(Boolean))].sort();
  const nextIndex = distinctDates.length + 1;
  return `B${nextIndex}`;
}

async function createCandidateApplication(row, submittedBy) {
  const mapped = candidateToDb({ ...row, submittedBy: submittedBy || null });
  if (mapped.training_start_date && mapped.training_status === "started") {
    mapped.batch_number = await computeBatchNumber(mapped.training_start_date, null, mapped.company);
  }
  const { data, error } = await db().from("candidate_applications").insert(mapped).select().single();
  if (error) throwDb(error, "createCandidateApplication");
  return candidateFromDb(data);
}

async function updateCandidateApplication(id, updates, userRole) {
  const current = await getCandidateApplication(id, userRole);
  if (!current) throw new Error("Candidate application not found");
  const role = String(userRole?.role || "").toLowerCase();
  const username = String(userRole?.username || "").trim().toLowerCase();
  if (role === "quality" && username) {
    const interviewers = [current.interviewer, current.secondInterviewer].map((v) =>
      String(v || "").trim().toLowerCase()
    );
    if (!interviewers.includes(username)) {
      throw new Error("Quality can only update interviews they conducted");
    }
  }
  const merged = { ...current, ...updates };
  if (merged.trainingStartDate && merged.trainingStatus === "started") {
    merged.batchNumber = await computeBatchNumber(merged.trainingStartDate, null, merged.company);
  } else if (merged.trainingStatus !== "started") {
    merged.batchNumber = null;
  }
  const { data, error } = await db().from("candidate_applications").update(candidateToDb(merged)).eq("id", id).select().single();
  if (error) throwDb(error, "updateCandidateApplication");
  return candidateFromDb(data);
}

async function deleteCandidateApplication(id, userRole) {
  const current = await getCandidateApplication(id, userRole);
  if (!current) throw new Error("Candidate application not found");
  const { error } = await db().from("candidate_applications").delete().eq("id", id);
  if (error) throwDb(error, "deleteCandidateApplication");
  return { ok: true };
}

async function createInterviewFeedback(row) {
  const mapped = {
    candidate_id: row.candidateId || null,
    candidate_name: row.candidateName || "",
    candidate_email: row.candidateEmail || "",
    day: Number(row.day) || 1,
    feedback_text: row.feedbackText || "",
    trainer: row.trainer || "",
    date: row.date || null,
    is_test_call_day: row.isTestCallDay || false,
    active_listening_metric: row.activeListeningMetric || null,
    english_metric: row.englishMetric || null,
    accent_metric: row.accentMetric || null,
    product_knowledge_metric: row.productKnowledgeMetric || null,
    company: String(row.company || "hangup").toLowerCase() === "hs2" ? "hs2" : "hangup",
  };
  const { data, error } = await db().from("interview_feedbacks").insert(mapped).select().single();
  if (error) throwDb(error, "createInterviewFeedback");
  return data;
}

async function getInterviewFeedbackById(id, userRole) {
  const role = String(userRole?.role || "").toLowerCase();
  const company = String(userRole?.company || companyContext.getCompanyForUser(userRole) || "hangup").toLowerCase();
  let q = db().from("interview_feedbacks").select("*").eq("id", id);
  if (company === "hs2" || company === "hs-2") {
    q = q.eq("company", "hs2");
  } else {
    q = q.neq("company", "hs2");
  }
  if (["op", "tl"].includes(role)) {
    const trainer = String(userRole?.username || "").trim().toLowerCase();
    if (trainer) q = q.eq("trainer", trainer);
  }
  const { data, error } = await q.maybeSingle();
  if (error) throwDb(error, "getInterviewFeedbackById");
  return data;
}

async function readInterviewFeedbacks(candidateId, userRole) {
  let q = db().from("interview_feedbacks").select("*").order("day").order("created_at");
  const role = String(userRole?.role || "").toLowerCase();
  const company = String(userRole?.company || companyContext.getCompanyForUser(userRole) || "hangup").toLowerCase();
  if (company === "hs2" || company === "hs-2") {
    q = q.eq("company", "hs2");
  } else {
    q = q.neq("company", "hs2");
  }
  if (["op", "tl"].includes(role)) {
    const trainer = String(userRole?.username || "").trim().toLowerCase();
    if (trainer) q = q.eq("trainer", trainer);
  }
  if (candidateId) q = q.eq("candidate_id", candidateId);
  const { data, error } = await q;
  if (error) throwDb(error, "readInterviewFeedbacks");
  return data || [];
}

async function updateInterviewFeedback(id, updates) {
  const { data, error } = await db().from("interview_feedbacks").update(updates).eq("id", id).select().single();
  if (error) throwDb(error, "updateInterviewFeedback");
  return data;
}

async function deleteInterviewFeedback(id) {
  const { error } = await db().from("interview_feedbacks").delete().eq("id", id);
  if (error) throwDb(error, "deleteInterviewFeedback");
  return { ok: true };
}

async function getTrainerOptions(userRole) {
  const company = String(userRole?.company || companyContext.getCompanyForUser(userRole) || "hangup").toLowerCase();
  const { data, error } = await db()
    .from("app_users")
    .select("username, role, employee_id")
    .eq("status", "active")
    .in("role", ["tl", "op"])
    .order("role")
    .order("username");
  if (error) throwDb(error, "getTrainerOptions");
  let filtered = data || [];
  if (company === "hs2" || company === "hs-2") {
    filtered = await filterAppUsersByCompany(filtered, "hs2");
  } else {
    filtered = await filterAppUsersByCompany(filtered, "hangup");
  }
  const priority = { op: 0, tl: 1 };
  const employeeIds = [...new Set(filtered.map((u) => u.employee_id).filter(Boolean))];
  const nameMap = new Map();
  if (employeeIds.length) {
    const { data: employees } = await db()
      .from("employees")
      .select("id, american_name, arabic_name")
      .in("id", employeeIds);
    for (const emp of employees || []) {
      if (emp.id) nameMap.set(emp.id, emp.american_name || emp.arabic_name || "");
    }
  }
  return filtered
    .map((u) => ({
      username: u.username,
      role: u.role,
      employeeId: u.employee_id,
      name: nameMap.get(u.employee_id) || "",
      priority: priority[u.role] ?? 99,
    }))
     .sort((a, b) => a.priority - b.priority || a.username.localeCompare(b.username));
}

async function getInterviewerOptions(userRole) {
  const company = String(userRole?.company || companyContext.getCompanyForUser(userRole) || "hangup").toLowerCase();
  const { data, error } = await db()
    .from("app_users")
    .select("username, role, employee_id")
    .eq("status", "active")
    .in("role", ["admin", "ceo", "hr", "op", "quality"])
    .order("role")
    .order("username");
  if (error) throwDb(error, "getInterviewerOptions");
  let filtered = data || [];
  if (company === "hs2" || company === "hs-2") {
    filtered = await filterAppUsersByCompany(filtered, "hs2");
  } else {
    filtered = await filterAppUsersByCompany(filtered, "hangup");
  }
  const priority = { admin: 0, ceo: 0, hr: 1, op: 2, quality: 3 };
  const employeeIds = [...new Set(filtered.map((u) => u.employee_id).filter(Boolean))];
  const nameMap = new Map();
  if (employeeIds.length) {
    const { data: employees } = await db()
      .from("employees")
      .select("id, american_name, arabic_name")
      .in("id", employeeIds);
    for (const emp of employees || []) {
      if (emp.id) nameMap.set(emp.id, emp.american_name || emp.arabic_name || "");
    }
  }
  return filtered
    .map((u) => ({
      username: u.username,
      role: u.role,
      employeeId: u.employee_id,
      name: nameMap.get(u.employee_id) || "",
      priority: priority[u.role] ?? 99,
    }))
     .sort((a, b) => a.priority - b.priority || a.username.localeCompare(b.username));
}

async function filterAppUsersByCompany(users, company) {
  const employeeIds = [...new Set(users.map((u) => u.employee_id).filter(Boolean))];
  if (!employeeIds.length) return [];
  try {
    const { data: employees, error: empError } = await db()
      .from("employees")
      .select("id, unit")
      .in("id", employeeIds);
    if (empError) {
      console.error("[filterAppUsersByCompany] employees query error:", empError.message);
      return [];
    }
    const employeeCompanyMap = new Map();
    for (const emp of employees || []) {
      if (emp.id) employeeCompanyMap.set(emp.id, companyContext.getCompanyForUnit(emp.unit));
    }
    return users.filter((u) => {
      const empId = u.employee_id;
      if (!empId) return false;
      return employeeCompanyMap.get(empId) === company;
    });
  } catch (err) {
    console.error("[filterAppUsersByCompany] error:", err.message);
    return [];
  }
}

async function syncInterviewsToSheets() {
  try {
    const googleSheets = require("../lib/google-sheets");
    if (!googleSheets.isConfigured()) return { ok: true, skipped: "sheets_not_configured" };
    const spreadsheetId = googleSheets.resolveSpreadsheetId();
    const tab = googleSheets.resolveTab();
    const auth = await googleSheets.getAuth();
    const { google } = require("googleapis");
    const sheets = google.sheets({ version: "v4", auth });
    
    const candidates = await readCandidateApplications({ role: "hr" });
    const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
    const sheet = meta.data.sheets?.[0];
    
    const FORM_COLUMNS = ["Timestamp", "Name", "Email", "Phone", "Whatsapp", "Date of Birth", "Address", "Graduation status", "Faculty Name", "University Name", "National ID or Passport ID", "Previous Experiences", "Gender", "English Speaking", "English Writing", "English Listening", "Fast-paced rating", "Available days", "Currently employed", "Preferred working mode", "How heard", "Company if yes"];
    const HR_COLUMNS = ["1st Int Status", "1st Int Feedback", "1st Interview Date", "1st Interviewer", "2nd Int Status", "2nd Int Feedback", "2nd Interview Date", "2nd Interviewer", "Training Status", "Training Start Date", "Trainer"];
    const SYNC_COLUMNS = ["Sync Status", "Sync Time", "Supabase ID"];
    const headers = [...FORM_COLUMNS, ...HR_COLUMNS, ...SYNC_COLUMNS];
    const dataColumnCount = FORM_COLUMNS.length + HR_COLUMNS.length;
    
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tab}'!A1:${columnLetter(headers.length - 1)}1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
    
    const values = candidates.map((c) => {
      const row = [
        c.timestamp, c.name, c.email, c.phone, c.whatsapp, c.dateOfBirth, c.address,
        c.graduationStatus, c.facultyName, c.universityName, c.nationalId,
        c.previousExperiences, c.gender, c.englishSpeaking, c.englishWriting, c.englishListening,
        c.fastPacedRating, c.availableDays, c.currentlyEmployed, c.preferredWorkingMode,
        c.howHeard, c.companyIfYes,
        c.firstInterviewStatus, c.firstInterviewFeedback, c.interviewDate, c.interviewer,
        c.secondInterviewStatus, c.secondInterviewFeedback, c.secondInterviewDate, c.secondInterviewer,
        c.trainingStatus, c.trainingStartDate, c.trainer,
      ];
      while (row.length < dataColumnCount) row.push("");
      row.push("SYNCED", new Date().toISOString(), c.id || "");
      return row;
    });
    
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${tab}'!A2:${columnLetter(headers.length - 1)}1000` });
    if (values.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${tab}'!A2:${columnLetter(headers.length - 1)}${values.length + 1}`,
        valueInputOption: "RAW",
        requestBody: { values },
      });
    }
    return { ok: true, synced: candidates.length };
  } catch (e) {
    console.error("[interview] sync to sheets error:", e.message);
    return { ok: false, error: e.message };
  }
}

function mapExtraPayrollEntry(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    yearMonth: row.year_month,
    label: row.label || "Extra",
    workingDays: Number(row.working_days) || 0,
    dailyRate: Number(row.daily_rate) || 0,
    netAmount: Number(row.net_amount) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

async function readExtraPayrollEntries(employeeId, yearMonth) {
  const { data, error } = await db()
    .from("extra_payroll_entries")
    .select("*")
    .eq("employee_id", employeeId)
    .eq("year_month", yearMonth)
    .order("created_at");
  if (error) throwDb(error, "readExtraPayrollEntries");
  return (data || []).map(mapExtraPayrollEntry);
}

/** Batch read extras for a month (optional employee id filter) — avoids N+1. */
async function readExtraPayrollEntriesForMonth(yearMonth, employeeIds) {
  let q = db()
    .from("extra_payroll_entries")
    .select("*")
    .eq("year_month", yearMonth)
    .order("created_at");
  if (Array.isArray(employeeIds) && employeeIds.length > 0) {
    q = q.in("employee_id", employeeIds);
  }
  const { data, error } = await q;
  if (error) throwDb(error, "readExtraPayrollEntriesForMonth");
  return (data || []).map(mapExtraPayrollEntry);
}

async function createExtraPayrollEntry(entry, createdBy) {
  const mapped = {
    employee_id: entry.employeeId,
    year_month: entry.yearMonth,
    label: entry.label || "Extra",
    working_days: Number(entry.workingDays) || 0,
    daily_rate: Number(entry.dailyRate) || 0,
    net_amount: Number(entry.netAmount) || 0,
    created_by: createdBy || null,
  };
  const { data, error } = await db().from("extra_payroll_entries").insert(mapped).select().single();
  if (error) throwDb(error, "createExtraPayrollEntry");
  return mapExtraPayrollEntryFromDb(data);
}

async function updateExtraPayrollEntry(id, updates, updatedBy) {
  const mapped = {};
  if (updates.label !== undefined) mapped.label = updates.label;
  if (updates.workingDays !== undefined) mapped.working_days = Number(updates.workingDays);
  if (updates.dailyRate !== undefined) mapped.daily_rate = Number(updates.dailyRate);
  if (updates.netAmount !== undefined) mapped.net_amount = Number(updates.netAmount);
  mapped.updated_by = updatedBy || null;
  const { data, error } = await db().from("extra_payroll_entries").update(mapped).eq("id", id).select().single();
  if (error) throwDb(error, "updateExtraPayrollEntry");
  return mapExtraPayrollEntryFromDb(data);
}

async function getExtraPayrollEntryById(id) {
  const { data, error } = await db().from("extra_payroll_entries").select("*").eq("id", id).maybeSingle();
  if (error) throwDb(error, "getExtraPayrollEntryById");
  return data ? mapExtraPayrollEntryFromDb(data) : null;
}

async function deleteExtraPayrollEntry(id) {
  const { error } = await db().from("extra_payroll_entries").delete().eq("id", id);
  if (error) throwDb(error, "deleteExtraPayrollEntry");
  return { ok: true };
}

function mapExtraPayrollEntryFromDb(row) {
  if (!row) return null;
  return {
    id: row.id,
    employeeId: row.employee_id,
    yearMonth: row.year_month,
    label: row.label || "Extra",
    workingDays: Number(row.working_days) || 0,
    dailyRate: Number(row.daily_rate) || 0,
    netAmount: Number(row.net_amount) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
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
  readAllPositionRateMonthly,
  readPositionRatesForMonth,
  upsertPositionRateForMonth,
  deletePositionRateForMonth,
  copyPositionRatesMonth,
  readAttendanceEvents,
  readAllAttendanceEvents,
  batchUpsertAttendance,
  deleteAttendanceEvent,
  deleteAttendanceEventsForEmployeeMonth,
  readAllBonusEvents,
  readAllDeductionEvents,
  upsertBonusEvent,
  upsertDeductionEvent,
  deleteBonusEvent,
  deleteDeductionEvent,
  readAllPayrollAdjustments,
  readPayrollAdjustmentsForMonth,
  upsertPayrollAdjustment,
  syncPayrollAdjustmentsPaymentMethod,
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
  updateEmployeeWarning,
  deleteEmployeeWarning,
  verifySheetAccess,
  calculatePayrollCoreFromDb,
  checkPayrollCacheInvalidation,
  readCandidateApplications,
  getCandidateApplication,
  createCandidateApplication,
  updateCandidateApplication,
  deleteCandidateApplication,
  createInterviewFeedback,
  getInterviewFeedbackById,
  readInterviewFeedbacks,
  updateInterviewFeedback,
  deleteInterviewFeedback,
  getInterviewerOptions,
  getTrainerOptions,
  syncInterviewsToSheets,
  readExtraPayrollEntries,
  readExtraPayrollEntriesForMonth,
  getExtraPayrollEntryById,
  createExtraPayrollEntry,
  updateExtraPayrollEntry,
  deleteExtraPayrollEntry,
};

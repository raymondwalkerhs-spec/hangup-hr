const { mapEmployeeRow } = require("../entity-mappers");
const { resolveTransportEligible } = require("../month-profile");

function boolFromDb(v) {
  return v === true || v === "TRUE" || String(v || "").toLowerCase() === "yes";
}

function boolToDb(v) {
  return Boolean(v);
}

function mapEmployeeFromDb(r) {
  return mapEmployeeRow({
    ID: r.id,
    "American Name": r.american_name,
    "Arabic Name": r.arabic_name,
    Phone: r.phone,
    Email: r.email,
    "Employment Date": r.employment_date,
    Status: r.status,
    Position: r.position,
    Department: r.department,
    Unit: r.unit,
    Team: r.team,
    "Payment Method": r.payment_method,
    "Alternative payment": r.alternative_payment,
    Allowance: r.allowance,
    "Payment Details\n( INSTA _ WALLET)": r.payment_details_insta_wallet,
    Identification: r.identification,
    Nationality: r.nationality,
    "Bank Refrence Number": r.bank_refrence_number,
    "Bank Name (AS BANK SHEET)": r.bank_name_as_bank_sheet,
    "Profile Photo File ID": r.profile_photo_file_id,
    "Profile Photo Link": r.profile_photo_link,
    "Profile Photo Updated": r.profile_photo_updated,
    "Former IDs": r.former_ids,
    "Promoted To ID": r.promoted_to_id,
    "Promoted From ID": r.promoted_from_id,
    "Lead Role": r.lead_role,
    "Effective From Month": r.effective_from_month,
    "Depart Date": r.depart_date,
    notice_type: r.notice_type,
    internal_id: r.internal_id || null,
    archived_app_id: r.archived_app_id || null,
    deleted_at: r.deleted_at || null,
    fp_number: r.fp_number || r["FP Number"] || null,
    probation_end_date: r.probation_end_date || r["Probation End Date"] || null,
    contract_end_date: r.contract_end_date || r["Contract End Date"] || null,
    "Work Permit": r.work_permit,
    "Insurance Status": r.insurance_status,
    "Insurance Type": r.insurance_type,
    "Insurance Amount": r.insurance_amount,
    "Insurance Employee Deduction": r.insurance_employee_deduction,
    payroll_exempt: r.payroll_exempt === true,
  });
}

function employeeToDb(emp) {
  const row = {
    id: emp.id,
    american_name: emp.american_name || null,
    arabic_name: emp.arabic_name || null,
    phone: emp.phone || null,
    email: emp.email || null,
    employment_date: emp.employment_date || null,
    status: emp.status || null,
    position: emp.position || null,
    department: emp.department || null,
    unit: emp.unit || null,
    team: emp.team || null,
    payment_method: emp.payment_method || null,
    alternative_payment: emp.alternative_payment || null,
    allowance: emp.allowance || null,
    payment_details_insta_wallet: emp.payment_details_insta_wallet || null,
    identification: emp.identification || null,
    nationality: emp.nationality || null,
    work_permit: emp.work_permit || null,
    insurance_status: emp.insurance_status || null,
    insurance_type: emp.insurance_type || null,
    insurance_amount: emp.insurance_amount != null ? Number(emp.insurance_amount) : null,
    insurance_employee_deduction:
      emp.insurance_employee_deduction != null ? Number(emp.insurance_employee_deduction) : null,
    bank_refrence_number: emp.bank_refrence_number || null,
    bank_name_as_bank_sheet: emp.bank_name_as_bank_sheet || null,
    profile_photo_file_id: emp.profile_photo_file_id || null,
    profile_photo_link: emp.profile_photo_link || null,
    profile_photo_updated: emp.profile_photo_updated || null,
    former_ids: emp.former_ids || null,
    promoted_to_id: emp.promoted_to_id || null,
    promoted_from_id: emp.promoted_from_id || null,
    lead_role: emp.lead_role || null,
    effective_from_month: emp.effective_from_month || null,
    depart_date: emp.depart_date || null,
    notice_type: emp.notice_type || null,
    fp_number: emp.fp_number || null,
    probation_end_date: emp.probation_end_date || null,
    contract_end_date: emp.contract_end_date || null,
    payroll_exempt: Boolean(emp.payroll_exempt),
    updated_at: new Date().toISOString(),
  };
  if (emp.archived_app_id != null) row.archived_app_id = emp.archived_app_id;
  if (emp.deleted_at != null) row.deleted_at = emp.deleted_at;
  return row;
}

function mapAttendanceFromDb(r) {
  return {
    employeeId: r.employee_id,
    date: String(r.date).slice(0, 10),
    status: r.status || "",
    fpLateness: r.fp_lateness || null,
    fpNotes: r.fp_notes || "",
    isWeekendDefault: boolFromDb(r.weekend_default),
    transportOverride: r.transport_override || "",
    paidLeave: boolFromDb(r.paid_leave),
    leaveNote: r.leave_note || "",
  };
}

function attendanceToDb(record, updatedBy) {
  return {
    employee_id: record.employeeId,
    date: String(record.date).slice(0, 10),
    status: record.status || "",
    fp_lateness: record.fpLateness || null,
    weekend_default: boolToDb(record.isWeekendDefault),
    transport_override: record.transportOverride || "",
    paid_leave: boolToDb(record.paidLeave),
    leave_note: record.leaveNote || "",
    fp_notes: record.fpNotes || "",
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  };
}

function mapBonusFromDb(r) {
  return {
    employeeId: r.employee_id,
    date: String(r.date).slice(0, 10),
    amount: Number(r.amount) || 0,
    reason: r.reason || "",
    type: r.type || "",
    unit: r.unit || "",
  };
}

function bonusToDb(record, updatedBy) {
  return {
    employee_id: record.employeeId,
    date: String(record.date).slice(0, 10),
    amount: Number(record.amount) || 0,
    reason: record.reason || "",
    type: record.type || "Other Bonus",
    unit: record.unit || "",
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  };
}

function mapDeductionFromDb(r) {
  return mapBonusFromDb(r);
}

function deductionToDb(record, updatedBy) {
  const row = bonusToDb(record, updatedBy);
  row.type = record.type || "Other Deductions";
  return row;
}

function mapPayrollAdjustmentFromDb(r) {
  const yearMonth = String(r.year_month || "").trim();
  return {
    employeeId: r.employee_id,
    yearMonth,
    extraDays: Number(r.extra_days) || 0,
    twoWeekHold: boolFromDb(r.two_week_hold),
    commissionType: r.commission_type || "",
    commissionAmount: Number(r.commission_amount) || 0,
    commissionComments: r.commission_comments || "",
    position: r.position || "",
    salaryRaise: Number(r.salary_raise) || 0,
    monthlySalaryOverride:
      r.monthly_salary_override != null && r.monthly_salary_override !== ""
        ? Number(r.monthly_salary_override)
        : null,
    paymentMethod: r.payment_method || "",
    bankReference: r.bank_refrence_number || "",
    bankName: r.bank_name || "",
    payrollStatus: r.payroll_status || "pending",
    transportEligible: resolveTransportEligible(yearMonth, r.transport_eligible),
    monthNotes: r.month_notes || "",
    salesCount: Number(r.sales_count) || 0,
    noPayroll: boolFromDb(r.no_payroll),
  };
}

function payrollAdjustmentToDb(record, updatedBy) {
  return {
    employee_id: record.employeeId,
    year_month: record.yearMonth,
    extra_days: Number(record.extraDays) || 0,
    two_week_hold: boolToDb(record.twoWeekHold),
    commission_type: record.commissionType || "",
    commission_amount: Number(record.commissionAmount) || 0,
    commission_comments: record.commissionComments || "",
    position: record.position || "",
    salary_raise: Number(record.salaryRaise) || 0,
    monthly_salary_override: record.monthlySalaryOverride,
    payment_method: record.paymentMethod || "",
    bank_refrence_number: record.bankReference || "",
    bank_name: record.bankName || "",
    payroll_status: record.payrollStatus || "pending",
    transport_eligible: boolToDb(record.transportEligible !== false),
    month_notes: record.monthNotes || "",
    sales_count: Number(record.salesCount) || 0,
    no_payroll: boolToDb(record.noPayroll),
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  };
}

function mapDocumentFromDb(r) {
  return {
    employeeId: r.employee_id,
    docType: r.doc_type || "",
    fileName: r.file_name || "",
    driveFileId: r.storage_path || r.drive_file_id || "",
    driveLink: r.public_url || r.drive_link || "",
    storagePath: r.storage_path || "",
    uploadedAt: r.uploaded_at || "",
    expiry: r.expiry || "",
    noExpiry: r.no_expiry === true,
    notes: r.notes || "",
  };
}

function mapWarningFromDb(r) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    date: String(r.date || "").slice(0, 10),
    type: r.type || "Note",
    title: r.title || "",
    content: r.content || "",
    severity: r.severity || "normal",
    warningLevel: r.warning_level || "",
    createdBy: r.created_by || "",
    createdAt: r.created_at || "",
  };
}

function mapLoanFromDb(r) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    totalAmount: Number(r.total_amount) || 0,
    installmentAmount: Number(r.installment_amount) || 0,
    installmentsCount: Number(r.installments_count) || 0,
    installmentsPaid: Number(r.installments_paid) || 0,
    startYearMonth: r.start_year_month || "",
    skipCurrentMonth: boolFromDb(r.skip_current_month),
    createdYearMonth: r.created_year_month || "",
    notes: r.notes || "",
    status: r.status || "active",
    createdBy: r.created_by || "",
    createdAt: r.created_at || "",
  };
}

function mapLoanPaymentFromDb(r) {
  return {
    loanId: r.loan_id,
    employeeId: r.employee_id,
    yearMonth: r.year_month,
    amount: Number(r.amount) || 0,
    installmentNumber: r.installment_number,
    recordedBy: r.recorded_by || "",
    recordedAt: r.recorded_at || "",
  };
}

function mapSplitFromDb(r) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    yearMonth: r.year_month,
    amount: Number(r.amount) || 0,
    splitKind: r.split_kind || "payment",
    status: r.status || "pending",
    deferToMonth: r.defer_to_month || "",
    notes: r.notes || "",
    createdBy: r.created_by || "",
    createdAt: r.created_at || "",
  };
}

function mapCommissionTypeFromDb(r) {
  return {
    name: r.name,
    rateEgp: Number(r.rate_egp) || 0,
    description: r.description || "",
    active: boolFromDb(r.active !== false),
  };
}

function mapCommissionTierFromDb(r) {
  return {
    yearMonth: r.year_month,
    minSales: Number(r.min_sales) || 0,
    bonusAmount: Number(r.bonus_amount) || 0,
    label: r.label || "",
  };
}

module.exports = {
  boolFromDb,
  boolToDb,
  mapEmployeeFromDb,
  employeeToDb,
  mapAttendanceFromDb,
  attendanceToDb,
  mapBonusFromDb,
  bonusToDb,
  mapDeductionFromDb,
  deductionToDb,
  mapPayrollAdjustmentFromDb,
  payrollAdjustmentToDb,
  mapDocumentFromDb,
  mapWarningFromDb,
  mapLoanFromDb,
  mapLoanPaymentFromDb,
  mapSplitFromDb,
  mapCommissionTypeFromDb,
  mapCommissionTierFromDb,
};

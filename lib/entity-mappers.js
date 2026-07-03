/** Shared employee row mapping — no googleapis dependency. */

const EMPLOYEE_STATUSES = [
  "Active",
  "Paused",
  "Paused still get paid",
  "OUT BUT STILL GET PAID",
  "Promoted",
  "Out",
  "Deleted",
  "",
];

function mapEmployeeRow(r) {
  return {
    id: String(r.ID || r.id || "").trim(),
    american_name: r["American Name"] || r.american_name || null,
    arabic_name: r["Arabic Name"] || r.arabic_name || null,
    phone: r.Phone || r.phone || null,
    email: r.Email || r.email || null,
    employment_date: r["Employment Date"] || r.employment_date || null,
    status: r.Status || r.status || null,
    position: r.Position || r.position || null,
    department: r.Department || r.department || null,
    unit: r.Unit || r.unit || null,
    team: r.Team || r.team || null,
    payment_method: r["Payment Method"] || r.payment_method || null,
    alternative_payment: r["Alternative payment"] || r.alternative_payment || null,
    allowance: r.Allowance || r.allowance || null,
    payment_details_insta_wallet:
      r["Payment Details\n( INSTA _ WALLET)"] || r.payment_details_insta_wallet || null,
    identification: r.Identification || r.identification || null,
    nationality: r.Nationality || r.nationality || null,
    work_permit: r.work_permit || r["Work Permit"] || null,
    insurance_status: r.insurance_status || r["Insurance Status"] || null,
    insurance_type: r.insurance_type || r["Insurance Type"] || null,
    insurance_amount:
      r.insurance_amount != null && r.insurance_amount !== ""
        ? Number(r.insurance_amount)
        : r["Insurance Amount"] != null && r["Insurance Amount"] !== ""
          ? Number(r["Insurance Amount"])
          : null,
    insurance_employee_deduction:
      r.insurance_employee_deduction != null && r.insurance_employee_deduction !== ""
        ? Number(r.insurance_employee_deduction)
        : r["Insurance Employee Deduction"] != null && r["Insurance Employee Deduction"] !== ""
          ? Number(r["Insurance Employee Deduction"])
          : null,
    depart_date: r.depart_date || r["Depart Date"] || null,
    notice_type: r.notice_type || r["Notice Type"] || null,
    bank_refrence_number: r["Bank Refrence Number"] || r.bank_refrence_number || null,
    bank_name_as_bank_sheet: r["Bank Name (AS BANK SHEET)"] || r.bank_name_as_bank_sheet || null,
    profile_photo_file_id: String(r["Profile Photo File ID"] || r.profile_photo_file_id || "").trim(),
    profile_photo_link: r["Profile Photo Link"] || r.profile_photo_link || null,
    profile_photo_updated: r["Profile Photo Updated"] || r.profile_photo_updated || null,
    former_ids: r["Former IDs"] || r.former_ids || null,
    promoted_to_id: String(r["Promoted To ID"] || r.promoted_to_id || "").trim() || null,
    promoted_from_id: String(r["Promoted From ID"] || r.promoted_from_id || "").trim() || null,
    lead_role: String(r["Lead Role"] || r.lead_role || "").trim() || null,
    effective_from_month: String(r["Effective From Month"] || r.effective_from_month || "").trim() || null,
    internal_id: r.internal_id || null,
    archived_app_id: r.archived_app_id || null,
    deleted_at: r.deleted_at || null,
    fp_number: r.fp_number || r["FP Number"] || null,
    probation_end_date: r.probation_end_date || r["Probation End Date"] || null,
    contract_end_date: r.contract_end_date || r["Contract End Date"] || null,
    payroll_exempt: r.payroll_exempt === true || r.payroll_exempt === "true",
    no_payroll_months: r.no_payroll_months || null,
  };
}

module.exports = {
  EMPLOYEE_STATUSES,
  mapEmployeeRow,
};

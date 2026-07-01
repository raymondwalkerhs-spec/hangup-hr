const PAYROLL_STATUSES = [
  "pending",
  "pending papers",
  "pending hardware",
  "received",
  "closed",
];

const TRANSPORT_ELIGIBLE_FROM_MONTH =
  process.env.TRANSPORT_ELIGIBLE_FROM_MONTH || "2026-07";

function defaultTransportEligible(yearMonth) {
  return String(yearMonth || "") >= TRANSPORT_ELIGIBLE_FROM_MONTH;
}

function transportEligibleForProfile(yearMonth, profileValue) {
  if (profileValue === undefined || profileValue === null || profileValue === "") {
    return defaultTransportEligible(yearMonth);
  }
  return boolVal(profileValue, false);
}

function resolveTransportEligible(yearMonth, profileValue) {
  return transportEligibleForProfile(yearMonth, profileValue);
}

function lookupSalary(position, rates) {
  if (!position) return 0;
  const exact = rates.find((r) => r.position === position);
  if (exact) return exact.monthlySalary;
  const loose = rates.find((r) => r.position.toLowerCase() === position.toLowerCase());
  return loose?.monthlySalary ?? 0;
}

function boolVal(v, defaultTrue = true) {
  if (v === undefined || v === null || v === "") return defaultTrue;
  if (v === true || v === "TRUE") return true;
  if (v === false || v === "FALSE") return false;
  const s = String(v).toLowerCase();
  if (s === "yes" || s === "true" || s === "1") return true;
  if (s === "no" || s === "false" || s === "0") return false;
  return defaultTrue;
}

function buildDefaultProfile(emp, yearMonth) {
  return {
    employeeId: emp.id,
    yearMonth,
    extraDays: 0,
    twoWeekHold: false,
    commissionType: "",
    commissionAmount: 0,
    commissionComments: "",
    position: emp.position || "",
    salaryRaise: 0,
    monthlySalaryOverride: null,
    paymentMethod: emp.payment_method || "",
    bankReference: emp.bank_refrence_number || "",
    bankName: emp.bank_name_as_bank_sheet || "",
    payrollStatus: "pending",
    transportEligible: defaultTransportEligible(yearMonth),
    monthNotes: "",
    salesCount: 0,
  };
}

function mergeProfile(existing, updates, emp) {
  const base = existing || buildDefaultProfile(emp, updates.yearMonth);
  return {
    ...base,
    ...updates,
    employeeId: updates.employeeId || base.employeeId,
    yearMonth: updates.yearMonth || base.yearMonth,
    transportEligible: transportEligibleForProfile(
      updates.yearMonth || base.yearMonth,
      updates.transportEligible !== undefined ? updates.transportEligible : base.transportEligible
    ),
  };
}

function resolveEmployeeForMonth(emp, profile, rates, yearMonth) {
  const ym = yearMonth || profile?.yearMonth || "";
  const position = profile?.position || emp.position || "";
  const baseFromPosition = lookupSalary(position, rates);
  const override = profile?.monthlySalaryOverride;
  const baseSalary =
    override != null && override !== "" && !Number.isNaN(Number(override))
      ? Number(override)
      : baseFromPosition;
  const salaryRaise = Number(profile?.salaryRaise) || 0;
  const monthlySalary = Math.round((baseSalary + salaryRaise) * 100) / 100;

  return {
    ...emp,
    position,
    unit: emp.unit,
    payment_method: profile?.paymentMethod || emp.payment_method || "",
    bank_refrence_number: profile?.bankReference ?? emp.bank_refrence_number ?? "",
    bank_name_as_bank_sheet: profile?.bankName ?? emp.bank_name_as_bank_sheet ?? "",
    monthlySalaryResolved: monthlySalary,
    payrollStatus: profile?.payrollStatus || "pending",
    transportEligible: transportEligibleForProfile(ym, profile?.transportEligible),
  };
}

module.exports = {
  PAYROLL_STATUSES,
  TRANSPORT_ELIGIBLE_FROM_MONTH,
  defaultTransportEligible,
  transportEligibleForProfile,
  resolveTransportEligible,
  buildDefaultProfile,
  mergeProfile,
  resolveEmployeeForMonth,
  boolVal,
  lookupSalary,
};

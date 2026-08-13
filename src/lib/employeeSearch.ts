/** Client-side employee search — mirrors legacy `matchesEmployeeSearch`. */
import { matchesPaymentMethodFilter } from "@/lib/paymentMethods";
import { isOutEmployeeStatus } from "@/lib/employeeStatus";
import { isPayrollSettled, isTrainingDeferredRow } from "@/lib/payrollSettled";
export function employeeSearchHaystack(emp: Record<string, unknown>): string {
  return [
    emp.id,
    emp.american_name,
    emp.arabic_name,
    emp.name,
    emp.phone,
    emp.email,
    emp.unit,
    emp.team,
    emp.position,
  ]
    .filter(Boolean)
    .join(" ");
}

export function matchesEmployeeSearch(emp: Record<string, unknown>, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = employeeSearchHaystack(emp).toLowerCase();
  const tokens = needle.split(/\s+/).filter(Boolean);
  return tokens.every((tok) => hay.includes(tok));
}

export type EmployeeFilters = {
  status?: string;
  unit?: string;
  team?: string;
  position?: string;
  paymentMethod?: string;
  fpStatus?: "" | "has_fp" | "no_fp";
  nationality?: string;
  workPermit?: string;
  insuranceStatus?: string;
};

export function filterEmployees(
  employees: Record<string, unknown>[],
  search: string,
  filters: EmployeeFilters
): Record<string, unknown>[] {
  return employees.filter((e) => {
    if (!matchesEmployeeSearch(e, search)) return false;
    if (filters.status && String(e.status || "") !== filters.status) return false;
    if (filters.unit && String(e.unit || "") !== filters.unit) return false;
    if (filters.team && String(e.team || "") !== filters.team) return false;
    if (filters.position && String(e.position || "") !== filters.position) return false;
    if (!matchesPaymentMethodFilter(e.payment_method || e.paymentMethod, filters.paymentMethod)) return false;
    if (filters.fpStatus === "has_fp" && !(e.fp_number || e.fpNumber)) return false;
    if (filters.fpStatus === "no_fp" && (e.fp_number || e.fpNumber)) return false;
    if (filters.nationality && String(e.nationality || "") !== filters.nationality) return false;
    if (filters.workPermit === "have_permit") {
      const wp = e.work_permit || e.work_permit_status;
      if (wp !== "have_permit") return false;
    }
    if (filters.workPermit === "no_permit") {
      const wp = e.work_permit || e.work_permit_status;
      if (wp !== "no_permit") return false;
    }
    if (filters.insuranceStatus === "insured") {
      const ins = e.insurance_status || e.social_insurance_status;
      if (ins !== "insured") return false;
    }
    if (filters.insuranceStatus === "not_insured") {
      const ins = e.insurance_status || e.social_insurance_status;
      if (ins !== "not_insured") return false;
    }
    return true;
  });
}

export type PayrollFilters = {
  search: string;
  position: string;
  team: string;
  unit: string;
  status: string;
  paymentMethod?: string;
  month?: string;
  hideOut: boolean;
  hideZeroNet: boolean;
  showLegacyEmployees?: boolean;
};

/** Remaining unpaid net shown in the Net column / Net salary tile (excludes paid, no-payroll, deferred). */
export function payrollDisplayNet(row: Record<string, unknown>): number {
  if (isPayrollSettled(row)) return 0;
  if (isTrainingDeferredRow(row)) return 0;
  if (row.payrollKind === "dual") {
    // Training marked paid → remaining is agent portion only
    if (
      row.trainingPayrollPaid === true ||
      (row.training as Record<string, unknown> | undefined)?.trainingPayrollPaid === true ||
      (row.training as Record<string, unknown> | undefined)?.payrollSettled === true
    ) {
      const agent = row.agent as Record<string, unknown> | undefined;
      return Number(agent?.calculatedNet ?? agent?.netSalary ?? 0) || 0;
    }
    return Number(row.combinedNet ?? row.netSalary) || 0;
  }
  if (row.hasSplits) {
    return Number(row.calculatedNet ?? row.netSalary) || 0;
  }
  return Number(row.netSalary ?? row.calculatedNet) || 0;
}

function isLegacyDepartRow(row: Record<string, unknown>, month: string): boolean {
  if (!isOutEmployeeStatus(row.status)) return false;
  const depart = String(row.depart_date || row.departDate || "").slice(0, 7);
  if (!depart || !month) return false;
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() - 2);
  const cutoff = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return depart <= cutoff;
}

function isPreviousMonthDepartRow(row: Record<string, unknown>, month: string): boolean {
  if (!isOutEmployeeStatus(row.status)) return false;
  const depart = String(row.depart_date || row.departDate || "").slice(0, 7);
  if (!depart || !month) return false;
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() - 1);
  const prev = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return depart === prev;
}

function isCurrentMonthDepartRow(row: Record<string, unknown>, month: string): boolean {
  const depart = String(row.depart_date || row.departDate || "").slice(0, 7);
  return Boolean(depart && month && depart === month.slice(0, 7));
}

export function payrollRowWorkedInMonth(row: Record<string, unknown>): boolean {
  if (row.payrollKind === "training_deferred_month") {
    return (
      (Number(row.earnedNetSalary) || 0) > 0 ||
      (Number(row.earnedBasicSalary) || 0) > 0 ||
      (Number(row.totalWorkingDays) || 0) > 0 ||
      (Number(row.scopedDayCount) || 0) > 0
    );
  }
  return (
    (Number(row.totalWorkingDays) || 0) > 0 ||
    (Number(row.salesCount) || 0) > 0 ||
    (Number(row.commissionAmount) || 0) > 0 ||
    (Number(row.basicSalary) || 0) > 0 ||
    (Number(row.earnedNetSalary) || 0) > 0 ||
    (Number(row.earnedBasicSalary) || 0) > 0
  );
}

export function payrollRowHasSalary(row: Record<string, unknown>): boolean {
  return payrollRowWorkedInMonth(row);
}

function payrollNetAmount(row: Record<string, unknown>): number {
  return payrollDisplayNet(row);
}

export function filterPayrollRows(
  rows: Record<string, unknown>[],
  filters: PayrollFilters
): Record<string, unknown>[] {
  return rows.filter((r) => {
    if (!matchesEmployeeSearch(r, filters.search)) return false;
    if (filters.position) {
      const pos = String(r.position || (r.adj as Record<string, unknown>)?.position || "").toLowerCase();
      if (pos !== filters.position.toLowerCase()) return false;
    }
    if (filters.team && String(r.team || "") !== filters.team) return false;
    if (filters.unit && String(r.unit || "") !== filters.unit) return false;
    if (filters.status && String(r.payrollStatus || r.status || "") !== filters.status) return false;
    if (!matchesPaymentMethodFilter(r.paymentMethod || r.payment_method, filters.paymentMethod)) return false;
    if (filters.hideOut || !filters.showLegacyEmployees) {
      const worked = payrollRowWorkedInMonth(r);
      const month = filters.month || "";
      if (worked) {
        /* keep */
      } else if (month && isCurrentMonthDepartRow(r, month)) {
        /* keep */
      } else if (month && isLegacyDepartRow(r, month)) {
        if (!filters.showLegacyEmployees) return false;
      } else if (month && isPreviousMonthDepartRow(r, month)) {
        if (filters.hideOut) return false;
      } else if (isOutEmployeeStatus(r.status)) {
        return false;
      }
    }
    if (filters.hideZeroNet && payrollNetAmount(r) === 0) return false;
    return true;
  });
}

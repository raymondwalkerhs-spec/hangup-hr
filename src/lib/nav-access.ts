/** Role-based nav/page access — mirrors legacy `applyChangesButtonVisibility`. */

export type StatusUser = Record<string, unknown> & {
  role?: string;
  canViewPayroll?: boolean;
  canViewBonuses?: boolean;
  canViewSales?: boolean;
  canViewSalesThisMonth?: boolean;
  canViewSalesLogFilters?: boolean;
  canViewSalesRankings?: boolean;
  canViewTeamDashboard?: boolean;
  canViewRpmWeeklyDashboard?: boolean;
  canEditRpmWeeklyTargets?: boolean;
  canSubmitRpmChecks?: boolean;
  canSubmitRpmQFeedback?: boolean;
  canEditRpmChecks?: boolean;
  canEditRpmQFeedback?: boolean;
  canViewRpmChecks?: boolean;
  canViewRpmQFeedback?: boolean;
  canViewRpmQFeedbackAnalysis?: boolean;
  canViewRpmChecksDashboard?: boolean;
  canViewRpmCheckDuplicates?: boolean;
  canImportRpmSaleFromCheck?: boolean;
  canViewEmployeeDirectory?: boolean;
  canAccessCosts?: boolean;
  canSubmitExpense?: boolean;
  canApproveLoan?: boolean;
  canViewEquipmentInventory?: boolean;
  hasAssignedEquipment?: boolean;
  canViewReports?: boolean;
  canViewDashboardPayroll?: boolean;
  canViewAgentPayslipNav?: boolean;
  canViewInterviews?: boolean;
  canViewItRequests?: boolean;
  canSubmitItRequest?: boolean;
  canUseEmployeeFilters?: boolean;
  canViewMeetingRequests?: boolean;
  canSubmitMeetingRequest?: boolean;
  canManageUsers?: boolean;
  canManageAccessControl?: boolean;
  canViewSalesAdmin?: boolean;
  canManageSalesFieldPermissions?: boolean;
  canViewRules?: boolean;
  canEditRules?: boolean;
  canViewAnnouncements?: boolean;
  canEditAnnouncements?: boolean;
  canViewCoaching?: boolean;
  canSubmitCoaching?: boolean;
  canViewCoachingSecret?: boolean;
  canManageEmployees?: boolean;
};

const PAYROLL_PAGES = new Set(["payroll", "salaries", "loans"]);
const PAYROLL_NAV_ROLES = new Set(["admin", "ceo", "hr", "finance"]);
const PAYROLL_NAV_DENY_ROLES = new Set(["agent", "office_assistant", "tl"]);
const BONUS_PAGES = new Set(["bonuses", "deductions"]);
const TRAINING_ROLES = new Set(["admin", "ceo", "hr", "op", "tl", "quality"]);
const CHANGES_ROLES = new Set(["admin", "ceo"]);
const BACKUP_ROLES = new Set(["admin", "rtm"]);
const COMPLIANCE_ROLES = new Set(["admin", "ceo", "hr"]);

function role(user: StatusUser | undefined | null): string {
  return String(user?.role || "").toLowerCase();
}

function canViewBonusesDeductions(user: StatusUser | undefined | null): boolean {
  if (user?.canViewBonuses === true) return true;
  return [
    "admin", "ceo", "hr", "finance", "op", "tl", "quality", "rtm", "agent", "office_assistant", "checker",
  ].includes(role(user));
}

function canViewSales(user: StatusUser | undefined | null): boolean {
  if (user?.canViewSales === false) return false;
  return user?.canViewSales === true || canViewBonusesDeductions(user);
}

function canViewTeamDashboard(user: StatusUser | undefined | null): boolean {
  if (user?.canViewTeamDashboard === true) return true;
  if (user?.canViewTeamDashboard === false) return false;
  return canViewSales(user);
}

export function canAccessPage(user: StatusUser | undefined | null, page: string): boolean {
  if (!page || page === "dashboard" || page === "settings" || page === "cats") return true;

  if (PAYROLL_PAGES.has(page)) {
    const r = role(user);
    if (page === "payroll" && PAYROLL_NAV_DENY_ROLES.has(r) && user?.canViewAgentPayslipNav === true) {
      return true;
    }
    if (PAYROLL_NAV_DENY_ROLES.has(r)) return false;
    return user?.canViewPayroll === true || PAYROLL_NAV_ROLES.has(r);
  }
  if (BONUS_PAGES.has(page)) return canViewBonusesDeductions(user);
  if (page === "sales") return canViewSales(user);
  if (page === "checks") {
    return (
      user?.canSubmitRpmChecks === true ||
      user?.canViewRpmChecks === true ||
      user?.canViewRpmChecksDashboard === true
    );
  }
  if (page === "q-feedback") {
    return (
      user?.canSubmitRpmQFeedback === true ||
      user?.canViewRpmQFeedback === true ||
      user?.canViewRpmChecksDashboard === true
    );
  }
  if (page === "check-duplicates") {
    return user?.canViewRpmCheckDuplicates === true;
  }
  if (page === "team-dashboard") return canViewTeamDashboard(user);
  if (page === "employees") {
    if (user?.canViewEmployeeDirectory === false) return false;
    return role(user) !== "checker";
  }
  if (page === "org") {
    return role(user) !== "checker";
  }
  if (page === "costs") return user?.canAccessCosts === true || user?.canSubmitExpense === true;
  if (page === "loan-approvals") {
    return user?.canApproveLoan === true && !["agent", "office_assistant", "tl"].includes(role(user));
  }
  if (page === "equipment") {
    return user?.canViewEquipmentInventory === true || user?.hasAssignedEquipment === true;
  }
  if (page === "reports" || page === "analytics") {
    return user?.canViewReports === true || user?.canViewSalesRankings === true;
  }
  if (page === "recycle") {
    return ["hr", "admin", "ceo", "rtm", "it"].includes(role(user));
  }
  if (page === "payslip") return user?.canViewAgentPayslipNav === true;
  if (page === "interview") return user?.canViewInterviews === true;
  if (page === "training") return TRAINING_ROLES.has(role(user));
  if (page === "it-requests") {
    return user?.canViewItRequests === true || user?.canSubmitItRequest === true;
  }
  if (page === "meeting-requests") {
    return user?.canViewMeetingRequests === true || user?.canSubmitMeetingRequest === true;
  }
  if (page === "users") return user?.canManageUsers === true;
  if (page === "access-control") return user?.canManageAccessControl === true;
  if (page === "sales-permissions" || page === "sales-log-columns") {
    return user?.canViewSalesAdmin === true || user?.canManageSalesFieldPermissions === true;
  }
  if (page === "rules") {
    if (user?.canEditRules === true) return true;
    return user?.canViewRules === true;
  }
  if (page === "announcements") {
    return user?.canViewAnnouncements === true || user?.canEditAnnouncements === true;
  }
  if (page === "coaching") {
    if (user?.canViewCoaching === true || user?.canSubmitCoaching === true) return true;
    if (user?.canViewCoaching === false) return false;
    return false;
  }
  if (page === "changes") return CHANGES_ROLES.has(role(user));
  if (page === "backup") return BACKUP_ROLES.has(role(user));
  if (page === "offboarding" || page === "clearance") {
    return user?.canManageEmployees === true || COMPLIANCE_ROLES.has(role(user));
  }

  // employees, org, attendance, breaks, requests — always visible when logged in
  return true;
}

export function firstAllowedPage(user: StatusUser | undefined | null): string {
  const order = [
    "dashboard", "employees", "attendance", "sales", "payroll", "requests", "settings",
  ];
  for (const p of order) {
    if (canAccessPage(user, p)) return p;
  }
  return "dashboard";
}

/** Pages that need a loaded user before access can be decided (avoid showing in nav during auth load). */
export function isRestrictedPage(page: string): boolean {
  return !canAccessPage(undefined, page) && page !== "dashboard" && page !== "settings";
}

import type { LucideIcon } from "lucide-react";

export interface NavItem {
  path: string;
  page: string;
  label: string;
  icon: string;
  group: string;
  navId?: string;
}

export const NAV_GROUPS = [
  "Overview",
  "People",
  "Time & Attendance",
  "Compensation",
  "Sales",
  "Insights",
  "Administration",
] as const;

export const NAV_ITEMS: NavItem[] = [
  { path: "/dashboard", page: "dashboard", label: "Dashboard", icon: "layout-dashboard", group: "Overview" },
  { path: "/announcements", page: "announcements", label: "Announcements", icon: "megaphone", group: "Overview", navId: "nav-announcements" },
  { path: "/employees", page: "employees", label: "Employees", icon: "users", group: "People" },
  { path: "/coaching", page: "coaching", label: "Coaching", icon: "clipboard-pen", group: "People", navId: "nav-coaching" },
  { path: "/org", page: "org", label: "Organization", icon: "building-2", group: "People" },
  { path: "/equipment", page: "equipment", label: "Equipment", icon: "laptop", group: "People", navId: "nav-equipment" },
  { path: "/interviews", page: "interview", label: "Interviews", icon: "clipboard-list", group: "People", navId: "nav-interview" },
  { path: "/training", page: "training", label: "Training", icon: "graduation-cap", group: "People", navId: "nav-training" },
  { path: "/attendance", page: "attendance", label: "Attendance", icon: "calendar-check", group: "Time & Attendance" },
  { path: "/breaks", page: "breaks", label: "Breaks", icon: "coffee", group: "Time & Attendance", navId: "nav-breaks" },
  { path: "/requests", page: "requests", label: "Requests", icon: "file-text", group: "Time & Attendance" },
  { path: "/meeting-requests", page: "meeting-requests", label: "Meeting Requests", icon: "users-round", group: "Time & Attendance", navId: "nav-meeting-requests" },
  { path: "/it-requests", page: "it-requests", label: "IT Requests", icon: "monitor", group: "Time & Attendance", navId: "nav-it-requests" },
  { path: "/payroll", page: "payroll", label: "Payroll", icon: "wallet", group: "Compensation" },
  { path: "/salaries", page: "salaries", label: "Salaries", icon: "banknote", group: "Compensation" },
  { path: "/bonuses", page: "bonuses", label: "Bonuses", icon: "gift", group: "Compensation" },
  { path: "/deductions", page: "deductions", label: "Deductions", icon: "minus-circle", group: "Compensation" },
  { path: "/loans", page: "loans", label: "Loans", icon: "hand-coins", group: "Compensation" },
  { path: "/loan-approvals", page: "loan-approvals", label: "Loan approvals", icon: "check-check", group: "Compensation", navId: "nav-loan-approvals" },
  { path: "/payslip", page: "payslip", label: "My payslip", icon: "receipt", group: "Compensation", navId: "nav-payslip" },
  { path: "/sales", page: "sales", label: "Sales log", icon: "line-chart", group: "Sales", navId: "nav-sales" },
  { path: "/team-dashboard", page: "team-dashboard", label: "Team dashboards", icon: "bar-chart", group: "Sales", navId: "nav-team-dashboard" },
  { path: "/costs", page: "costs", label: "Costs", icon: "pie-chart", group: "Sales", navId: "nav-costs" },
  { path: "/reports", page: "reports", label: "Reports", icon: "file-bar-chart", group: "Insights" },
  { path: "/analytics", page: "analytics", label: "Analytics", icon: "activity", group: "Insights" },
  { path: "/users", page: "users", label: "Users", icon: "user-cog", group: "Administration", navId: "nav-users" },
  { path: "/access-control", page: "access-control", label: "Access Control", icon: "shield", group: "Administration", navId: "nav-access-control" },
  { path: "/sales-permissions", page: "sales-permissions", label: "Sales permissions", icon: "key-round", group: "Administration", navId: "nav-sales-permissions" },
  { path: "/sales-log-columns", page: "sales-log-columns", label: "Log columns", icon: "columns", group: "Administration", navId: "nav-sales-log-columns" },
  { path: "/rules", page: "rules", label: "Rules", icon: "scroll-text", group: "Administration", navId: "nav-rules" },
  { path: "/changes", page: "changes", label: "Changes", icon: "git-compare", group: "Administration", navId: "nav-changes" },
  { path: "/backup", page: "backup", label: "Backup", icon: "database-backup", group: "Administration", navId: "nav-backup" },
  { path: "/offboarding", page: "offboarding", label: "Offboarding", icon: "user-minus", group: "People", navId: "nav-offboarding" },
  { path: "/clearance", page: "clearance", label: "Clearance", icon: "clipboard-check", group: "People", navId: "nav-clearance" },
  { path: "/settings", page: "settings", label: "Settings", icon: "settings", group: "Administration" },
];

export const PAGE_TITLES: Record<string, string> = Object.fromEntries(
  NAV_ITEMS.map((n) => [n.page, n.label])
);

export const PATH_TITLES: Record<string, string> = Object.fromEntries(
  NAV_ITEMS.map((n) => [n.path.replace(/^\//, ""), n.label])
);

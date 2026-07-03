/**
 * App-wide permission catalog for admin Access Control.
 * Keys map to lib/roles.js can* helpers; defaults mirror v1.3.4 hardcoded behavior.
 */

const ROLE_RANK = {
  none: 0,
  agent: 1,
  office_assistant: 1,
  quality: 1,
  rtm: 1,
  tl: 2,
  op: 2,
  finance: 3,
  hr: 4,
  admin: 5,
  ceo: 6,
};

function normalizeRole(role) {
  const raw = String(role || "").trim().toLowerCase();
  if (!raw || ROLE_RANK[raw] === undefined) return raw || "none";
  return raw;
}

const MANAGEABLE_ROLES = [
  "agent",
  "office_assistant",
  "quality",
  "rtm",
  "tl",
  "op",
  "finance",
  "hr",
  "admin",
  "ceo",
];

const ADMIN_ROLES = ["admin", "ceo"];
const MANAGE_ROLES = ["admin", "ceo", "hr"];
const ALL_UNIT_ROLES = ["admin", "ceo", "hr", "finance"];
const BONUS_VIEW_ROLES = [
  "agent",
  "office_assistant",
  "quality",
  "rtm",
  "tl",
  "op",
  "finance",
  "hr",
  "admin",
  "ceo",
];
const TRANSFER_BONUS_ROLES = ["tl", "op", "quality", "rtm"];
const BONUS_REQUEST_SUBMIT_ROLES = ["tl", "op", "admin", "hr", "quality", "rtm"];
const ORG_STRUCTURE_ROLES = ["admin", "ceo", "hr"];
const NOTES_VIEW_ROLES = ["hr", "admin", "ceo"];
const NOTES_WRITE_ROLES = ["tl", "op", "quality", "hr", "admin", "ceo", "rtm"];
const EQUIPMENT_VIEW_ROLES = ["tl", "op", "hr", "admin", "ceo", "finance", "rtm", "quality"];
const DASHBOARD_PAYROLL_ROLES = ["finance", "hr", "admin", "ceo"];
const DASHBOARD_FULL_ROLES = ["tl", "op", "hr", "admin", "ceo", "finance", "rtm", "quality"];
const FINANCE_ACCESS_USERS = ["mark", "phoebe", "raymond"];

function roleIs(role, list) {
  return list.includes(normalizeRole(role));
}

function defaultForRole(role, userRole) {
  const r = normalizeRole(role);
  const u = userRole || { role: r, username: null };
  return {
    viewPayroll: (ROLE_RANK[r] || 0) >= ROLE_RANK.finance,
    viewBonuses: roleIs(r, BONUS_VIEW_ROLES),
    viewSales: (ROLE_RANK[r] || 0) >= ROLE_RANK.agent,
    viewEquipment: roleIs(r, EQUIPMENT_VIEW_ROLES),
    viewDashboardPayroll: roleIs(r, DASHBOARD_PAYROLL_ROLES),
    viewDashboardFull: roleIs(r, DASHBOARD_FULL_ROLES),
    exportSales: r !== "agent" && r !== "office_assistant" && (ROLE_RANK[r] || 0) >= ROLE_RANK.agent,
    useEmployeeFilters: r !== "agent" && r !== "office_assistant",
    manageEmployees: roleIs(r, MANAGE_ROLES),
    addEmployee: roleIs(r, MANAGE_ROLES),
    editEmployeeRecord: roleIs(r, MANAGE_ROLES),
    viewEmployeeNotes: roleIs(r, NOTES_VIEW_ROLES),
    writeEmployeeNotes: roleIs(r, NOTES_WRITE_ROLES),
    viewEmployeeDirectory: (ROLE_RANK[r] || 0) >= ROLE_RANK.agent,
    manageOrgStructure: roleIs(r, ORG_STRUCTURE_ROLES),
    viewOrgFull:
      roleIs(r, MANAGE_ROLES) ||
      roleIs(r, ALL_UNIT_ROLES) ||
      ["tl", "op", "rtm", "quality"].includes(r),
    editSales: ["hr", "admin", "ceo", "quality", "rtm", "op"].includes(r),
    grantSalesVisibility: ["op", "admin", "ceo", "hr", "rtm"].includes(r),
    manageSalesFieldPermissions: ["admin", "ceo", "rtm", "hr"].includes(r),
    editAttendance: roleIs(r, MANAGE_ROLES) || r === "tl",
    transferBonus: roleIs(r, MANAGE_ROLES) || roleIs(r, TRANSFER_BONUS_ROLES),
    submitBonusRequest: roleIs(r, BONUS_REQUEST_SUBMIT_ROLES),
    approveBonusRequest: roleIs(r, MANAGE_ROLES) || roleIs(r, ADMIN_ROLES),
    accessCostsFull:
      roleIs(r, ["finance"]) ||
      roleIs(r, ADMIN_ROLES) ||
      FINANCE_ACCESS_USERS.includes(String(u.username || "").trim().toLowerCase()),
    submitExpense:
      roleIs(r, ["finance"]) ||
      roleIs(r, ADMIN_ROLES) ||
      FINANCE_ACCESS_USERS.includes(String(u.username || "").trim().toLowerCase()) ||
      r === "hr" ||
      r === "rtm",
    settingsHolidays: roleIs(r, MANAGE_ROLES),
    settingsSession: roleIs(r, MANAGE_ROLES) || roleIs(r, ADMIN_ROLES),
    settingsHideOut: roleIs(r, MANAGE_ROLES),
    settingsSync: (ROLE_RANK[r] || 0) >= ROLE_RANK.agent,
    settingsTheme: (ROLE_RANK[r] || 0) >= ROLE_RANK.agent,
    settingsProfilePhoto: Boolean(u.employeeId),
  };
}

const PERMISSIONS = [
  { key: "viewPayroll", label: "View payroll", category: "Pages", description: "Payroll page and payroll data" },
  { key: "viewBonuses", label: "View bonuses", category: "Pages", description: "Bonuses page" },
  { key: "viewSales", label: "View sales log", category: "Pages", description: "Sales log navigation and list" },
  { key: "viewEquipment", label: "View equipment", category: "Pages", description: "Equipment page" },
  { key: "viewDashboardPayroll", label: "Dashboard payroll stats", category: "Dashboard", description: "Net payroll and company-wide payroll widgets" },
  { key: "viewDashboardFull", label: "Dashboard full widgets", category: "Dashboard", description: "Team/company dashboard widgets beyond agent scope" },
  { key: "exportSales", label: "Export sales", category: "Sales", description: "Download sales CSV/export" },
  { key: "useEmployeeFilters", label: "Employee search filters", category: "Employees", description: "Filter/search toolbar on employees page" },
  { key: "manageEmployees", label: "Manage employees", category: "Employees", description: "HR-level employee management" },
  { key: "addEmployee", label: "Add employee", category: "Employees", description: "Create new employee records" },
  { key: "editEmployeeRecord", label: "Edit employee records", category: "Employees", description: "Open and save employee edit modal" },
  { key: "viewEmployeeNotes", label: "View employee notes", category: "Employees", description: "Read HR notes on employee cards" },
  { key: "writeEmployeeNotes", label: "Write employee notes", category: "Employees", description: "Add notes without necessarily reading history" },
  { key: "viewEmployeeDirectory", label: "View employee directory", category: "Employees", description: "Employees page access" },
  { key: "manageOrgStructure", label: "Manage org structure", category: "Organization", description: "Create/edit teams, relocate agents" },
  { key: "viewOrgFull", label: "View full org tree", category: "Organization", description: "Full organization page (non-agent scope)" },
  { key: "editSales", label: "Edit sales records", category: "Sales", description: "Create/update sales entries" },
  { key: "grantSalesVisibility", label: "Grant sales visibility", category: "Sales", description: "Temporary wider sales view grants" },
  { key: "manageSalesFieldPermissions", label: "Manage sales column permissions", category: "Sales", description: "Configure sales form field visibility (separate modal)" },
  { key: "editAttendance", label: "Edit attendance", category: "Payroll", description: "Modify attendance records" },
  { key: "transferBonus", label: "Transfer bonus", category: "Payroll", description: "TL/OP bonus transfer actions" },
  { key: "submitBonusRequest", label: "Submit bonus request", category: "Payroll", description: "Submit bonus requests for approval" },
  { key: "approveBonusRequest", label: "Approve bonus request", category: "Payroll", description: "Approve/reject bonus requests" },
  { key: "accessCostsFull", label: "Full costs access", category: "Costs", description: "Costs page with full finance view" },
  { key: "submitExpense", label: "Submit expense", category: "Costs", description: "Submit expense entries" },
  { key: "settingsHolidays", label: "Settings: holidays", category: "Settings", description: "Holiday management in settings" },
  { key: "settingsSession", label: "Settings: session ID", category: "Settings", description: "View/copy session ID in settings" },
  { key: "settingsHideOut", label: "Settings: hide out employees", category: "Settings", description: "Toggle hide-out-employees preference" },
  { key: "settingsSync", label: "Settings: sync", category: "Settings", description: "Sync controls in settings" },
  { key: "settingsTheme", label: "Settings: theme", category: "Settings", description: "Theme selection" },
  { key: "settingsProfilePhoto", label: "Settings: profile photo", category: "Settings", description: "Upload profile photo (requires linked employee)" },
];

function listPermissions() {
  return PERMISSIONS.slice();
}

function getPermission(key) {
  return PERMISSIONS.find((p) => p.key === key) || null;
}

function getDefaultMatrix() {
  const matrix = {};
  for (const role of MANAGEABLE_ROLES) {
    matrix[role] = defaultForRole(role, { role, username: null, employeeId: role === "agent" ? "x" : null });
  }
  return matrix;
}

function getDefaultForRole(role, userRole) {
  return defaultForRole(role, userRole);
}

function listCategories() {
  return [...new Set(PERMISSIONS.map((p) => p.category))];
}

module.exports = {
  MANAGEABLE_ROLES,
  PERMISSIONS,
  listPermissions,
  getPermission,
  getDefaultMatrix,
  getDefaultForRole,
  listCategories,
  defaultForRole,
};

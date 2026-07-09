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
  public_relations: 1,
  tl: 2,
  op: 2,
  finance: 3,
  it: 4,
  hr: 4,
  admin: 5,
  ceo: 6,
};

const ROLE_ALIASES = {
  administrator: "admin",
  owner: "admin",
  superadmin: "admin",
  "chief executive": "ceo",
  "chief executive officer": "ceo",
  founder: "ceo",
  manager: "hr",
  "human resources": "hr",
  accountant: "finance",
  finances: "finance",
  payroll: "finance",
  "team lead": "tl",
  teamlead: "tl",
  "team leader": "tl",
  team_leader: "tl",
  leader: "tl",
  supervisor: "tl",
  employee: "agent",
  user: "agent",
  staff: "agent",
  "op manager": "op",
  operations: "op",
  "quality agent": "quality",
  qa: "quality",
  "office assistant": "office_assistant",
  assistant: "office_assistant",
  "public relations": "public_relations",
  pr: "public_relations",
  "information technology": "it",
  tech: "it",
};

function normalizeRole(role) {
  const raw = String(role || "").trim().toLowerCase();
  if (!raw) return "none";
  if (ROLE_RANK[raw] !== undefined && raw !== "none") return raw;
  if (ROLE_ALIASES[raw]) return ROLE_ALIASES[raw];
  return raw;
}

const MANAGEABLE_ROLES = [
  "agent",
  "office_assistant",
  "quality",
  "rtm",
  "public_relations",
  "tl",
  "op",
  "finance",
  "it",
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
const QUALITY_NOTES_VIEW_ROLES = ["hr", "admin", "ceo", "quality", "rtm", "tl", "op"];
const QUALITY_NOTES_WRITE_ROLES = ["quality", "tl", "op", "hr", "admin", "ceo", "rtm"];
const EQUIPMENT_ALL_ROLES = ["it", "hr", "admin", "ceo"];
const EQUIPMENT_UNIT_ROLES = ["op"];
const TL_OP_BONUS_TRANSFER_VIEW_ROLES = ["tl", "op", "hr", "admin", "ceo", "rtm"];
const REPORTS_VIEW_ROLES = ["finance", "hr", "admin", "ceo"];
const SALES_ADMIN_ROLES = ["admin", "ceo", "rtm"];
const DASHBOARD_PAYROLL_ROLES = ["finance", "hr", "admin", "ceo"];
const DASHBOARD_FULL_ROLES = ["tl", "op", "hr", "admin", "ceo", "finance", "rtm", "quality"];
const QUALITY_TICKET_ROLES = ["quality", "rtm", "admin", "ceo", "public_relations"];
const SUBMIT_SALES_ROLES = ["agent", "tl", "op", "admin", "ceo", "hr", "rtm", "quality", "public_relations"];
const FINANCE_ACCESS_USERS = ["mark", "phoebe", "raymond"];
const DASHBOARD_UNITS_ROLES = ["hr", "rtm", "admin", "ceo", "quality"];
const HS2_MANAGE_ROLES = ["admin", "ceo", "hr"];
const HS2_SALES_ROLES = ["admin", "ceo", "hr", "quality"];
const EXPORT_SALES_ROLES = ["quality", "rtm", "ceo", "admin"];
const APPROVE_SALES_ROLES = ["quality", "rtm", "admin", "ceo", "hr"];
const ISSUE_EQUIPMENT_ROLES = ["it", "hr", "admin", "ceo"];

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
    viewEquipment:
      roleIs(r, EQUIPMENT_ALL_ROLES) ||
      roleIs(r, EQUIPMENT_UNIT_ROLES) ||
      ((ROLE_RANK[r] || 0) >= ROLE_RANK.agent && r !== "finance"),
    viewEquipmentAll: roleIs(r, EQUIPMENT_ALL_ROLES),
    viewEquipmentUnit: roleIs(r, EQUIPMENT_UNIT_ROLES),
    issueEquipment: roleIs(r, ISSUE_EQUIPMENT_ROLES),
    viewDashboardPayroll: roleIs(r, DASHBOARD_PAYROLL_ROLES),
    viewDashboardFull: roleIs(r, DASHBOARD_FULL_ROLES),
    viewDashboardUnits: roleIs(r, DASHBOARD_UNITS_ROLES),
    manageHs2Company: roleIs(r, HS2_MANAGE_ROLES),
    seeHs2InSales: roleIs(r, HS2_SALES_ROLES),
    viewTeamDashboard: (ROLE_RANK[r] || 0) >= ROLE_RANK.agent,
    exportSales: roleIs(r, EXPORT_SALES_ROLES),
    useEmployeeFilters: roleIs(r, MANAGE_ROLES),
    viewEmployeeComplianceFilters: roleIs(r, MANAGE_ROLES),
    viewEmployeeNationality: roleIs(r, MANAGE_ROLES),
    viewEmployeeCompliance: roleIs(r, MANAGE_ROLES),
    manageEmployees: roleIs(r, MANAGE_ROLES),
    addEmployee: roleIs(r, MANAGE_ROLES),
    editEmployeeRecord: roleIs(r, MANAGE_ROLES),
    viewEmployeeNotes: roleIs(r, NOTES_VIEW_ROLES),
    writeEmployeeNotes: roleIs(r, NOTES_WRITE_ROLES),
    viewQualityNotes: roleIs(r, QUALITY_NOTES_VIEW_ROLES),
    writeQualityNotes: roleIs(r, QUALITY_NOTES_WRITE_ROLES),
    viewEmployeeDirectory: (ROLE_RANK[r] || 0) >= ROLE_RANK.agent,
    manageOrgStructure: roleIs(r, ORG_STRUCTURE_ROLES),
    viewOrgFull:
      roleIs(r, MANAGE_ROLES) ||
      roleIs(r, ALL_UNIT_ROLES) ||
      ["rtm", "quality"].includes(r),
    editSales: ["hr", "admin", "ceo", "quality", "rtm", "public_relations"].includes(r),
    viewSale: (ROLE_RANK[r] || 0) >= ROLE_RANK.agent,
    approveSales: roleIs(r, APPROVE_SALES_ROLES),
    submitSales: roleIs(r, SUBMIT_SALES_ROLES),
    workQualityTicket: roleIs(r, QUALITY_TICKET_ROLES),
    deleteSales: ["admin", "rtm"].includes(r),
    reassignSaleLead: ["admin", "rtm", "ceo"].includes(r),
    grantSalesVisibility: ["op", "admin", "ceo", "hr", "rtm"].includes(r),
    manageSalesFieldPermissions: roleIs(r, SALES_ADMIN_ROLES),
    viewSalesAdmin: roleIs(r, SALES_ADMIN_ROLES),
    editAttendance: roleIs(r, MANAGE_ROLES),
    viewTransportControls: roleIs(r, MANAGE_ROLES),
    viewBonusTransferSource: roleIs(r, MANAGE_ROLES),
    viewTlOpBonusTransfers: roleIs(r, TL_OP_BONUS_TRANSFER_VIEW_ROLES),
    viewReports: roleIs(r, REPORTS_VIEW_ROLES),
    manageAppUsers: false,
    manageAccessControl: roleIs(r, ADMIN_ROLES),
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
    settingsManagingUnits: roleIs(r, MANAGE_ROLES),
    manageCompanies: roleIs(r, ADMIN_ROLES),
    manageTrainingProgram: roleIs(r, MANAGE_ROLES),
    viewTrainingPayPreview: roleIs(r, MANAGE_ROLES) || roleIs(r, ["finance"]),
    approveTrainingPayslip: roleIs(r, MANAGE_ROLES) || roleIs(r, ["finance"]),
    manageResignationPayRules: roleIs(r, MANAGE_ROLES),
    approveLeave: roleIs(r, MANAGE_ROLES) || ADMIN_ROLES.includes(r),
    viewRules: roleIs(r, ["agent", "tl", "op", "quality", "rtm", "admin", "ceo", "hr", "finance", "public_relations"]),
    editRules: roleIs(r, ADMIN_ROLES) || r === "hr",
    viewItRequests: roleIs(r, ["it", "admin", "ceo"]) || Boolean(u.employeeId),
    submitItRequest: Boolean(u.employeeId),
    assignItRequest: roleIs(r, ["it", "admin", "ceo", "rtm"]),
    resolveItRequest: roleIs(r, ["it", "admin", "ceo"]),
    deleteItRequest: roleIs(r, ["admin", "ceo"]) || Boolean(u.isIt),
    viewMeetingRequests: roleIs(r, ["admin", "ceo", "hr"]) || Boolean(u.employeeId),
    submitMeetingRequest: Boolean(u.employeeId),
    reviewMeetingRequest: roleIs(r, ["admin", "ceo", "hr"]),
  };
}

const PERMISSIONS = [
  { key: "viewPayroll", label: "View payroll", category: "Pages", description: "Payroll page and payroll data" },
  { key: "viewBonuses", label: "View bonuses", category: "Pages", description: "Bonuses page" },
  { key: "viewSales", label: "View sales log", category: "Pages", description: "Sales log navigation and list" },
  { key: "viewEquipment", label: "View equipment", category: "Pages", description: "Equipment page (full, unit, or own device)" },
  { key: "viewEquipmentAll", label: "View all equipment", category: "Pages", description: "Full equipment inventory (IT/HR/Admin)" },
  { key: "viewEquipmentUnit", label: "View unit equipment", category: "Pages", description: "Equipment for own unit only (OP)" },
  { key: "issueEquipment", label: "Issue equipment", category: "Pages", description: "Assign devices to employees" },
  { key: "viewReports", label: "View reports", category: "Pages", description: "Monthly HR reports page" },
  { key: "viewSalesAdmin", label: "Sales permissions admin", category: "Sales", description: "Sales permissions and log columns navigation" },
  { key: "viewTransportControls", label: "Transport allowance controls", category: "Payroll", description: "No/half/full transport dropdown on attendance" },
  { key: "viewBonusTransferSource", label: "View bonus transfer source", category: "Payroll", description: "See which agent a TL bonus was deducted from" },
  { key: "viewTlOpBonusTransfers", label: "View TL/OP bonus transfers", category: "Payroll", description: "TL/OP bonus transfer deductions section" },
  { key: "viewEmployeeNationality", label: "View employee nationality", category: "Employees", description: "Nationality column and form field" },
  { key: "viewEmployeeCompliance", label: "View permit / insurance", category: "Employees", description: "Work permit and insurance fields" },
  { key: "viewEmployeeComplianceFilters", label: "Compliance filters", category: "Employees", description: "Nationality, work permit, and insurance filter dropdowns" },
  { key: "manageAppUsers", label: "Manage app users", category: "Admin", description: "App Users page and user management" },
  { key: "viewDashboardPayroll", label: "Dashboard payroll stats", category: "Dashboard", description: "Net payroll and company-wide payroll widgets" },
  { key: "viewDashboardFull", label: "Dashboard full widgets", category: "Dashboard", description: "Team/company dashboard widgets beyond agent scope" },
  { key: "viewDashboardUnits", label: "Dashboard unit filters", category: "Dashboard", description: "Show HS-1/HS-3 unit toggles on sales (HS-2 only with seeHs2InSales)" },
  { key: "manageHs2Company", label: "Manage HS-2 company", category: "Organization", description: "HS-2 sidebar switcher, org, payroll, and roster for HS-2" },
  { key: "seeHs2InSales", label: "HS-2 in sales", category: "Sales", description: "See HS-2 unit in sales log and quality work" },
  { key: "viewTeamDashboard", label: "Team dashboards", category: "Dashboard", description: "Team sales dashboard navigation and data" },
  { key: "exportSales", label: "Export sales", category: "Sales", description: "Download sales CSV/export" },
  { key: "useEmployeeFilters", label: "Employee search filters", category: "Employees", description: "Filter/search toolbar on employees page" },
  { key: "manageEmployees", label: "Manage employees", category: "Employees", description: "HR-level employee management" },
  { key: "addEmployee", label: "Add employee", category: "Employees", description: "Create new employee records" },
  { key: "editEmployeeRecord", label: "Edit employee records", category: "Employees", description: "Open and save employee edit modal" },
  { key: "viewEmployeeNotes", label: "View employee notes", category: "Employees", description: "Read HR notes on employee cards" },
  { key: "writeEmployeeNotes", label: "Write employee notes", category: "Employees", description: "Add notes without necessarily reading history" },
  { key: "viewQualityNotes", label: "View quality notes", category: "Sales", description: "Read quality ticket notes on sales" },
  { key: "writeQualityNotes", label: "Write quality notes", category: "Sales", description: "Add or edit quality ticket notes" },
  { key: "viewEmployeeDirectory", label: "View employee directory", category: "Employees", description: "Employees page access" },
  { key: "manageOrgStructure", label: "Manage org structure", category: "Organization", description: "Create/edit teams, relocate agents" },
  { key: "viewOrgFull", label: "View full org tree", category: "Organization", description: "Full organization page (non-agent scope)" },
  { key: "editSales", label: "Edit sales records", category: "Sales", description: "Create/update sales entries (full sale form)" },
  { key: "viewSale", label: "View sale", category: "Sales", description: "Open read-only sale detail (fields follow Sales permissions)" },
  { key: "approveSales", label: "Approve / deny / callback sales", category: "Sales", description: "Review actions on pending sales" },
  { key: "submitSales", label: "Submit new sale", category: "Sales", description: "Create new sales log entries" },
  { key: "workQualityTicket", label: "Quality ticket", category: "Sales", description: "Open quality ticket workflow on sales (uses column permissions for fields)" },
  { key: "deleteSales", label: "Delete sales", category: "Sales", description: "Permanently delete a sale and its attachments" },
  { key: "reassignSaleLead", label: "Reassign agent/closer", category: "Sales", description: "Change unit, team, agent, or closer on edit and quality ticket" },
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
  { key: "settingsManagingUnits", label: "Settings: managing units", category: "Settings", description: "Manage OP, HR, Quality assignments per unit" },
  { key: "manageCompanies", label: "Manage companies", category: "Settings", description: "Add/edit companies and per-company access control" },
  { key: "manageTrainingProgram", label: "Manage training program", category: "Payroll", description: "Start/update phases, set outcomes, promote to Agent" },
  { key: "viewTrainingPayPreview", label: "View training pay preview", category: "Payroll", description: "See training pay breakdown on HR panel" },
  { key: "approveTrainingPayslip", label: "Approve training payslip", category: "Payroll", description: "Release training payslip to agent" },
  { key: "manageResignationPayRules", label: "Manage resignation pay rules", category: "Payroll", description: "Apply notice-period pay scale / no-notice deduction" },
  { key: "approveLeave", label: "Approve leave requests", category: "Pages", description: "Approve, reject, and delete leave/day-off requests (default: HR, Admin, CEO)" },
  { key: "manageAccessControl", label: "Manage Access Control", category: "Admin", description: "Access Control page — role permission overrides" },
  { key: "viewRules", label: "View company rules", category: "Pages", description: "Company rules / policy page navigation" },
  { key: "editRules", label: "Edit company rules", category: "Pages", description: "Modify company rules content" },
  { key: "viewItRequests", label: "View IT requests", category: "Pages", description: "IT requests list and details (all: IT/Admin/CEO, own: all)" },
  { key: "submitItRequest", label: "Submit IT request", category: "Pages", description: "Create new IT requests" },
  { key: "assignItRequest", label: "Assign IT request", category: "Pages", description: "Assign IT requests to staff" },
  { key: "resolveItRequest", label: "Resolve IT request", category: "Pages", description: "Mark IT requests resolved/closed" },
  { key: "deleteItRequest", label: "Delete IT request", category: "Pages", description: "Permanently delete IT tickets (Admin/CEO or users marked as IT)" },
  { key: "viewMeetingRequests", label: "View meeting requests", category: "Pages", description: "Meeting requests list (all: Admin/CEO/HR, own: all)" },
  { key: "submitMeetingRequest", label: "Submit meeting request", category: "Pages", description: "Create new meeting requests" },
  { key: "reviewMeetingRequest", label: "Review meeting request", category: "Pages", description: "Approve/reject/reschedule meeting requests" },
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

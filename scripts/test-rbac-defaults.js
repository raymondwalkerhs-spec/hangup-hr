/** Smoke-test RBAC legacy fallbacks match catalog (ignores DB overrides). */
const roles = require("../lib/roles");
const catalog = require("../lib/permission-catalog");
const rolePermissions = require("../lib/role-permissions");

const CHECKS = [
  ["viewPayroll", (ur) => roles.canViewPayroll(ur)],
  ["viewBonuses", (ur) => roles.canViewBonusesDeductions(ur)],
  ["viewSales", (ur) => roles.canViewSales(ur)],
  ["viewEquipment", (ur) => roles.canViewEquipment(ur)],
  ["manageOrgStructure", (ur) => roles.canManageOrgStructure(ur)],
  ["manageEmployees", (ur) => roles.canManageEmployees(ur)],
  ["exportSales", (ur) => roles.canExportSales(ur)],
  ["approveSales", (ur) => roles.canApproveSales(ur)],
  ["viewDashboardUnits", (ur) => roles.canViewDashboardUnits(ur)],
  ["viewTeamDashboard", (ur) => roles.canViewTeamDashboard(ur)],
  ["issueEquipment", (ur) => roles.canIssueEquipment(ur)],
  ["editSales", (ur) => roles.canEditSale(ur)],
  ["viewSale", (ur) => roles.canViewSale(ur)],
  ["submitSales", (ur) => roles.canSubmitSales(ur)],
  ["workQualityTicket", (ur) => roles.canWorkQualityTicket(ur)],
  ["grantSalesVisibility", (ur) => roles.canGrantSalesVisibility(ur)],
  ["viewQualityNotes", (ur) => roles.canViewQualityNotes(ur)],
  ["writeQualityNotes", (ur) => roles.canWriteQualityNotes(ur)],
  ["writeEmployeeNotes", (ur) => roles.canWriteEmployeeNotes(ur)],
  ["manageHs2Company", (ur) => roles.canManageHs2Company(ur)],
  ["seeHs2InSales", (ur) => roles.canSeeHs2InSales(ur)],
  ["manageSalesFieldPermissions", (ur) => roles.canManageSalesFieldPermissions(ur)],
];

function main() {
  rolePermissions.resetOverridesForTest();

  let failures = 0;
  for (const role of catalog.MANAGEABLE_ROLES) {
    const ur = {
      role,
      username: `__rbac_test_${role}__`,
      employeeId: "TEST-001",
    };
    const defaults = catalog.defaultForRole(role, ur);
    for (const [key, fn] of CHECKS) {
      const expected = defaults[key];
      const actual = fn(ur);
      if (Boolean(expected) !== Boolean(actual)) {
        console.error(`FAIL ${role}.${key}: expected ${expected}, got ${actual}`);
        failures += 1;
      }
    }
    if (!roles.hasAppAccess(ur)) {
      console.error(`FAIL ${role}: hasAppAccess should be true for manageable roles`);
      failures += 1;
    }
  }

  if (failures) {
    console.error(`${failures} failure(s)`);
    process.exit(1);
  }
  console.log("RBAC default parity OK for", catalog.MANAGEABLE_ROLES.length, "roles");
  console.log("hasAppAccess unchanged for all manageable roles");
}

main();

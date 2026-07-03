#!/usr/bin/env node
/** Smoke-test RBAC defaults match catalog (empty overrides). */
require("dotenv").config();
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
  ["editSales", (ur) => roles.canEditSale(ur)],
  ["manageSalesFieldPermissions", (ur) => roles.canManageSalesFieldPermissions(ur)],
];

async function main() {
  await rolePermissions.loadOverrides(true);
  const overrides = rolePermissions.getCachedOverrides();
  if (overrides.size > 0) {
    console.warn(`Note: ${overrides.size} DB override(s) present — default parity checks may differ.`);
  }

  let failures = 0;
  for (const role of catalog.MANAGEABLE_ROLES) {
    const ur = { role, username: role === "finance" ? "test" : null, employeeId: role === "agent" ? "x" : null };
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

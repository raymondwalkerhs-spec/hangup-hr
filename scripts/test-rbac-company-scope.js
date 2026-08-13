/**
 * Verify RBAC overrides respect per-company context on userRole.company.
 */
const roles = require("../lib/roles");
const rolePermissions = require("../lib/role-permissions");

const PERM = "viewPayroll";

function main() {
  rolePermissions.resetOverridesForTest();
  const map = rolePermissions.getCachedOverrides();
  map.set("hangup::hr::viewPayroll", false);
  map.set("hs2::hr::viewPayroll", true);

  const hangupHr = { role: "hr", username: "hr_hangup", company: "hangup" };
  const hs2Hr = { role: "hr", username: "hr_hs2", company: "hs2" };
  const hangupNoCompany = { role: "hr", username: "hr_unit", unit: "Main Office" };

  let failures = 0;
  const checks = [
    ["hangup HR denied when override false", hangupHr, roles.canViewPayroll, false],
    ["hs2 HR allowed when override true", hs2Hr, roles.canViewPayroll, true],
    ["company on userRole wins over unit fallback", { ...hangupNoCompany, company: "hs2" }, roles.canViewPayroll, true],
    ["without company uses hangup override", hangupNoCompany, roles.canViewPayroll, false],
  ];

  for (const [label, ur, fn, expected] of checks) {
    const actual = fn(ur);
    if (Boolean(actual) !== Boolean(expected)) {
      console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
      failures += 1;
    }
  }

  if (failures) {
    console.error(`${failures} failure(s)`);
    process.exit(1);
  }
  console.log("RBAC company scope OK");
}

main();

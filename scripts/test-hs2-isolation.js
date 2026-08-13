#!/usr/bin/env node
/** HS-2 company isolation regression tests (no DB). */
const assert = require("assert");
const roles = require("../lib/roles");
const companyContext = require("../lib/company-context");

function ok(name, cond) {
  if (!cond) {
    console.error("FAIL", name);
    process.exitCode = 1;
    return;
  }
  console.log("  ok", name);
}

const admin = { role: "admin", username: "admin" };
const hr = { role: "hr", username: "hr" };
const quality = { role: "quality", username: "qa1" };
const agent = { role: "agent", username: "agent1", unit: "HS-1" };
const hs2Agent = { role: "agent", username: "hs2a1", unit: "HS-2" };

console.log("hs2-isolation");

ok("admin can access HS2 context", roles.canAccessHs2CompanyContext(admin));
ok("hr can access HS2 context", roles.canAccessHs2CompanyContext(hr));
ok("quality cannot access HS2 context", !roles.canAccessHs2CompanyContext(quality));
ok("main hangup agent cannot access HS2 context", !roles.canAccessHs2CompanyContext(agent));
ok("native HS2 agent can access HS2 context", roles.canAccessHs2CompanyContext(hs2Agent));

ok(
  "agent cannot resolve hs2 from query",
  companyContext.resolveCompanyContextForUser("hs2", agent) === "hangup"
);
ok(
  "quality cannot resolve hs2 from query",
  companyContext.resolveCompanyContextForUser("hs2", quality) === "hangup"
);
ok(
  "admin resolves hs2 from query",
  companyContext.resolveCompanyContextForUser("hs2", admin) === "hs2"
);
ok(
  "HS2 agent auto-resolves to hs2",
  companyContext.resolveCompanyContextForUser(undefined, hs2Agent) === "hs2"
);

const employees = [
  { id: "HS1-01", unit: "HS-1", team: "A" },
  { id: "HS2-01", unit: "HS-2", team: "HS2" },
];
const hangupEmps = companyContext.filterEmployeesByCompany(employees, "hangup");
ok("hangup context hides HS2 employees", hangupEmps.length === 1 && hangupEmps[0].id === "HS1-01");
const hs2Emps = companyContext.filterEmployeesByCompany(employees, "hs2");
ok("hs2 context keeps HS2 employees", hs2Emps.length === 1 && hs2Emps[0].id === "HS2-01");

const sales = [
  { id: "s1", unit: "HS-1" },
  { id: "s2", unit: "HS-2" },
];
const hangupSales = companyContext.filterSalesByCompanyContext(sales, "hangup");
ok(
  "strict: hangup strips HS2 sales even for quality role",
  hangupSales.length === 1 && hangupSales[0].unit === "HS-1"
);
const hs2Sales = companyContext.filterSalesByCompanyContext(sales, "hs2");
ok(
  "hs2 context keeps only HS2 sales",
  hs2Sales.length === 1 && hs2Sales[0].unit === "HS-2"
);

const hangupAdjIds = new Set(
  companyContext.filterEmployeesByCompany(employees, "hangup").map((e) => e.id)
);
ok(
  "hangup payroll filter excludes HS2 employee ids",
  !hangupAdjIds.has("HS2-01") && hangupAdjIds.has("HS1-01")
);

ok("raymond can manage app users across companies", roles.canManageAppUsers("raymond"));
ok(
  "HS-2 management ID is out of hangup user-edit scope",
  !companyContext.employeeInCompanyContext({ id: "MG2", unit: "HS-2", team: "HS2" }, "hangup")
);
ok(
  "HS-2 management ID is in hs2 user-edit scope",
  companyContext.employeeInCompanyContext({ id: "MG2", unit: "HS-2", team: "HS2" }, "hs2")
);

const scopedConfig = require("../lib/company-scoped-config");
ok(
  "hangup tax rules fall back to legacy taxRules",
  scopedConfig.getTaxRules({ taxRules: { incomeTaxRate: 7, socialInsuranceRate: 3 } }, "hangup").incomeTaxRate === 7
);
ok(
  "hs2 tax rules default when unset",
  scopedConfig.getTaxRules({ taxRules: { incomeTaxRate: 7, socialInsuranceRate: 3 } }, "hs2").incomeTaxRate === 0
);
ok(
  "hs2 tax rules read from taxRulesByCompany",
  scopedConfig.getTaxRules(
    { taxRulesByCompany: { hs2: { incomeTaxRate: 12, socialInsuranceRate: 1 } } },
    "hs2"
  ).incomeTaxRate === 12
);

const registrationCodes = require("../lib/registration-codes");
const { createRegistrationToken, verifyRegistrationToken } = require("../lib/registration-token");

ok("registration code format", registrationCodes.formatRegistrationCode("K7H2", "1234") === "K7H2-1234");
const parsed = registrationCodes.parseRegistrationCodeInput("K7H2-1234");
ok("parse org registration code", parsed?.orgCode === "K7H2" && parsed?.pin === "1234");
ok("token round-trip", verifyRegistrationToken(createRegistrationToken("hs2")) === "hs2");

if (!process.exitCode) console.log("\nregistration-code tests passed.");

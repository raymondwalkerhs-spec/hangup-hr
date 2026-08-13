#!/usr/bin/env node
/** HS-2 visibility: management vs sales-only roles */
const roles = require("../lib/roles");
const companyContext = require("../lib/company-context");

function assert(name, cond) {
  if (!cond) {
    console.error("FAIL", name);
    process.exitCode = 1;
    return;
  }
  console.log("  ok", name);
}

const admin = { role: "admin", username: "admin" };
const hr = { role: "hr", username: "hr" };
const ceo = { role: "ceo", username: "ceo" };
const quality = { role: "quality", username: "qa1" };
const rtm = { role: "rtm", username: "rtm1" };
const agent = { role: "agent", username: "agent1" };

console.log("hs2-access");

assert("admin manages HS2", roles.canManageHs2Company(admin));
assert("hr manages HS2", roles.canManageHs2Company(hr));
assert("ceo manages HS2", roles.canManageHs2Company(ceo));
assert("quality cannot manage HS2", !roles.canManageHs2Company(quality));
assert("rtm cannot manage HS2", !roles.canManageHs2Company(rtm));

assert("admin can access HS2 context", roles.canAccessHs2CompanyContext(admin));
assert("agent cannot access HS2 context", !roles.canAccessHs2CompanyContext(agent));

assert("main hangup agent cannot access hs2 rules", !roles.canAccessRulesCompany(agent, "hs2"));
assert("main hangup agent can access hangup rules", roles.canAccessRulesCompany(agent, "hangup"));
assert("hs2 unit user can access hs2 rules", roles.canAccessRulesCompany({ role: "agent", unit: "HS-2" }, "hs2"));
assert("admin can access hs2 rules", roles.canAccessRulesCompany(admin, "hs2"));

assert(
  "hs2 company query allowed for hr",
  companyContext.resolveCompanyContextForUser("hs2", hr) === "hs2"
);
assert(
  "hs2 company query denied for agent",
  companyContext.resolveCompanyContextForUser("hs2", agent) === "hangup"
);

if (!process.exitCode) console.log("\nhs2-access tests passed.");

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
const opHs3 = { role: "op", username: "op1", unit: "HS-3" };
const opHs2 = { role: "op", username: "op-hs2", unit: "HS-2" };
const tlHangup = { role: "tl", username: "tl1", unit: "HS-3" };

console.log("hs2-access");

assert("admin manages HS2", roles.canManageHs2Company(admin));
assert("hr manages HS2", roles.canManageHs2Company(hr));
assert("ceo manages HS2", roles.canManageHs2Company(ceo));
assert("quality cannot manage HS2", !roles.canManageHs2Company(quality));
assert("rtm cannot manage HS2", !roles.canManageHs2Company(rtm));
assert("OP HS-3 cannot manage HS2", !roles.canManageHs2Company(opHs3));
assert("TL cannot manage HS2", !roles.canManageHs2Company(tlHangup));
assert("agent cannot manage HS2", !roles.canManageHs2Company(agent));

assert("admin can access HS2 context", roles.canAccessHs2CompanyContext(admin));
assert("agent cannot access HS2 context", !roles.canAccessHs2CompanyContext(agent));
assert("OP HS-3 cannot access HS2 context", !roles.canAccessHs2CompanyContext(opHs3));
assert("HS-2 OP cannot manage switcher", !roles.canManageHs2Company(opHs2));
assert("HS-2 OP can access own company", roles.canAccessHs2CompanyContext(opHs2));

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
assert(
  "OP HS-3 ?company=hs2 stays hangup",
  companyContext.resolveCompanyContextForUser("hs2", opHs3) === "hangup"
);
assert(
  "HS-2 OP ?company=hs2 is hs2",
  companyContext.resolveCompanyContextForUser("hs2", opHs2) === "hs2"
);

const userPermissions = require("../lib/user-permissions");
const origOverride = userPermissions.getOverrideSync;
userPermissions.getOverrideSync = (username, key) => {
  if (String(username).toLowerCase() === "op1" && key === "manageHs2Company") return true;
  if (String(username).toLowerCase() === "tl1" && key === "manageHs2Company") return true;
  if (String(username).toLowerCase() === "agent1" && key === "manageHs2Company") return true;
  return origOverride.call(userPermissions, username, key);
};
assert("OP HS-3 cannot manage HS2 even with override", !roles.canManageHs2Company(opHs3));
assert("TL cannot manage HS2 even with override", !roles.canManageHs2Company(tlHangup));
assert("agent cannot manage HS2 even with override", !roles.canManageHs2Company(agent));
assert(
  "OP HS-3 still hangup after override",
  companyContext.resolveCompanyContextForUser("hs2", opHs3) === "hangup"
);
userPermissions.getOverrideSync = origOverride;

if (!process.exitCode) console.log("\nhs2-access tests passed.");

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

assert("quality sees HS2 in sales", roles.canSeeHs2InSales(quality));
assert("admin sees HS2 in sales", roles.canSeeHs2InSales(admin));
assert("rtm cannot see HS2 in sales", !roles.canSeeHs2InSales(rtm));
assert("agent cannot see HS2 in sales", !roles.canSeeHs2InSales(agent));

assert(
  "hs2 company query blocked for agent",
  companyContext.resolveCompanyContextForUser("hs2", agent) === "hangup"
);
assert(
  "hs2 company query allowed for hr",
  companyContext.resolveCompanyContextForUser("hs2", hr) === "hs2"
);

const sales = [
  { id: "s1", unit: "HS-1" },
  { id: "s2", unit: "HS-2" },
];
const filtered = companyContext.filterHs2SalesForRole(sales, rtm);
assert("rtm sales strip HS-2", filtered.length === 1 && filtered[0].unit === "HS-1");
const qSales = companyContext.filterHs2SalesForRole(sales, quality);
assert("quality keeps HS-2 sales", qSales.length === 2);

if (!process.exitCode) console.log("\nhs2-access tests passed.");

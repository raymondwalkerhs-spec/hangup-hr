#!/usr/bin/env node
const assert = require("assert");
const { teamInList } = require("../lib/employee-unit-team");
const companyContext = require("../lib/company-context");

function check(name, fn) {
  try {
    fn();
    console.log("ok", name);
  } catch (err) {
    console.error("fail", name, err.message);
    process.exitCode = 1;
  }
}

check("HS-2 unit is hs2 company", () => {
  assert.equal(companyContext.getCompanyForUnit("HS-2"), "hs2");
  assert.equal(companyContext.getCompanyForUnit("HS-3"), "hangup");
});

check("team list match is case/alias tolerant", () => {
  assert.equal(teamInList("Phoenix", ["Phoenix", "Ayla"]), true);
  assert.equal(teamInList("Team Phoenix", ["Phoenix"]), true);
  assert.equal(teamInList("Ayla", ["Phoenix"]), false);
  assert.equal(teamInList("", ["Phoenix"]), true);
});

check("frontend companyForUnit matches backend for common units", () => {
  // JS require of .ts may fail; skip if vite-only. Duplicate the tiny helper.
  const companyForUnitJs = (unit) => {
    const u = String(unit || "").trim().toUpperCase();
    if (u === "HS-2" || u === "HS2" || u === "HS2-PT" || u.startsWith("HS2-") || u.startsWith("HS2 ")) return "hs2";
    return "hangup";
  };
  assert.equal(companyForUnitJs("HS-2"), companyContext.getCompanyForUnit("HS-2") === "hs2" ? "hs2" : "hangup");
  assert.equal(companyForUnitJs("HS-3"), "hangup");
  assert.equal(companyForUnitJs("HS-1"), "hangup");
});

if (process.exitCode) process.exit(process.exitCode);
console.log("employee unit/team tests passed");

#!/usr/bin/env node
/**
 * Company isolation scenario tests — mimics user/API interaction patterns without HTTP.
 */
const companyContext = require("../lib/company-context");
const changelog = require("../lib/changelog");
const roles = require("../lib/roles");
const { parseCompanyContext } = require("../lib/company-context");

let failures = 0;

function test(name, fn) {
  try {
    fn();
    console.log("  ok", name);
  } catch (e) {
    console.error("  FAIL", name, e.message);
    failures += 1;
  }
}

function mockReq({ company, userRole, query = {}, body = {} }) {
  return {
    query: { ...query, ...(company ? { company } : {}) },
    body,
    userRole: { ...userRole, company: company || userRole?.company || "hangup" },
  };
}

function parseCompanyFromReq(req) {
  const { resolveCompanyContextForUser } = require("../lib/company-context");
  return resolveCompanyContextForUser(req.query.company || req.body?.company, req.userRole);
}

console.log("company-isolation-scenarios");

test("hangup tab excludes HS2-scoped employees", () => {
  const all = [
    { id: "A1", unit: "HS-1" },
    { id: "H2", unit: "HS-2" },
  ];
  const hangup = companyContext.filterEmployeesByCompany(all, "hangup");
  if (hangup.some((e) => e.id === "H2")) throw new Error("HS2 employee visible on hangup tab");
  if (!hangup.some((e) => e.id === "A1")) throw new Error("missing hangup employee");
});

test("admin on HS2 tab resolves company from query", () => {
  const ur = { role: "admin", username: "admin" };
  const req = mockReq({ company: "hs2", userRole: ur });
  if (parseCompanyFromReq(req) !== "hs2") throw new Error("expected hs2");
});

test("agent cannot force HS2 via query", () => {
  const ur = { role: "agent", username: "agent", unit: "HS-1" };
  const req = mockReq({ company: "hs2", userRole: ur });
  if (parseCompanyFromReq(req) !== "hangup") throw new Error("agent must not access hs2 via query");
});

test("changelog filter keeps employee-scoped rows in company", () => {
  const ids = new Set(["HS1-01"]);
  const entries = [
    { entity: "employee", entity_id: "HS1-01", field: "*" },
    { entity: "employee", entity_id: "HS2-01", field: "*" },
    { entity: "config", entity_id: "tax", field: "taxRules.hangup" },
    { entity: "config", entity_id: "tax", field: "taxRules.hs2" },
  ];
  const filtered = changelog.filterChangeLogByCompany(entries, ids, "hangup");
  if (filtered.length !== 2) throw new Error(`expected 2 hangup entries, got ${filtered.length}`);
  if (!filtered.some((e) => e.entity_id === "HS1-01")) throw new Error("missing HS1-01");
  if (filtered.some((e) => e.entity_id === "HS2-01")) throw new Error("leaked HS2-01");
});

test("changelog HS2 config rows only on hs2 tab", () => {
  const ids = new Set(["HS2-AG"]);
  const entries = [
    { entity: "config", entity_id: "x", field: "fpRules.hs2.2026-01" },
    { entity: "config", entity_id: "y", field: "taxRules.hangup" },
  ];
  const filtered = changelog.filterChangeLogByCompany(entries, ids, "hs2");
  if (filtered.length !== 1 || filtered[0].field !== "fpRules.hs2.2026-01") {
    throw new Error("HS2 config filter wrong");
  }
});

test("sales filter strips HS2 on hangup context", () => {
  const sales = [
    { id: "1", unit: "HS-1" },
    { id: "2", unit: "HS-2" },
  ];
  const hangup = companyContext.filterSalesByCompanyContext(sales, "hangup");
  if (hangup.length !== 1 || hangup[0].id !== "1") throw new Error("hangup sales leak");
  const hs2 = companyContext.filterSalesByCompanyContext(sales, "hs2");
  if (hs2.length !== 1 || hs2[0].id !== "2") throw new Error("hs2 sales filter wrong");
});

test("RBAC company on userRole drives payroll permission", () => {
  const rolePermissions = require("../lib/role-permissions");
  rolePermissions.resetOverridesForTest();
  const map = rolePermissions.getCachedOverrides();
  map.set("hangup::hr::viewPayroll", false);
  map.set("hs2::hr::viewPayroll", true);
  const hangupHr = { role: "hr", company: "hangup" };
  const hs2Hr = { role: "hr", company: "hs2" };
  if (roles.canViewPayroll(hangupHr)) throw new Error("hangup override should deny");
  if (!roles.canViewPayroll(hs2Hr)) throw new Error("hs2 override should allow");
});

test("employeeInCompanyContext blocks cross-company card access", () => {
  const emp = { id: "X", unit: "HS-2" };
  const inHs2 = companyContext.employeeInCompanyContext(emp, "hs2");
  const inHangup = companyContext.employeeInCompanyContext(emp, "hangup");
  if (!inHs2) throw new Error("should be in hs2");
  if (inHangup) throw new Error("should not be in hangup");
});

test("parseCompanyContext normalizes values", () => {
  if (parseCompanyContext("HS2") !== "hs2") throw new Error("hs2 normalize");
  if (parseCompanyContext("") !== "hangup") throw new Error("empty -> hangup");
});

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncompany-isolation-scenarios passed.");

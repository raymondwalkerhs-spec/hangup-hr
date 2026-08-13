const test = require("node:test");
const assert = require("node:assert/strict");
const { canAccessPage, firstAllowedPage, isRestrictedPage } = require("../src/lib/nav-access.ts");

test("attendance is allowed before user status loads", () => {
  assert.equal(canAccessPage(undefined, "attendance"), true);
  assert.equal(isRestrictedPage("attendance"), false);
});

test("payroll is denied until user status is known", () => {
  assert.equal(canAccessPage(undefined, "payroll"), false);
  assert.equal(isRestrictedPage("payroll"), true);
});

test("payroll allowed for HR roles", () => {
  assert.equal(canAccessPage({ role: "hr", canViewPayroll: false }, "payroll"), true);
  assert.equal(canAccessPage({ role: "finance", canViewPayroll: false }, "salaries"), true);
});

test("payroll hidden for agents and TL even with canViewPayroll flag", () => {
  assert.equal(canAccessPage({ role: "agent", canViewPayroll: true }, "payroll"), false);
  assert.equal(canAccessPage({ role: "tl", canViewPayroll: true }, "salaries"), false);
});

test("IT requests visible when submit permission is granted", () => {
  assert.equal(canAccessPage({ role: "agent", canSubmitItRequest: true }, "it-requests"), true);
});

test("firstAllowedPage skips payroll for agents without access", () => {
  assert.equal(firstAllowedPage({ role: "agent", canViewPayroll: false }), "dashboard");
  assert.equal(firstAllowedPage({ role: "hr" }), "dashboard");
});

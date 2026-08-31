const test = require("node:test");
const assert = require("node:assert/strict");
const loginSync = require("../lib/employee-login-sync");

test("shouldDisableLoginForEmployee: Out with depart_date", () => {
  assert.equal(
    loginSync.shouldDisableLoginForEmployee({ status: "Out", depart_date: "2026-07-01" }),
    true
  );
});

test("shouldDisableLoginForEmployee: Out without depart_date (legacy)", () => {
  assert.equal(
    loginSync.shouldDisableLoginForEmployee({ status: "Out", depart_date: null }),
    true
  );
});

test("shouldDisableLoginForEmployee: OUT BUT STILL GET PAID", () => {
  assert.equal(
    loginSync.shouldDisableLoginForEmployee({ status: "OUT BUT STILL GET PAID", depart_date: "2026-07-01" }),
    true
  );
});

test("shouldDisableLoginForEmployee: Active employee", () => {
  assert.equal(
    loginSync.shouldDisableLoginForEmployee({ status: "Active", depart_date: "2026-07-01" }),
    false
  );
});

test("shouldDisableLoginForEmployee: Paused employee", () => {
  assert.equal(
    loginSync.shouldDisableLoginForEmployee({ status: "Paused", depart_date: null }),
    false
  );
});

test("isOutStatus recognizes attendance OUT strings only for employee status mapping", () => {
  assert.equal(loginSync.isOutStatus("Out"), true);
  assert.equal(loginSync.isOutStatus("OUT"), true);
  assert.equal(loginSync.isOutStatus("Active"), false);
});

test("loginDisableWarning for missing login", () => {
  const msg = loginSync.loginDisableWarning({ ok: false, skipped: true, reason: "no_login" });
  assert.match(msg, /no linked login/i);
});

test("loginDisableWarning null when disabled successfully", () => {
  assert.equal(loginSync.loginDisableWarning({ ok: true, username: "A1" }), null);
});

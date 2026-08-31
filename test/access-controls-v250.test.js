const test = require("node:test");
const assert = require("node:assert/strict");
const roles = require("../lib/roles");
const catalog = require("../lib/permission-catalog");

test("viewSalesRankings defaults match sales log filters roles", () => {
  for (const role of ["op", "admin", "ceo", "hr", "rtm", "quality"]) {
    const ur = { role, username: `t_${role}` };
    assert.equal(roles.canViewSalesRankings(ur), true, role);
    assert.equal(catalog.defaultForRole(role, ur).viewSalesRankings, true, role);
  }
  for (const role of ["agent", "tl", "checker"]) {
    const ur = { role, username: `t_${role}` };
    assert.equal(roles.canViewSalesRankings(ur), false, role);
  }
});

test("settingsThemeUnlocks defaults for manage roles only", () => {
  for (const role of ["admin", "ceo", "hr"]) {
    const ur = { role, username: `t_${role}` };
    assert.equal(roles.canSettingsThemeUnlocks(ur), true, role);
  }
  for (const role of ["op", "quality", "rtm", "agent", "tl"]) {
    const ur = { role, username: `t_${role}` };
    assert.equal(roles.canSettingsThemeUnlocks(ur), false, role);
  }
});

test("canViewSettingsSection themeUnlocks", () => {
  assert.equal(roles.canViewSettingsSection({ role: "hr" }, "themeUnlocks"), true);
  assert.equal(roles.canViewSettingsSection({ role: "op" }, "themeUnlocks"), false);
});

#!/usr/bin/env node
const assert = require("assert");
const audience = require("../lib/announcements-audience");
const notifyAnn = require("../lib/announcements-notify");

function check(name, fn) {
  try {
    fn();
    console.log("ok", name);
  } catch (err) {
    console.error("fail", name, err.message);
    process.exitCode = 1;
  }
}

const companyPost = { audienceUnits: [], audienceTeams: [], audienceRoles: [] };
const unitPost = { audienceUnits: ["HS-1", "HS-3"], audienceTeams: [], audienceRoles: [] };
const teamPost = { audienceUnits: [], audienceTeams: ["Phoenix"], audienceRoles: [] };
const rolePost = { audienceUnits: [], audienceTeams: [], audienceRoles: ["agent", "tl"] };
const mixedPost = { audienceUnits: ["HS-1"], audienceTeams: ["Phoenix"], audienceRoles: ["agent"] };

check("company-wide is visible to everyone", () => {
  assert.equal(audience.isCompanyWide(companyPost), true);
  assert.equal(
    audience.canViewAnnouncement(companyPost, { role: "agent", unit: "HS-2", team: "Ayla" }),
    true
  );
});

check("editors always see scoped posts", () => {
  assert.equal(
    audience.canViewAnnouncement(unitPost, { role: "agent", unit: "HS-2" }, { isEditor: true }),
    true
  );
});

check("unit filter matches own or lead unit", () => {
  assert.equal(audience.canViewAnnouncement(unitPost, { role: "agent", unit: "HS-1" }), true);
  assert.equal(audience.canViewAnnouncement(unitPost, { role: "agent", unit: "HS-2" }), false);
  assert.equal(
    audience.canViewAnnouncement(unitPost, { role: "tl", unit: "HS-2", leadTeams: [{ unit: "HS-3", team: "Ayla" }] }),
    true
  );
});

check("team filter uses teamsMatch and closer/lead teams", () => {
  assert.equal(audience.canViewAnnouncement(teamPost, { role: "agent", team: "Phoenix" }), true);
  assert.equal(audience.canViewAnnouncement(teamPost, { role: "agent", team: "Ayla" }), false);
  assert.equal(
    audience.canViewAnnouncement(teamPost, { role: "agent", closerTeams: [{ team: "Team Phoenix" }] }),
    true
  );
});

check("role filter is AND with other selected dimensions", () => {
  assert.equal(audience.canViewAnnouncement(rolePost, { role: "agent", unit: "HS-1" }), true);
  assert.equal(audience.canViewAnnouncement(rolePost, { role: "op", unit: "HS-1" }), false);
  assert.equal(audience.canViewAnnouncement(mixedPost, { role: "agent", unit: "HS-1", team: "Phoenix" }), true);
  assert.equal(audience.canViewAnnouncement(mixedPost, { role: "agent", unit: "HS-1", team: "Ayla" }), false);
  assert.equal(audience.canViewAnnouncement(mixedPost, { role: "tl", unit: "HS-1", team: "Phoenix" }), false);
});

check("image placement and body split", () => {
  assert.equal(audience.normalizePlacement("BOTTOM"), "bottom");
  assert.equal(audience.normalizePlacement("side"), "top");
  const split = audience.splitBodyHtml("<p>one</p><p>two</p><p>three</p><p>four</p>");
  assert.ok(split.before.includes("two"));
  assert.ok(split.after.includes("three") || split.after.includes("four"));
});

check("audience summary", () => {
  assert.equal(audience.audienceSummary(companyPost), "Whole company");
  assert.match(audience.audienceSummary(mixedPost), /Units: HS-1/);
  assert.match(audience.audienceSummary(mixedPost), /Teams: Phoenix/);
  assert.match(audience.audienceSummary(mixedPost), /Roles: Agent/);
});

check("notification excerpt strips html", () => {
  assert.equal(notifyAnn.plainText("<p>Hello <strong>team</strong></p>"), "Hello team");
});

check("company gate for users without an employee", () => {
  assert.equal(notifyAnn.userInAnnouncementCompany(null, "hangup"), true);
  assert.equal(notifyAnn.userInAnnouncementCompany(null, "hs2"), false);
  assert.equal(
    notifyAnn.userInAnnouncementCompany(null, "hs2", { role: "admin", username: "raymond" }),
    true
  );
  assert.equal(
    notifyAnn.userInAnnouncementCompany(null, "hs2", { role: "agent", username: "a1", unit: "HS-2" }),
    true
  );
  assert.equal(
    notifyAnn.userInAnnouncementCompany(null, "hs2", { role: "agent", username: "a2", unit: "HS-1" }),
    false
  );
});

if (process.exitCode) process.exit(process.exitCode);
console.log("announcements audience tests passed");

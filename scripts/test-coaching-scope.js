#!/usr/bin/env node
/** Coaching picker scope + secret-note stripping (no DB). */
const roles = require("../lib/roles");
const catalog = require("../lib/permission-catalog");
const coachingRepo = require("../lib/coaching-repo");
const coachingScope = require("../lib/coaching-scope");
const announcementsRepo = require("../lib/announcements-repo");

function ok(name, cond) {
  if (!cond) {
    console.error("FAIL", name);
    process.exitCode = 1;
    return;
  }
  console.log("  ok", name);
}

const orgTeams = [
  {
    name: "Phoenix",
    unit: "HS-1",
    tlEmployeeId: "TL1-01",
    tlEmployeeIds: ["TL1-01"],
    closerEmployeeIds: ["HS1-99"],
  },
];

const employees = [
  { id: "HS1-10", unit: "HS-1", team: "Phoenix", status: "Active", employment_date: "2024-01-01", american_name: "Phoenix Agent" },
  { id: "HS1-20", unit: "HS-1", team: "Phoenix", status: "Active", employment_date: "2024-01-01", american_name: "Phoenix Two" },
  { id: "HS1-99", unit: "HS-1", team: "Phoenix", status: "Active", employment_date: "2024-01-01", american_name: "Phoenix Closer" },
  { id: "TL1-01", unit: "HS-1", team: "Phoenix", status: "Active", american_name: "Team Lead", position: "Team Leader" },
  { id: "OP1-01", unit: "HS-1", team: "Ops", status: "Active", american_name: "OP One", position: "OP", role: "op" },
  { id: "HS1-OUT", unit: "HS-1", team: "Phoenix", status: "Out", employment_date: "2024-01-01", american_name: "Out Agent" },
  { id: "HS3-30", unit: "HS-3", team: "Ayla", status: "Active", employment_date: "2024-01-01", american_name: "Ayla Agent" },
  { id: "HS2-01", unit: "HS-2", team: "HS2 Team", status: "Active", employment_date: "2024-01-01", american_name: "HS2 Agent" },
  { id: "HR-1", unit: "HS-Back-End", team: "HR", status: "Active", american_name: "HR One", role: "hr" },
  { id: "QA-1", unit: "HS-Back-End", team: "Quality", status: "Active", american_name: "QA One", role: "quality", position: "Quality" },
];

const tl = {
  role: "tl",
  username: "tl1",
  employeeId: "TL1-01",
  unit: "HS-1",
  team: "Phoenix",
  leadTeams: [{ unit: "HS-1", team: "Phoenix" }],
};
const op = { role: "op", username: "op1", employeeId: "OP1-01", unit: "HS-1" };
const closer = {
  role: "agent",
  username: "closer1",
  employeeId: "HS1-99",
  unit: "HS-1",
  team: "Phoenix",
  closerTeams: [{ unit: "HS-1", team: "Phoenix" }],
};
const quality = { role: "quality", username: "qa1", employeeId: "QA-1" };
const hr = { role: "hr", username: "hr1", employeeId: "HR-1" };
const admin = { role: "admin", username: "raymond", employeeId: "MG-1" };
const agent = { role: "agent", username: "agent1", employeeId: "HS1-10", unit: "HS-1", team: "Phoenix" };
const rtm = { role: "rtm", username: "rtm1", employeeId: "RTM-1" };

console.log("coaching-scope");

const tlIds = coachingScope.employeesForCoachingAgent(tl, employees, { orgTeams }).map((e) => e.id).sort();
ok("TL picker is lead-team agents only", tlIds.join(",") === "HS1-10,HS1-20");
ok("TL cannot choose another coach as agent", !tlIds.includes("HS1-99") && !tlIds.includes("TL1-01"));
ok("TL cannot choose out agents", !tlIds.includes("HS1-OUT"));

const closerIds = coachingScope.employeesForCoachingAgent(closer, employees, { orgTeams }).map((e) => e.id).sort();
ok("Closer picker is closer-team agents only", closerIds.join(",") === "HS1-10,HS1-20");
ok("Closer cannot choose another coach as agent", !closerIds.includes("HS1-99") && !closerIds.includes("TL1-01"));
const mislabeledCloser = {
  role: "tl",
  username: "cl-bad",
  employeeId: "HS1-99",
  unit: "HS-1",
  team: "Phoenix",
  closerTeams: [{ unit: "HS-1", team: "Phoenix" }],
  leadTeams: [],
};
const mislabeledIds = coachingScope.employeesForCoachingAgent(mislabeledCloser, employees, { orgTeams }).map((e) => e.id).sort();
ok("Closer mis-roled as tl still uses closer teams", mislabeledIds.join(",") === "HS1-10,HS1-20");

const opIds = coachingScope.employeesForCoachingAgent(op, employees, { orgTeams }).map((e) => e.id).sort();
ok("OP can choose unit agents", opIds.includes("HS1-10") && opIds.includes("HS1-20"));
ok("OP can choose TL/Closer as agent", opIds.includes("TL1-01") && opIds.includes("HS1-99"));
ok("OP cannot choose out / HR / Quality", !opIds.includes("HS1-OUT") && !opIds.includes("HR-1") && !opIds.includes("QA-1"));

const qaIds = coachingScope.employeesForCoachingAgent(quality, employees, { orgTeams }).map((e) => e.id).sort();
ok("Quality picker is company agents", qaIds.includes("HS1-10") && qaIds.includes("HS3-30") && qaIds.includes("HS2-01"));
ok("Quality cannot choose HR/Quality/Admin or coaches", !qaIds.includes("HR-1") && !qaIds.includes("QA-1") && !qaIds.includes("TL1-01"));

const adminIds = coachingScope.employeesForCoachingAgent(admin, employees, { orgTeams }).map((e) => e.id);
ok("Admin cannot choose HR/Quality as agent", !adminIds.includes("HR-1") && !adminIds.includes("QA-1"));

ok("Nobody can choose HR as coachee", coachingScope.isBlockedCoachee(employees.find((e) => e.id === "HR-1")));
ok("Nobody can choose Quality as coachee", coachingScope.isBlockedCoachee(employees.find((e) => e.id === "QA-1")));
ok(
  "Live agent role wins over HR- prefix",
  !coachingScope.isBlockedCoachee({ id: "HR-2", status: "Active", role: "agent", american_name: "Eva Agent" })
);
ok(
  "Dialing-ID TL uses live role not prefix",
  coachingScope.isOrgTl({ id: "HS1-05", status: "Active", role: "tl", american_name: "Ayla" }, [])
);
ok(
  "Demoted TL- prefix with agent role is not TL",
  !coachingScope.isOrgTl({ id: "TL1-99", status: "Active", role: "agent", american_name: "Ex TL" }, [])
);

const tlCoaches = coachingScope.coachesForUser(tl, employees, { orgTeams });
ok("TL coach is locked to self", tlCoaches.coachLocked === true && tlCoaches.defaultCoachId === "TL1-01");
ok("TL cannot assign another coach", tlCoaches.canAssignCoach === false);

const closerCoaches = coachingScope.coachesForUser(closer, employees, { orgTeams });
ok("Closer coach is locked to self", closerCoaches.coachLocked === true && closerCoaches.defaultCoachId === "HS1-99");

const qaCoaches = coachingScope.coachesForUser(quality, employees, { orgTeams });
ok("Quality default coach is self", qaCoaches.defaultCoachId === "QA-1");
ok("Quality coach list is quality team", qaCoaches.quality.some((e) => e.id === "QA-1") && !qaCoaches.tls.length);
ok("Quality can choose OP as coach", qaCoaches.ops.some((e) => e.id === "OP1-01"));

const opCoaches = coachingScope.coachesForUser(op, employees, { orgTeams });
ok("OP default coach is self", opCoaches.defaultCoachId === "OP1-01");
ok("OP can assign self as coach", opCoaches.ops.some((e) => e.id === "OP1-01"));
ok("OP can assign TL/Closer/agent coaches", opCoaches.canAssignCoach && opCoaches.tls.some((e) => e.id === "TL1-01") && opCoaches.closers.some((e) => e.id === "HS1-99") && opCoaches.agents.some((e) => e.id === "HS1-10"));
ok("OP coach sections exclude other-unit agents", !opCoaches.agents.some((e) => e.id === "HS3-30"));

const hrCoaches = coachingScope.coachesForUser(hr, employees, { orgTeams });
ok("HR default coach is self", hrCoaches.defaultCoachId === "HR-1");
ok("HR can choose TL/Closer/Quality/OP", hrCoaches.canAssignCoach && hrCoaches.tls.length && hrCoaches.closers.length && hrCoaches.quality.length && hrCoaches.ops.some((e) => e.id === "OP1-01") && !hrCoaches.agents.length);

const adminCoaches = coachingScope.coachesForUser(admin, employees, { orgTeams });
ok("Admin can assign any coach/agent including OP", adminCoaches.canAssignCoach && adminCoaches.tls.length && adminCoaches.agents.length && adminCoaches.ops.some((e) => e.id === "OP1-01"));

ok("TL can submit coaching", roles.canSubmitCoaching(tl));
ok("OP can submit coaching", roles.canSubmitCoaching(op));
ok("Closer (agent role) can submit coaching", roles.canSubmitCoaching(closer));
ok("Quality can submit coaching", roles.canSubmitCoaching(quality));
ok("HR can submit coaching", roles.canSubmitCoaching(hr));
ok("RTM cannot submit coaching", !roles.canSubmitCoaching(rtm));
ok("Plain agent cannot submit coaching", !roles.canSubmitCoaching(agent));

ok("HR can view secret notes", roles.canViewCoachingSecret(hr));
ok("Quality can view secret notes", roles.canViewCoachingSecret(quality));
ok("Admin can view secret notes", roles.canViewCoachingSecret(admin));
ok("TL cannot view secret notes", !roles.canViewCoachingSecret(tl));
ok("OP cannot view secret notes", !roles.canViewCoachingSecret(op));
ok("Agent cannot view secret notes", !roles.canViewCoachingSecret(agent));

ok("Only admin can delete coaching", roles.canDeleteCoaching(admin) && !roles.canDeleteCoaching(hr) && !roles.canDeleteCoaching(tl));
ok("Only admin can edit coaching datetime", roles.canEditCoachingDateTime(admin) && !roles.canEditCoachingDateTime(op));

ok("Agent can view own coaching tab", roles.canViewCoaching(agent));
ok("Quality can view coaching", roles.canViewCoaching(quality));

const secretRow = {
  id: "c1",
  company: "hangup",
  employee_id: "HS1-10",
  coach_employee_id: "TL1-01",
  submitted_by: "qa1",
  coaching_date: "2026-08-13",
  coaching_at: "2026-08-13T10:00:00Z",
  outcome: "pending",
  general_notes: "Be on time",
  extra_general_notes: "",
  secret_notes: "PIP candidate",
  extra_secret_notes: "watch lateness",
  status: "open",
  created_by: "qa1",
  author_employee_id: "QA-1",
  author_role: "quality",
  unit: "HS-1",
  team: "Phoenix",
  created_at: "2026-08-13T10:00:00Z",
  updated_at: "2026-08-13T10:00:00Z",
};

const agentMapped = coachingRepo.mapRow(secretRow, { includeSecret: false });
ok("stripped payload has general notes", agentMapped.generalNotes === "Be on time");
ok("stripped payload omits secretNotes", agentMapped.secretNotes === undefined);
ok("stripped payload flags hasSecretNotes", agentMapped.hasSecretNotes === true);
ok("stripped payload has coach + submitter + outcome", agentMapped.coachEmployeeId === "TL1-01" && agentMapped.submittedBy === "qa1" && agentMapped.outcome === "pending");

const authorMapped = coachingRepo.mapRow(secretRow, { includeSecret: true });
ok("author payload includes secretNotes", authorMapped.secretNotes === "PIP candidate");
ok("author payload includes extra secret", authorMapped.extraSecretNotes === "watch lateness");

const dirty = announcementsRepo.sanitizeHtml('<p>Hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>');
ok("announcement html strips script", !dirty.includes("<script"));
ok("announcement html strips javascript urls", !/javascript:/i.test(dirty));

const qaDefaults = catalog.defaultForRole("quality", quality);
ok("catalog quality viewCoachingSecret", qaDefaults.viewCoachingSecret === true);
ok("catalog tl viewCoachingSecret", catalog.defaultForRole("tl", tl).viewCoachingSecret === false);
ok("catalog closer submitCoaching", catalog.defaultForRole("agent", closer).submitCoaching === true);
ok("catalog agent submitCoaching", catalog.defaultForRole("agent", agent).submitCoaching === false);

if (process.exitCode) {
  console.error("coaching-scope failed");
  process.exit(1);
}
console.log("coaching-scope OK");

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildQFeedbackCloserScopePayload,
  employeesForCheckFeedbackCloserPicker,
} = require("../lib/sale-submit-scope");

const employees = [
  { id: "TL1", american_name: "Team Lead", team: "Alpha", unit: "HS-3", status: "Active", position: "Team Leader" },
  { id: "CL1", american_name: "Closer One", team: "Alpha", unit: "HS-3", status: "Active", position: "Closer" },
  { id: "AG1", american_name: "Dialing Agent", team: "Alpha", unit: "HS-3", status: "Active", position: "Agent" },
  { id: "ME", american_name: "Me Admin", team: "Alpha", unit: "HS-3", status: "Active", position: "Admin" },
];

const orgTeams = [
  {
    name: "Alpha",
    unit: "HS-3",
    dialsSales: true,
    teamLeadIds: ["TL1"],
    closerIds: ["CL1"],
  },
];

test("forCheckCreate closer picker is TL/Closers only and defaults to submitter", () => {
  const userRole = {
    role: "admin",
    employeeId: "ME",
    username: "admin1",
  };
  const payload = buildQFeedbackCloserScopePayload(userRole, employees, orgTeams, {
    forCheckCreate: true,
    company: "hangup",
  });
  assert.equal(payload.lockCloser, false);
  assert.equal(payload.defaultCloserId, "ME");
  const ids = (payload.closers || []).map((e) => e.id);
  assert.ok(ids.includes("TL1"));
  assert.ok(ids.includes("CL1"));
  assert.ok(ids.includes("ME"), "submitter included even if not TL/Closer");
  assert.ok(!ids.includes("AG1"), "dialing agents excluded from check feedback closer picker");
});

test("employeesForCheckFeedbackCloserPicker excludes dialing agents for admin", () => {
  const list = employeesForCheckFeedbackCloserPicker(
    { role: "admin", employeeId: "ME" },
    employees,
    {
      teamLeadIds: new Set(["TL1"]),
      orgCloserIds: new Set(["CL1"]),
    }
  );
  const ids = list.map((e) => e.id);
  assert.ok(ids.includes("TL1"));
  assert.ok(ids.includes("CL1"));
  assert.ok(!ids.includes("AG1"));
});

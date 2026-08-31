/**
 * Q Feedback closer picker: TL/Closers first; dialing agents only for OP/RTM/Admin;
 * TL/Closer submitters locked to self.
 */
const assert = require("assert");
const {
  buildQFeedbackCloserScopePayload,
  employeesForQFeedbackCloserPicker,
} = require("../lib/sale-submit-scope");

const employees = [
  {
    id: "TL-01",
    american_name: "Tina TL",
    team: "Jude",
    unit: "HS-3",
    status: "Active",
    role: "tl",
    lead_role: "TL",
  },
  {
    id: "CL-01",
    american_name: "Carl Closer",
    team: "Jude",
    unit: "HS-3",
    status: "Active",
    lead_role: "CL",
  },
  { id: "HS3-10", american_name: "Dialing Dan", team: "Jude", unit: "HS-3", status: "Active" },
  { id: "HS3-11", american_name: "Dialing Dana", team: "Jude", unit: "HS-3", status: "Active" },
];
const orgTeams = [
  {
    name: "Jude",
    unit: "HS-3",
    dialsSales: true,
    tlEmployeeId: "TL-01",
    closerEmployeeIds: ["CL-01"],
  },
];

const admin = buildQFeedbackCloserScopePayload(
  { role: "admin", employeeId: "ADM" },
  employees,
  orgTeams,
  { company: "hangup" }
);
assert.deepStrictEqual(
  admin.closers.map((c) => c.id),
  ["CL-01", "TL-01", "HS3-10", "HS3-11"]
);
assert.equal(admin.lockCloser, false);

const op = buildQFeedbackCloserScopePayload(
  { role: "op", employeeId: "OP-1", unit: "HS-3" },
  employees,
  orgTeams,
  { company: "hangup" }
);
assert.ok(op.closers.some((c) => c.id === "HS3-10"));
assert.ok(op.closers.some((c) => c.id === "TL-01"));

const quality = buildQFeedbackCloserScopePayload(
  { role: "quality", employeeId: "QA-1" },
  employees,
  orgTeams,
  { company: "hangup" }
);
assert.deepStrictEqual(
  quality.closers.map((c) => c.id),
  ["CL-01", "TL-01"]
);
assert.equal(
  quality.closers.some((c) => c.id.startsWith("HS3")),
  false
);

const tl = buildQFeedbackCloserScopePayload(
  {
    role: "tl",
    employeeId: "TL-01",
    unit: "HS-3",
    team: "Jude",
    leadTeams: [{ unit: "HS-3", team: "Jude" }],
  },
  employees,
  orgTeams,
  { company: "hangup" }
);
assert.deepStrictEqual(
  tl.closers.map((c) => c.id),
  ["TL-01"]
);
assert.equal(tl.lockCloser, true);

const closerOnly = employeesForQFeedbackCloserPicker(
  {
    role: "agent",
    employeeId: "CL-01",
    closerTeams: [{ unit: "HS-3", team: "Jude" }],
  },
  employees,
  {
    teamLeadIds: new Set(["TL-01"]),
    orgCloserIds: new Set(["CL-01"]),
    orgTeams,
  }
);
assert.deepStrictEqual(
  closerOnly.map((c) => c.id),
  ["CL-01"]
);

console.log("q-feedback-closer-scope: ok");

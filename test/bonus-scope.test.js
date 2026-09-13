const test = require("node:test");
const assert = require("node:assert/strict");
const bonusScope = require("../lib/bonus-scope");

const employees = [
  { id: "HS3-1", american_name: "Agent A", unit: "HS-3", team: "Alpha", status: "Active" },
  { id: "HS3-2", american_name: "Agent B", unit: "HS-3", team: "Beta", status: "Active" },
  { id: "HS1-9", american_name: "Other Unit", unit: "HS-1", team: "Z", status: "Active" },
  { id: "TL01", american_name: "Team Lead", unit: "HS-3", team: "Alpha", status: "Active" },
  { id: "O1", american_name: "Oliver", unit: "HS-Back-End", team: "RTM", status: "Active" },
  { id: "BE-1", american_name: "Backend Agent", unit: "HS-Back-End", team: "X", status: "Active" },
  { id: "BE-2", american_name: "Backend Out", unit: "HS-Back-End", team: "Y", status: "Out" },
  { id: "HR-2", american_name: "Eva", unit: "HS-Back-End", team: "Quality", status: "Active" },
  { id: "Q99", american_name: "Quality Dialing", unit: "HS-3", team: "Q", status: "Active" },
];

test("TL recipients are unit-wide (any team)", () => {
  const tl = {
    role: "tl",
    unit: "HS-3",
    employeeId: "TL01",
    leadTeams: [{ unit: "HS-3", team: "Alpha" }],
  };
  const ids = bonusScope.employeesForBonusRecipient(tl, employees).map((e) => e.id);
  assert.ok(ids.includes("HS3-1"));
  assert.ok(ids.includes("HS3-2"), "other team in same unit");
  assert.ok(ids.includes("TL01"));
  assert.ok(!ids.includes("HS1-9"));
});

test("RTM recipients are Active in their unit only", () => {
  const rtm = { role: "rtm", unit: "HS-Back-End", employeeId: "O1" };
  const ids = bonusScope.employeesForBonusRecipient(rtm, employees).map((e) => e.id);
  assert.ok(ids.includes("BE-1"));
  assert.ok(ids.includes("O1"));
  assert.ok(ids.includes("HR-2"));
  assert.ok(!ids.includes("BE-2"), "Out excluded");
  assert.ok(!ids.includes("HS3-1"));
});

test("Quality recipients are dialing-unit agents only", () => {
  const quality = { role: "quality", unit: "HS-Back-End", employeeId: "HR-2" };
  const ids = bonusScope.employeesForBonusRecipient(quality, employees).map((e) => e.id);
  assert.ok(ids.includes("HS3-1"));
  assert.ok(ids.includes("HS1-9"));
  assert.ok(!ids.includes("TL01"), "TL not an agent recipient");
  assert.ok(!ids.includes("BE-1"), "back-end not dialing");
  assert.ok(!ids.includes("Q99"), "Q-prefixed id treated as payer id not agent");
});

test("HR/Admin payers and recipients are unrestricted (alive)", () => {
  const hr = { role: "hr", employeeId: "HR-1" };
  const rec = bonusScope.employeesForBonusRecipient(hr, employees).map((e) => e.id);
  const pay = bonusScope.employeesForBonusPayer(hr, employees).map((e) => e.id);
  assert.ok(rec.includes("HS3-1"));
  assert.ok(rec.includes("O1"));
  assert.ok(pay.includes("HS3-1"), "HR can deduct from anyone");
  assert.ok(pay.includes("O1"));
  assert.ok(!rec.includes("BE-2"));
});

test("canGrantBonusTransfer respects quality dialing scope", () => {
  const quality = { role: "quality", employeeId: "HR-2" };
  const agent = employees.find((e) => e.id === "HS3-1");
  const tl = employees.find((e) => e.id === "TL01");
  const backend = employees.find((e) => e.id === "BE-1");
  assert.equal(bonusScope.canGrantBonusTransfer(quality, agent, tl, employees), true);
  assert.equal(bonusScope.canGrantBonusTransfer(quality, backend, tl, employees), false);
});

/**
 * RPM sales submit + ACL unit tests (no DB).
 */
const assert = require("assert");
const saleProgram = require("../lib/sale-program-access");
const rpmActions = require("../lib/sales-rpm-action-permissions");
const rpmSubmit = require("../lib/sales-rpm-submit-required");
const saleSubmitScope = require("../lib/sale-submit-scope");

function testProgramFlags() {
  const enabled = { sales_rpm_enabled: true, sales_mla_enabled: false };
  const disabled = { sales_rpm_enabled: false, sales_mla_enabled: true };
  assert.deepStrictEqual(saleProgram.employeePrograms(enabled), ["rpm"]);
  assert.strictEqual(saleProgram.assertAgentProgramEnabled(enabled, "rpm").ok, true);
  assert.strictEqual(saleProgram.assertAgentProgramEnabled(disabled, "rpm").ok, false);
  assert.strictEqual(
    saleProgram.assertAgentProgramEnabled(disabled, "rpm", { role: "admin", username: "raymond" }).ok,
    true
  );
  assert.deepStrictEqual(
    saleProgram.enabledProgramsForSubmitter({ role: "admin", employeeId: "MG1", username: "raymond" }, [disabled]),
    ["mla", "rpm"]
  );
}

function testActionPermissions() {
  assert.strictEqual(rpmActions.canPerformActionSync("submit_sale", "agent"), true);
  assert.strictEqual(rpmActions.canPerformActionSync("submit_sale", "quality"), true);
  assert.strictEqual(rpmActions.canPerformActionSync("submit_sale", "rtm"), true);
  assert.strictEqual(rpmActions.canPerformActionSync("edit_sale", "agent"), true);
  assert.strictEqual(rpmActions.canPerformActionSync("edit_sale", "finance"), false);
  assert.strictEqual(rpmActions.canPerformActionSync("work_quality_ticket", "tl"), true);
}

function testSubmitValidation() {
  const bad = rpmSubmit.validateRpmSaleSubmitPayload({ agentId: "A1" });
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.errors.length > 3);

  const good = rpmSubmit.validateRpmSaleSubmitPayload({
    agentId: "A1",
    closerId: "CL1",
    formData: {
      client: "RPM1",
      fullName: "Test User",
      phoneNumber: "01000000000",
      alternativePhone: "01000000001",
      dateOfBirth: "1990-01-01",
      memberId: "M123",
      email: "t@example.com",
      address: "Cairo",
      gender: "Male",
      medicalConditions: ["None"],
      emergencyFullName: "Emergency",
      emergencyPhone: "01000000002",
      emergencyRelation: "Spouse",
    },
  });
  assert.strictEqual(good.ok, true);

  const baseForm = {
    client: "RPM1",
    fullName: "Test User",
    phoneNumber: "01000000000",
    alternativePhone: "01000000001",
    dateOfBirth: "1990-01-01",
    memberId: "M123",
    email: "t@example.com",
    address: "Cairo",
    gender: "Male",
    medicalConditions: ["None"],
    emergencyFullName: "Emergency",
    emergencyPhone: "01000000002",
    emergencyRelation: "Spouse",
  };
  assert.strictEqual(
    rpmSubmit.validateRpmSaleSubmitPayload({ agentId: "A1", closerId: "CL1", formData: { ...baseForm, notes: "Optional" } }).ok,
    true
  );
  assert.strictEqual(
    rpmSubmit.validateRpmSaleSubmitPayload({ agentId: "A1", closerId: "CL1", formData: { ...baseForm, notes: "" } }).ok,
    true,
    "empty notes should not block submit"
  );
}

function testAgentPickerProgramFilter() {
  const employees = [
    { id: "A1", unit: "U1", team: "Team 1", status: "Active", employment_date: "2024-01-01", sales_rpm_enabled: true },
    { id: "A2", unit: "U1", team: "Team 1", status: "Active", employment_date: "2024-01-01", sales_rpm_enabled: false },
  ];
  const tlAgents = saleSubmitScope.employeesForAgentPicker(
    { role: "tl", unit: "U1", team: "Team 1", leadTeams: [{ unit: "U1", team: "Team 1" }] },
    employees,
    { program: "rpm", unit: "U1" }
  );
  assert.strictEqual(tlAgents.length, 2);
  const plainAgentList = saleSubmitScope.employeesForAgentPicker(
    { role: "agent", employeeId: "A2", unit: "U1", team: "Team 1" },
    employees,
    { program: "rpm", unit: "U1" }
  );
  assert.strictEqual(plainAgentList.length, 0);
}

function testCloserPickerSelfSubmit() {
  const employees = [
    { id: "1001", unit: "U1", team: "Team 1", status: "Active", employment_date: "2024-01-01" },
    { id: "TL1", unit: "U1", team: "Team 1", status: "Active" },
    { id: "TL2", unit: "U2", team: "Other", status: "Active" },
  ];
  const orgTeams = [
    { name: "Team 1", unit: "U1", tlEmployeeId: "TL1", tlEmployeeIds: ["TL1"], closerEmployeeIds: [] },
  ];
  const closers = saleSubmitScope.employeesForCloserPicker(
    { role: "agent", employeeId: "1001", unit: "U1", team: "Team 1" },
    employees,
    { orgTeams }
  );
  assert.ok(closers.some((e) => e.id === "1001"), "self-submit agent can be closer");
  assert.ok(closers.some((e) => e.id === "TL1"));
  assert.ok(!closers.some((e) => e.id === "TL2"), "plain agent does not see other team TLs");
}

function testOrgCloserIncludesSelfAsCloser() {
  const employees = [
    { id: "HS3-35", unit: "HS-3", team: "Tris", status: "Active", employment_date: "2024-01-01" },
    { id: "HS3-10", unit: "HS-3", team: "Tris", status: "Active", employment_date: "2024-01-01" },
    { id: "TL03", unit: "HS-3", team: "Tris", status: "Active" },
    { id: "TL07", unit: "HS-3", team: "Jude", status: "Active" },
  ];
  const orgTeams = [
    { name: "Tris", unit: "HS-3", tlEmployeeId: "TL03", closerEmployeeIds: ["HS3-35"], dialsSales: true },
    { name: "Jude", unit: "HS-3", tlEmployeeId: "TL07", closerEmployeeIds: ["HS3-35"], dialsSales: true },
  ];
  const ria = {
    role: "agent",
    employeeId: "HS3-35",
    unit: "HS-3",
    team: "Tris",
    closerTeams: [
      { unit: "HS-3", team: "Tris" },
      { unit: "HS-3", team: "Jude" },
    ],
    leadTeams: [],
  };
  const closers = saleSubmitScope.employeesForCloserPicker(ria, employees, { orgTeams }).map((e) => e.id);
  assert.ok(closers.includes("HS3-35"), "org closer (Ria) can pick self");
  assert.ok(closers.includes("TL03") && closers.includes("TL07"), "org closer can pick TLs");
  const agents = saleSubmitScope.employeesForAgentPicker(ria, employees).map((e) => e.id);
  assert.ok(agents.includes("HS3-10") && agents.includes("HS3-35"), "org closer agents are closer-team dialers");
  const payload = saleSubmitScope.buildSubmitScopePayload(ria, employees, orgTeams);
  assert.strictEqual(payload.defaultCloserId, "HS3-35");
  assert.ok(payload.closers.some((e) => e.id === "HS3-35"));
}

function testTlCanPickTeamAgentAsCloser() {
  const employees = [
    { id: "HS1-10", unit: "HS-1", team: "Phoenix", status: "Active", employment_date: "2024-01-01" },
    { id: "TL1-01", unit: "HS-1", team: "Phoenix", status: "Active" },
    { id: "HS3-30", unit: "HS-3", team: "Ayla", status: "Active", employment_date: "2024-01-01" },
  ];
  const orgTeams = [
    { name: "Phoenix", unit: "HS-1", tlEmployeeId: "TL1-01", closerEmployeeIds: [] },
    { name: "Ayla", unit: "HS-3", tlEmployeeId: "TL3-01", closerEmployeeIds: ["TL1-01"] },
  ];
  const tlUser = {
    role: "tl",
    employeeId: "TL1-01",
    unit: "HS-1",
    team: "Phoenix",
    leadTeams: [{ unit: "HS-1", team: "Phoenix" }],
    closerTeams: [{ unit: "HS-3", team: "Ayla" }],
  };
  const closers = saleSubmitScope.employeesForCloserPicker(tlUser, employees, { orgTeams }).map((e) => e.id);
  assert.ok(closers.includes("HS1-10"), "TL can pick own-team agent as closer");
  assert.ok(closers.includes("TL1-01"), "TL includes self as closer");
  assert.ok(!closers.includes("HS3-30"), "closer-team agents are agent-only, not closer");
}

function testOpCanPickAny() {
  const employees = [
    { id: "HS1-10", unit: "HS-1", team: "Phoenix", status: "Active", employment_date: "2024-01-01" },
    { id: "HS3-30", unit: "HS-3", team: "Ayla", status: "Active", employment_date: "2024-01-01" },
    { id: "TL1-01", unit: "HS-1", team: "Phoenix", status: "Active" },
  ];
  const opUser = { role: "op", employeeId: "OP1-01", unit: "HS-1" };
  const agents = saleSubmitScope.employeesForAgentPicker(opUser, employees).map((e) => e.id);
  assert.ok(agents.includes("HS1-10") && agents.includes("HS3-30"), "OP can pick any dialing agent");
  const closers = saleSubmitScope.employeesForCloserPicker(opUser, employees).map((e) => e.id);
  assert.ok(closers.includes("HS1-10") && closers.includes("TL1-01"), "OP can pick any as closer");
  assert.strictEqual(saleSubmitScope.unitPickerLocked(opUser), false);
}

function testTlAgentScopeIncludesCloserTeams() {
  const employees = [
    { id: "HS1-10", unit: "HS-1", team: "Phoenix", status: "Active", employment_date: "2024-01-01" },
    { id: "HS3-30", unit: "HS-3", team: "Ayla", status: "Active", employment_date: "2024-01-01" },
    { id: "TL1-01", unit: "HS-1", team: "Phoenix", status: "Active" },
  ];
  const tlUser = {
    role: "tl",
    employeeId: "TL1-01",
    unit: "HS-1",
    team: "Phoenix",
    leadTeams: [{ unit: "HS-1", team: "Phoenix" }],
    closerTeams: [{ unit: "HS-3", team: "Ayla" }],
  };
  const agents = saleSubmitScope.employeesForAgentPicker(tlUser, employees).map((e) => e.id).sort();
  assert.deepStrictEqual(agents, ["HS1-10", "HS3-30"]);
}

function testCloserPickerExcludesDialers() {
  const employees = [
    { id: "TL1", unit: "U1", team: "Team 1", status: "Active" },
    { id: "1001", unit: "U1", team: "Team 1", status: "Active" },
    { id: "OP1", unit: "U1", team: "Team 1", status: "Active" },
  ];
  const closers = saleSubmitScope.employeesForCloserPicker({ role: "tl", unit: "U1" }, employees, { unit: "U1" });
  assert.ok(closers.some((e) => e.id === "TL1"));
  assert.ok(closers.some((e) => e.id === "OP1"));
  assert.ok(!closers.some((e) => e.id === "1001"));
}

function testCloserPickerExcludesOutAndIncludesTeamLead() {
  const employees = [
    {
      id: "HS1-05",
      american_name: "Ayla Adams",
      unit: "HS-3",
      team: "Ayla",
      status: "Active",
      role: "tl",
    },
    {
      id: "CL05",
      american_name: "Billie Davis",
      unit: "HS-3",
      team: "HS1 Closer",
      status: "Out",
    },
    {
      id: "TL07",
      american_name: "Jude Butler",
      unit: "HS-3",
      team: "Jude",
      status: "Active",
    },
    {
      id: "HS3-46",
      american_name: "JUSTIN DOE",
      unit: "HS-3",
      team: "Justin",
      status: "Active",
      lead_role: "TL",
    },
  ];
  const teamLeadIds = new Set(["HS1-05"]);
  const qualityClosers = saleSubmitScope.employeesForCloserPicker(
    { role: "quality", employeeId: "QV1", unit: "Quality" },
    employees,
    { teamLeadIds }
  );
  assert.ok(qualityClosers.some((e) => e.id === "HS1-05"), "Ayla (TL by role / org TL) must appear");
  assert.ok(!qualityClosers.some((e) => e.id === "CL05"), "Billie (Out CL) must not appear");
  assert.ok(qualityClosers.some((e) => e.id === "TL07"));
  assert.ok(qualityClosers.some((e) => e.id === "HS3-46"), "lead_role TL with dialing ID must appear");

  const tlClosers = saleSubmitScope.employeesForCloserPicker(
    { role: "tl", employeeId: "HS1-05", unit: "HS-3", team: "Ayla" },
    employees,
    { unit: "HS-3", teamLeadIds }
  );
  assert.ok(tlClosers.some((e) => e.id === "HS1-05"), "Ayla visible to TL unit closer picker");
  assert.ok(!tlClosers.some((e) => e.id === "CL05"), "Out closer excluded for TL picker");
}

function testWidePickerClosers() {
  const employees = [
    { id: "HS1-10", unit: "HS-1", team: "Phoenix", status: "Active", employment_date: "2024-01-01" },
    { id: "TL1-01", unit: "HS-1", team: "Phoenix", status: "Active" },
  ];
  const qualityClosers = saleSubmitScope.employeesForCloserPicker(
    { role: "quality", employeeId: "QA-01", unit: "Quality" },
    employees
  );
  assert.ok(qualityClosers.some((e) => e.id === "HS1-10"), "quality can pick active agent as closer");
  assert.ok(qualityClosers.some((e) => e.id === "TL1-01"), "quality can pick TL as closer");
}

testProgramFlags();
testActionPermissions();
testSubmitValidation();
testAgentPickerProgramFilter();
testCloserPickerExcludesDialers();
testCloserPickerSelfSubmit();
testOrgCloserIncludesSelfAsCloser();
testTlCanPickTeamAgentAsCloser();
testOpCanPickAny();
testTlAgentScopeIncludesCloserTeams();
testWidePickerClosers();
testCloserPickerExcludesOutAndIncludesTeamLead();
console.log("test-rpm-sales-submit-acl: OK");

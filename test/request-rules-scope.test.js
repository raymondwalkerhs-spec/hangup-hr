const test = require("node:test");
const assert = require("node:assert/strict");
const { validateRequestSubmit } = require("../lib/request-rules");

const tlRole = { role: "tl", team: "Phoenix", employeeId: "TL-01" };
const opRole = { role: "op", unit: "HS-1", employeeId: "OP-01" };
const agentRole = { role: "agent", employeeId: "HS1-10" };

const teamEmp = { id: "HS1-10", team: "Phoenix", unit: "HS-1", employment_date: "2025-01-01" };
const otherTeamEmp = { id: "HS1-99", team: "Other", unit: "HS-1" };

test("agent cannot request leave for another employee", () => {
  assert.throws(
    () =>
      validateRequestSubmit({
        requestKind: "unpaid",
        employeeId: "HS1-99",
        startDate: "2026-08-10",
        endDate: "2026-08-10",
        dayFraction: 1,
        actor: "HS1-10",
        actorRole: agentRole,
        targetEmp: otherTeamEmp,
        forEmployeeId: "HS1-99",
      }),
    /only request leave for themselves/i
  );
});

test("tl can request unpaid half-day for team member", () => {
  const result = validateRequestSubmit({
    requestKind: "unpaid",
    employeeId: teamEmp.id,
    startDate: "2026-08-10",
    endDate: "2026-08-10",
    dayFraction: 0.5,
    actor: "TL-01",
    actorRole: tlRole,
    targetEmp: teamEmp,
    forEmployeeId: teamEmp.id,
  });
  assert.equal(result.halfDay, true);
  assert.equal(result.dayFraction, 0.5);
});

test("tl can request quarter-day for agent under 180 days", () => {
  const junior = { ...teamEmp, employment_date: "2026-06-01" };
  const result = validateRequestSubmit({
    requestKind: "unpaid",
    employeeId: junior.id,
    startDate: "2026-08-10",
    endDate: "2026-08-10",
    dayFraction: 0.25,
    actor: "TL-01",
    actorRole: tlRole,
    targetEmp: junior,
    forEmployeeId: junior.id,
  });
  assert.equal(result.quarterDay, true);
});

test("op can request for employee in same unit", () => {
  const result = validateRequestSubmit({
    requestKind: "unpaid",
    employeeId: teamEmp.id,
    startDate: "2026-08-10",
    endDate: "2026-08-10",
    dayFraction: 0.25,
    actor: "OP-01",
    actorRole: opRole,
    targetEmp: teamEmp,
    forEmployeeId: teamEmp.id,
  });
  assert.equal(result.quarterDay, true);
});

test("op cannot request for employee outside unit", () => {
  const outside = { id: "HS3-01", team: "Ayla", unit: "HS-3" };
  assert.throws(
    () =>
      validateRequestSubmit({
        requestKind: "unpaid",
        employeeId: outside.id,
        startDate: "2026-08-10",
        endDate: "2026-08-10",
        dayFraction: 1,
        actor: "OP-01",
        actorRole: opRole,
        targetEmp: outside,
        forEmployeeId: outside.id,
      }),
    /in your unit/i
  );
});

test("tl can submit annual for tenured team member", () => {
  const result = validateRequestSubmit({
    requestKind: "annual",
    employeeId: teamEmp.id,
    startDate: "2026-08-10",
    endDate: "2026-08-10",
    dayFraction: 1,
    actor: "TL-01",
    actorRole: tlRole,
    targetEmp: teamEmp,
    forEmployeeId: teamEmp.id,
  });
  assert.equal(result.requestKind, "annual");
  assert.equal(result.paidLeave, true);
});

test("tl cannot submit annual for agent under 180 days", () => {
  const junior = { ...teamEmp, employment_date: "2026-06-01" };
  assert.throws(
    () =>
      validateRequestSubmit({
        requestKind: "annual",
        employeeId: junior.id,
        startDate: "2026-08-10",
        endDate: "2026-08-10",
        dayFraction: 1,
        actor: "TL-01",
        actorRole: tlRole,
        targetEmp: junior,
        forEmployeeId: junior.id,
      }),
    /180\+ days/i
  );
});

test("hr can submit annual on behalf of agent under 180 days", () => {
  const junior = { ...teamEmp, employment_date: "2026-06-01" };
  const result = validateRequestSubmit({
    requestKind: "annual",
    employeeId: junior.id,
    startDate: "2026-08-10",
    endDate: "2026-08-10",
    dayFraction: 1,
    actor: "hr-user",
    actorRole: { role: "hr", employeeId: "HR-01" },
    targetEmp: junior,
    forEmployeeId: junior.id,
  });
  assert.equal(result.requestKind, "annual");
  assert.equal(result.paidLeave, true);
});

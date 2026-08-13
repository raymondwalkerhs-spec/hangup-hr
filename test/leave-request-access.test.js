const test = require("node:test");
const assert = require("node:assert/strict");
const leaveRequestAccess = require("../lib/leave-request-access");

test("canOwnerModifyLeave allows employee owner on pending", () => {
  const leave = { employeeId: "E1", status: "pending", requestedBy: "other" };
  assert.equal(leaveRequestAccess.canOwnerModifyLeave({ employeeId: "E1" }, "user", leave), true);
});

test("canOwnerModifyLeave allows submitter on pending", () => {
  const leave = { employeeId: "E1", status: "pending", requestedBy: "agent1" };
  assert.equal(leaveRequestAccess.canOwnerModifyLeave({ employeeId: "E2" }, "agent1", leave), true);
});

test("canOwnerModifyLeave denies approved status", () => {
  const leave = { employeeId: "E1", status: "approved", requestedBy: "agent1" };
  assert.equal(leaveRequestAccess.canOwnerModifyLeave({ employeeId: "E1" }, "agent1", leave), false);
});

test("canOwnerModifyLeave denies rejected status", () => {
  const leave = { employeeId: "E1", status: "rejected", requestedBy: "agent1" };
  assert.equal(leaveRequestAccess.canOwnerModifyLeave({ employeeId: "E1" }, "agent1", leave), false);
});

test("canOwnerModifyLeave denies non-pending", () => {
  const leave = { employeeId: "E1", status: "approved", requestedBy: "agent1" };
  assert.equal(leaveRequestAccess.canOwnerModifyLeave({ employeeId: "E1" }, "agent1", leave), false);
});

test("canOwnerModifyLeave denies unrelated user", () => {
  const leave = { employeeId: "E1", status: "pending", requestedBy: "agent1" };
  assert.equal(leaveRequestAccess.canOwnerModifyLeave({ employeeId: "E9" }, "other", leave), false);
});

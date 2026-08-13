/** Who may edit/delete a pending leave request (besides HR approvers). */
function isLeaveOwner(userRole, username, leave) {
  if (!leave) return false;
  const empId = userRole?.employeeId;
  if (empId && String(leave.employeeId) === String(empId)) return true;
  const u = String(username || "").toLowerCase();
  const requestedBy = String(leave.requestedBy || "").toLowerCase();
  return Boolean(u && requestedBy && requestedBy === u);
}

function canOwnerModifyLeave(userRole, username, leave) {
  if (!leave || String(leave.status || "").toLowerCase() !== "pending") return false;
  return isLeaveOwner(userRole, username, leave);
}

module.exports = {
  isLeaveOwner,
  canOwnerModifyLeave,
};

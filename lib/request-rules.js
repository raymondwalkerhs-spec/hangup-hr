const WORKDAY_START_HOUR = 15;
const SAME_DAY_CUTOFF_HOUR = 12;

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isLateSameDayRequest(startDate) {
  if (startDate !== todayLocal()) return false;
  return new Date().getHours() >= SAME_DAY_CUTOFF_HOUR;
}

function validateRequestSubmit({
  requestKind,
  employeeId,
  startDate,
  endDate,
  actor,
  actorRole,
  targetEmp,
  forEmployeeId,
}) {
  const kind = String(requestKind || "annual").toLowerCase();
  const role = String(actorRole?.role || actorRole || "").toLowerCase();
  const empId = forEmployeeId || employeeId;
  const actorEmpId = actorRole?.employeeId || "";
  const isSelf =
    String(empId).toLowerCase() === String(actor || "").toLowerCase() ||
    (actorEmpId && String(empId) === String(actorEmpId));

  if (kind === "annual" && role === "agent") {
    throw new Error("Agents cannot submit annual leave requests.");
  }

  if (kind === "annual" && !isSelf && !["hr", "admin", "ceo"].includes(role)) {
    throw new Error("Annual leave can only be requested for yourself.");
  }

  if (["unpaid", "medical", "same_day"].includes(kind) && ["tl", "op"].includes(role) && targetEmp) {
    if (targetEmp.team && actorRole?.team && targetEmp.team !== actorRole.team) {
      throw new Error("You can only request day off for agents on your team.");
    }
  }

  if (!startDate || !endDate) throw new Error("Start and end dates required.");
  if (endDate < startDate) throw new Error("End date must be on or after start date.");

  return {
    requestKind: kind,
    lateSubmission: isLateSameDayRequest(startDate),
    paidLeave: kind === "annual",
    tlRequested: ["tl", "op"].includes(role) && !isSelf,
  };
}

module.exports = {
  WORKDAY_START_HOUR,
  SAME_DAY_CUTOFF_HOUR,
  isLateSameDayRequest,
  validateRequestSubmit,
};

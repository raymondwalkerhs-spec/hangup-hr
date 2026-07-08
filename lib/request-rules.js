const WORKDAY_START_HOUR = 15;
const SAME_DAY_CUTOFF_HOUR = 12;

/** Valid day fractions: 1 = full day, 0.5 = half-day, 0.25 = quarter-day. */
const VALID_FRACTIONS = [1, 0.5, 0.25];
const FRACTION_LABELS = { 1: "Full day", 0.5: "Half day", 0.25: "Quarter day" };

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isLateSameDayRequest(startDate) {
  if (startDate !== todayLocal()) return false;
  return new Date().getHours() >= SAME_DAY_CUTOFF_HOUR;
}

/**
 * Returns whether an employee is eligible for annual leave based on employment date.
 * If employment_date is missing → not eligible (default: don't show annual option).
 */
function isAnnualLeaveEligible(targetEmp) {
  if (!targetEmp?.employment_date) return false;
  const daysEmployed =
    (Date.now() - new Date(targetEmp.employment_date).getTime()) / (1000 * 60 * 60 * 24);
  return daysEmployed >= 180;
}

function daysEmployedCount(targetEmp) {
  if (!targetEmp?.employment_date) return 0;
  return Math.floor(
    (Date.now() - new Date(targetEmp.employment_date).getTime()) / (1000 * 60 * 60 * 24)
  );
}

function validateRequestSubmit({
  requestKind,
  employeeId,
  startDate,
  endDate,
  dayFraction,
  halfDay,
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

  // --- Annual leave gate (all non-HR roles, not just agent) ---
  if (kind === "annual") {
    const isHrApprover = ["hr", "admin", "ceo"].includes(role);
    if (!isHrApprover) {
      // No employment date → annual leave not available
      if (!targetEmp?.employment_date) {
        throw new Error("Annual leave is not available — no employment date on record.");
      }
      const days = daysEmployedCount(targetEmp);
      if (days < 180) {
        throw new Error(
          `Annual leave requires 180+ days of employment. You have ${days} day(s).`
        );
      }
    }
    if (!isSelf && !["hr", "admin", "ceo"].includes(role)) {
      throw new Error("Annual leave can only be requested for yourself.");
    }
  }

  if (["unpaid", "medical", "same_day"].includes(kind) && ["tl", "op"].includes(role) && targetEmp) {
    if (targetEmp.team && actorRole?.team && targetEmp.team !== actorRole.team) {
      throw new Error("You can only request day off for agents on your team.");
    }
  }

  if (!startDate || !endDate) throw new Error("Start and end dates required.");
  if (endDate < startDate) throw new Error("End date must be on or after start date.");

  // --- Day fraction validation ---
  // Half-day / quarter-day only valid for single-day requests
  const fraction = dayFraction != null ? Number(dayFraction) : (halfDay ? 0.5 : 1);
  if (!VALID_FRACTIONS.includes(fraction)) {
    throw new Error(`Invalid day fraction. Allowed: ${VALID_FRACTIONS.join(", ")}`);
  }
  if (fraction < 1 && startDate !== endDate) {
    throw new Error("Half-day and quarter-day options are only available for single-day requests.");
  }

  return {
    requestKind: kind,
    lateSubmission: isLateSameDayRequest(startDate),
    paidLeave: kind === "annual",
    tlRequested: ["tl", "op"].includes(role) && !isSelf,
    dayFraction: fraction,
    halfDay: fraction === 0.5,
    quarterDay: fraction === 0.25,
  };
}

module.exports = {
  WORKDAY_START_HOUR,
  SAME_DAY_CUTOFF_HOUR,
  VALID_FRACTIONS,
  FRACTION_LABELS,
  isLateSameDayRequest,
  isAnnualLeaveEligible,
  daysEmployedCount,
  validateRequestSubmit,
};

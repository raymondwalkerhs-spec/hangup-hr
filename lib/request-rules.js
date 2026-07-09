const WORKDAY_START_HOUR = 15;
const SAME_DAY_CUTOFF_HOUR = 12;

/** Valid day fractions: 1 = full day, 0.5 = half-day, 0.25 = quarter-day. */
const VALID_FRACTIONS = [1, 0.5, 0.25];
const FRACTION_LABELS = { 1: "Full day", 0.5: "Half day", 0.25: "Quarter day" };

/**
 * Returns the Monday and Friday of the ISO week containing `date`.
 * Used to compute the work-week span for a pause request.
 */
function workWeekBounds(date) {
  const d = new Date(`${date}T12:00:00`);
  const day = d.getDay(); // 0=Sun,1=Mon,...,6=Sat
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  const fmt = (x) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return { monday: fmt(mon), friday: fmt(fri) };
}

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

  // --- Pause request (minimum 1 working week = Mon–Fri) ---
  if (kind === "pause") {
    if (!startDate) throw new Error("Start date required for pause request.");
    // Force dates to the full Mon–Fri work week containing startDate
    const { monday, friday } = workWeekBounds(startDate);
    return {
      requestKind: "pause",
      lateSubmission: false,
      paidLeave: false,
      tlRequested: ["tl", "op"].includes(role) && !isSelf,
      dayFraction: 1,
      halfDay: false,
      quarterDay: false,
      // Attach computed week bounds so the route can use them
      pauseStartDate: monday,
      pauseEndDate: friday,
    };
  }

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
  workWeekBounds,
};

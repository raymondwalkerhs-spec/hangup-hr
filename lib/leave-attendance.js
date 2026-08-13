function datesInRange(startDate, endDate) {
  const dates = [];
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

/** Annual = paid. Medical / unpaid / exam / same-day / pause = unpaid. */
function isPaidLeaveKind(kind) {
  return String(kind || "").toLowerCase() === "annual";
}

/**
 * Transport on approved leave:
 * - Annual full day: no transport
 * - Annual half / quarter: half transport
 * - Unpaid half: half transport
 * - Unpaid quarter: no transport
 */
function transportOverrideForLeave(paid, fraction) {
  if (fraction === 0.5) return "half";
  if (paid && fraction === 0.25) return "half";
  return "";
}

function leaveAttendanceRecords(request) {
  const kind = request.requestKind || request.leaveType || "annual";
  const paid = request.paidLeave === true || isPaidLeaveKind(kind);
  const fraction = Number(request.dayFraction ?? 1);
  const baseNote = `${kind} leave${request.lateSubmission ? " (late submission)" : ""}`;
  const transportOverride = transportOverrideForLeave(paid, fraction);

  // Half-day and quarter-day: single-day only
  if (fraction < 1 && request.startDate === request.endDate) {
    let status;
    let note;
    if (fraction === 0.5) {
      status = "Half Day";
      note = `${baseNote} (half day)`;
    } else {
      status = "Quarter Day-Off";
      note = `${baseNote} (quarter day)`;
    }
    return [{
      employeeId: request.employeeId,
      date: request.startDate,
      status,
      paidLeave: paid,
      leaveNote: note,
      transportOverride,
    }];
  }

  // Pause — unpaid paused status Mon–Fri only
  if (kind === "pause") {
    return datesInRange(request.startDate, request.endDate)
      .filter((date) => {
        const dow = new Date(`${date}T12:00:00`).getDay();
        return dow >= 1 && dow <= 5;
      })
      .map((date) => ({
        employeeId: request.employeeId,
        date,
        status: "paused",
        paidLeave: false,
        leaveNote: "pause",
        transportOverride: "",
      }));
  }

  // Full day — annual = paid Day-OFF (no transport); other kinds = unpaid Day-OFF
  return datesInRange(request.startDate, request.endDate).map((date) => ({
    employeeId: request.employeeId,
    date,
    status: "Day-OFF",
    paidLeave: paid,
    leaveNote: baseNote,
    transportOverride: "",
  }));
}

function clearLeaveAttendanceRecords(request) {
  const kind = String(request.requestKind || request.leaveType || "").toLowerCase();
  const dates =
    kind === "pause"
      ? datesInRange(request.startDate, request.endDate).filter((date) => {
          const dow = new Date(`${date}T12:00:00`).getDay();
          return dow >= 1 && dow <= 5;
        })
      : datesInRange(request.startDate, request.endDate);
  return dates.map((date) => ({
    employeeId: request.employeeId,
    date,
    status: "",
    paidLeave: false,
    leaveNote: "",
    transportOverride: "",
  }));
}

module.exports = {
  datesInRange,
  isPaidLeaveKind,
  transportOverrideForLeave,
  leaveAttendanceRecords,
  clearLeaveAttendanceRecords,
};

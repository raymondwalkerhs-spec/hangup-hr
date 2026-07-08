function datesInRange(startDate, endDate) {
  const dates = [];
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function leaveAttendanceRecords(request) {
  const kind     = request.requestKind || request.leaveType || "annual";
  const paid     = request.paidLeave === true || kind === "annual";
  const fraction = Number(request.dayFraction ?? 1);
  const baseNote = `${kind} leave${request.lateSubmission ? " (late submission)" : ""}`;

  // Half-day and quarter-day: single-day only, use the matching attendance status
  if (fraction < 1 && request.startDate === request.endDate) {
    let status, note;
    if (fraction === 0.5) {
      status = "Half Day";
      note   = `${baseNote} (half day)`;
    } else {
      // 0.25 quarter-day
      status = "Quarter Day-Off";
      note   = `${baseNote} (quarter day)`;
    }
    return [{
      employeeId: request.employeeId,
      date:       request.startDate,
      status,
      paidLeave:  paid,
      leaveNote:  note,
    }];
  }

  // Full day (fraction === 1) or multi-day range → Day-OFF on every date
  return datesInRange(request.startDate, request.endDate).map((date) => ({
    employeeId: request.employeeId,
    date,
    status:    "Day-OFF",
    paidLeave: paid,
    leaveNote: baseNote,
  }));
}

function clearLeaveAttendanceRecords(request) {
  return datesInRange(request.startDate, request.endDate).map((date) => ({
    employeeId: request.employeeId,
    date,
    status: "",
    paidLeave: false,
    leaveNote: "",
  }));
}

module.exports = {
  datesInRange,
  leaveAttendanceRecords,
  clearLeaveAttendanceRecords,
};

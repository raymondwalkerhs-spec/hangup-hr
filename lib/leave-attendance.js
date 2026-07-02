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
  const kind = request.requestKind || request.leaveType || "annual";
  const paid = request.paidLeave === true || kind === "annual";
  const note = `${kind} leave${request.lateSubmission ? " (late submission)" : ""}`;
  return datesInRange(request.startDate, request.endDate).map((date) => ({
    employeeId: request.employeeId,
    date,
    status: "Day-OFF",
    paidLeave: paid,
    leaveNote: note,
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

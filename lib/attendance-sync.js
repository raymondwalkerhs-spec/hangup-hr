function pendingAttendanceKey(employeeId, date) {
  return `${employeeId}|${date}`;
}

function mergePendingAttendanceRecords(existingRecords = [], pendingRecords = []) {
  const merged = [...existingRecords];
  const byKey = new Map(merged.map((record) => [pendingAttendanceKey(record.employeeId, record.date), record]));

  for (const record of pendingRecords) {
    const key = pendingAttendanceKey(record.employeeId, record.date);
    const existing = byKey.get(key);
    if (existing) {
      const incoming = { ...record };
      if (incoming.status === "" || incoming.status == null) {
        delete incoming.status;
      }
      if (incoming.transportOverride === "" || incoming.transportOverride == null) {
        delete incoming.transportOverride;
      }
      Object.assign(existing, incoming);
      byKey.set(key, existing);
    } else {
      merged.push(record);
      byKey.set(key, record);
    }
  }

  return merged;
}

function pruneConfirmedPendingAttendanceRecords(serverRecords = [], pendingRecords = []) {
  const byKey = new Map(
    (serverRecords || []).map((record) => [pendingAttendanceKey(record.employeeId, record.date), record])
  );

  return (pendingRecords || []).filter((record) => {
    const key = pendingAttendanceKey(record.employeeId, record.date);
    const server = byKey.get(key);
    if (!server) return true;
    return (
      String(server.status || "") !== String(record.status || "") ||
      String(server.transportOverride || "") !== String(record.transportOverride || "")
    );
  });
}

module.exports = {
  pendingAttendanceKey,
  mergePendingAttendanceRecords,
  pruneConfirmedPendingAttendanceRecords,
};

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

function parseAttendanceTimestampMs(value) {
  if (value == null) return null;
  const ms = Date.parse(String(value).trim());
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Ignore stale realtime rows that would blank out a cell the user just edited.
 * Supabase replication can deliver an older empty-status row after a manual save.
 */
function shouldApplyLiveAttendanceChange(existing, incoming) {
  const incomingStatus = String(incoming?.status || "").trim();
  const existingStatus = String(existing?.status || "").trim();
  if (!incomingStatus && existingStatus) {
    const incomingMs = parseAttendanceTimestampMs(incoming?.updatedAt);
    const existingMs = parseAttendanceTimestampMs(existing?.updatedAt);
    if (existingMs != null) {
      if (incomingMs == null || incomingMs <= existingMs) return false;
    } else {
      return false;
    }
  }
  if (incomingStatus && existingStatus && incomingStatus === existingStatus) return true;
  if (incomingStatus && !existingStatus) return true;
  if (incomingStatus && existingStatus) {
    const incomingMs = parseAttendanceTimestampMs(incoming?.updatedAt);
    const existingMs = parseAttendanceTimestampMs(existing?.updatedAt);
    if (incomingMs != null && existingMs != null) return incomingMs >= existingMs;
    if (incomingMs != null) return true;
    return false;
  }
  return true;
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
  shouldApplyLiveAttendanceChange,
  parseAttendanceTimestampMs,
};

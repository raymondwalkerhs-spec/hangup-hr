/**
 * Sales Rankings report — top agents (sent), closers (closed), agents (checks).
 */
const { rpmClientBucket } = require("./rpm-sale-bucket");
const { isNqFamilyCheck, normalizeCheckStatus } = require("./rpm-check-status");

/** @typedef {"all"|"passed"|"passed_pending"|"denied"} SalesMode */

function normalizeSalesMode(mode) {
  const m = String(mode || "all").toLowerCase().replace(/-/g, "_");
  if (m === "passed" || m === "passed_pending" || m === "denied") return m;
  return "all";
}

function matchesSalesMode(sale, mode) {
  const bucket = rpmClientBucket(sale);
  const m = normalizeSalesMode(mode);
  if (m === "all") return true;
  if (m === "passed") return bucket === "approved";
  if (m === "passed_pending") return bucket === "approved" || bucket === "pending";
  if (m === "denied") return bucket === "dropped";
  return true;
}

function ratePct(part, total) {
  if (!total || total <= 0) return null;
  return Math.round((part / total) * 1000) / 10;
}

const ATTENDANCE_ANOMALY_STATUSES = new Set([
  "Half Day",
  "Quarter Day-Off",
  "Day-OFF",
  "NSNC",
  "NSNC Half Day",
  "Not Approved day off",
]);

const ANOMALY_CAP = 20;
const TOP_LIMIT = 50;

function saleDateKey(sale, dateBasis = "submission") {
  if (dateBasis === "workingDay") {
    return String(sale.workingDay || sale.working_day || "").slice(0, 10);
  }
  return String(sale.submissionDate || sale.submission_date || sale.workingDay || "").slice(0, 10);
}

function inDateRange(dateStr, from, to) {
  const d = String(dateStr || "").slice(0, 10);
  if (!d || !from || !to) return false;
  return d >= from && d <= to;
}

function monthsSpanned(from, to) {
  const out = [];
  const start = String(from).slice(0, 7);
  const end = String(to).slice(0, 7);
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    const [y, m] = cur.split("-").map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    cur = next;
  }
  return out;
}

function buildAnomalyMap(attendanceRows, from, to) {
  const map = new Map();
  for (const row of attendanceRows || []) {
    const date = String(row.date || "").slice(0, 10);
    const status = String(row.status || "").trim();
    const empId = row.employeeId || row.employee_id;
    if (!empId || !inDateRange(date, from, to)) continue;
    if (!ATTENDANCE_ANOMALY_STATUSES.has(status)) continue;
    if (!map.has(empId)) map.set(empId, []);
    map.get(empId).push({ date, status });
  }
  for (const [, rows] of map) {
    rows.sort((a, b) => a.date.localeCompare(b.date));
  }
  return map;
}

function capAnomalies(rows) {
  const list = rows || [];
  if (list.length <= ANOMALY_CAP) return { items: list, more: 0 };
  return { items: list.slice(0, ANOMALY_CAP), more: list.length - ANOMALY_CAP };
}

function assignRanks(sortedRows) {
  let rank = 0;
  let prevCount = null;
  return sortedRows.map((row, idx) => {
    if (row.count !== prevCount) {
      rank = idx + 1;
      prevCount = row.count;
    }
    return { ...row, rank };
  });
}

function salesBreakdown(sales) {
  let passed = 0;
  let pending = 0;
  let denied = 0;
  let retransfer = 0;
  let callback = 0;
  for (const sale of sales) {
    const bucket = rpmClientBucket(sale);
    const fd = sale.formData && typeof sale.formData === "object" ? sale.formData : {};
    const client = String(fd.clientFeedback || "").trim();
    if (bucket === "approved") passed += 1;
    else if (bucket === "dropped") denied += 1;
    else if (bucket === "retransfer") retransfer += 1;
    else if (client === "Callback" || sale.status === "callback") callback += 1;
    else pending += 1;
  }
  return { passed, pending, denied, retransfer, callback, total: sales.length };
}

function checksBreakdown(checks) {
  let q = 0;
  let nq = 0;
  let age_limit = 0;
  let under_age = 0;
  let duplicate = 0;
  for (const c of checks) {
    const st = normalizeCheckStatus(c.checkStatus || c.check_status) || "";
    if (st === "q") q += 1;
    else if (st === "duplicate") duplicate += 1;
    else if (st === "age_limit") age_limit += 1;
    else if (st === "under_age") under_age += 1;
    else if (st === "nq" || isNqFamilyCheck(st)) nq += 1;
  }
  return { q, nq, age_limit, under_age, duplicate, total: checks.length };
}

function matchesChecksFilter(check, checksFilter) {
  const st = normalizeCheckStatus(check.checkStatus || check.check_status) || "";
  const f = String(checksFilter || "all").toLowerCase();
  if (f === "all") return true;
  if (f === "q") return st === "q";
  if (f === "duplicate") return st === "duplicate";
  if (f === "nq") return isNqFamilyCheck(st);
  return true;
}

function employeeLabel(emp) {
  if (!emp) return "";
  return (
    emp.american_name ||
    emp.americanName ||
    emp.name ||
    ""
  );
}

function buildNameHintsFromSales(rpmSales) {
  const map = new Map();
  for (const sale of rpmSales || []) {
    const fd = sale.formData && typeof sale.formData === "object" ? sale.formData : {};
    const agentId = sale.agentId || sale.agent_id;
    const closerId = sale.closerId || sale.closer_id;
    const agentName = String(fd.agentName || sale.agentName || "").trim();
    const closerName = String(fd.closerName || sale.closerName || "").trim();
    if (agentId && agentName) map.set(String(agentId), agentName);
    if (closerId && closerName) map.set(String(closerId), closerName);
  }
  return map;
}

function buildSalesRankingsReport({
  from,
  to,
  dateBasis = "submission",
  checksFilter = "all",
  salesMode = "all",
  employees = [],
  rpmSales = [],
  checks = [],
  attendance = [],
  limit = TOP_LIMIT,
}) {
  if (!from || !to || from > to) {
    throw new Error("Invalid date range");
  }

  const mode = normalizeSalesMode(salesMode);
  const empMap = new Map((employees || []).map((e) => [e.id, e]));
  // When a company roster is provided, only rank people in that company.
  // Empty roster keeps name-hint fallback (unit tests / rare orphan IDs).
  const restrictToRoster = empMap.size > 0;
  const nameHints = buildNameHintsFromSales(rpmSales);
  const companyEmpIds =
    restrictToRoster ? new Set(empMap.keys()) : null;
  const scopedAttendance =
    companyEmpIds && Array.isArray(attendance)
      ? attendance.filter((row) => companyEmpIds.has(row.employeeId || row.employee_id))
      : attendance;
  const anomalyMap = buildAnomalyMap(scopedAttendance, from, to);

  const agentSalesMap = new Map();
  const closerSalesMap = new Map();
  const agentChecksMap = new Map();

  for (const sale of rpmSales || []) {
    const dk = saleDateKey(sale, dateBasis);
    if (!inDateRange(dk, from, to)) continue;
    const agentId = sale.agentId || sale.agent_id;
    const closerId = sale.closerId || sale.closer_id;
    if (agentId && (!restrictToRoster || empMap.has(agentId))) {
      if (!agentSalesMap.has(agentId)) agentSalesMap.set(agentId, []);
      agentSalesMap.get(agentId).push(sale);
    }
    if (closerId && (!restrictToRoster || empMap.has(closerId))) {
      if (!closerSalesMap.has(closerId)) closerSalesMap.set(closerId, []);
      closerSalesMap.get(closerId).push(sale);
    }
  }

  for (const check of checks || []) {
    if (!matchesChecksFilter(check, checksFilter)) continue;
    const wd = String(check.workingDay || check.working_day || "").slice(0, 10);
    if (!inDateRange(wd, from, to)) continue;
    const agentId = check.agentId || check.agent_id;
    if (!agentId) continue;
    if (restrictToRoster && !empMap.has(agentId)) continue;
    if (!agentChecksMap.has(agentId)) agentChecksMap.set(agentId, []);
    agentChecksMap.get(agentId).push(check);
  }

  function salesRowFor(id, allSales) {
    const emp = empMap.get(id);
    const name = employeeLabel(emp) || nameHints.get(String(id)) || "";
    const anomalies = capAnomalies(anomalyMap.get(id));
    const breakdown = salesBreakdown(allSales);
    const filtered = allSales.filter((s) => matchesSalesMode(s, mode));
    const count = filtered.length;
    let ratePctValue = null;
    let rateLabel = null;
    if (mode === "passed") {
      ratePctValue = ratePct(breakdown.passed, breakdown.total);
      rateLabel = "Passed %";
    } else if (mode === "denied") {
      ratePctValue = ratePct(breakdown.denied, breakdown.total);
      rateLabel = "Denied %";
    }
    return {
      employeeId: id,
      name,
      team: emp?.team || "",
      unit: emp?.unit || "",
      count,
      totalSales: breakdown.total,
      ratePct: ratePctValue,
      rateLabel,
      breakdown,
      attendanceAnomalies: anomalies.items,
      attendanceAnomaliesMore: anomalies.more,
    };
  }

  function checksRowFor(id, rows) {
    const emp = empMap.get(id);
    const name = employeeLabel(emp) || nameHints.get(String(id)) || "";
    const anomalies = capAnomalies(anomalyMap.get(id));
    return {
      employeeId: id,
      name,
      team: emp?.team || "",
      unit: emp?.unit || "",
      count: rows.length,
      breakdown: checksBreakdown(rows),
      attendanceAnomalies: anomalies.items,
      attendanceAnomaliesMore: anomalies.more,
    };
  }

  const agents = assignRanks(
    [...agentSalesMap.entries()]
      .map(([id, rows]) => salesRowFor(id, rows))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, limit)
  );

  const closers = assignRanks(
    [...closerSalesMap.entries()]
      .map(([id, rows]) => salesRowFor(id, rows))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, limit)
  );

  const checkAgents = assignRanks(
    [...agentChecksMap.entries()]
      .map(([id, rows]) => checksRowFor(id, rows))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, limit)
  );

  return {
    period: { from, to, dateBasis, checksFilter, salesMode: mode },
    agents,
    closers,
    checkAgents,
    meta: { limit, anomalyCap: ANOMALY_CAP, salesMode: mode },
  };
}

function loadAttendanceForRange(store, from, to, { employeeIds } = {}) {
  const months = monthsSpanned(from, to);
  const rows = [];
  const allow = employeeIds instanceof Set ? employeeIds : employeeIds ? new Set(employeeIds) : null;
  for (const ym of months) {
    for (const row of store.getAttendanceEvents(ym) || []) {
      const id = row.employeeId || row.employee_id;
      if (allow && !allow.has(id)) continue;
      rows.push(row);
    }
  }
  return rows;
}

module.exports = {
  ATTENDANCE_ANOMALY_STATUSES,
  ANOMALY_CAP,
  saleDateKey,
  inDateRange,
  monthsSpanned,
  buildSalesRankingsReport,
  loadAttendanceForRange,
  salesBreakdown,
  checksBreakdown,
  assignRanks,
  normalizeSalesMode,
  matchesSalesMode,
  ratePct,
};

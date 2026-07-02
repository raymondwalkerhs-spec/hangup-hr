const LEAD_ID_PREFIXES = ["TL", "CL", "OP"];
const BACKEND_TRANSFER_ROLES = ["HR", "RTM", "IT"];

const LEAD_POSITIONS = {
  TL: "Team Leader",
  CL: "Closer",
  OP: "OP",
  HR: "HR",
  RTM: "RTM",
  IT: "IT Support",
};

function parseFormerIds(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value)
    .split(/[,;|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function mergeFormerIds(existing, ...ids) {
  const set = new Set(parseFormerIds(existing));
  for (const id of ids) {
    if (id) set.add(String(id).trim());
  }
  return [...set].join(", ");
}

function isLeadershipId(id) {
  const s = String(id || "").trim().toUpperCase();
  if (!s) return false;
  return LEAD_ID_PREFIXES.some((p) => s.startsWith(p));
}

function leadershipSortRank(emp) {
  const id = String(emp?.id || "").trim().toUpperCase();
  for (let i = 0; i < LEAD_ID_PREFIXES.length; i++) {
    if (id.startsWith(LEAD_ID_PREFIXES[i])) return i;
  }
  if (emp?.lead_role && LEAD_ID_PREFIXES.includes(String(emp.lead_role).toUpperCase())) {
    return LEAD_ID_PREFIXES.indexOf(String(emp.lead_role).toUpperCase());
  }
  return 99;
}

function sortEmployeesForLeadDeduct(employees) {
  return [...employees].sort((a, b) => {
    const ra = leadershipSortRank(a);
    const rb = leadershipSortRank(b);
    if (ra !== rb) return ra - rb;
    return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
  });
}

function compareYearMonth(a, b) {
  return String(a || "").localeCompare(String(b || ""));
}

function isNotYetActiveForMonth(emp, month) {
  if (!emp?.promoted_from_id || !emp?.effective_from_month) return false;
  return compareYearMonth(month, emp.effective_from_month) < 0;
}

function isSupersededForMonth(emp, month, byId) {
  if (!emp?.promoted_to_id) return false;
  const successor = byId?.get?.(emp.promoted_to_id);
  const eff = successor?.effective_from_month;
  if (!eff) return true;
  return compareYearMonth(month, eff) >= 0;
}

function isSupersededAgent(emp, month = null) {
  if (!emp?.promoted_to_id) return false;
  if (!month) return true;
  return isSupersededForMonth(emp, month, new Map());
}

function suggestNextLeadId(employees, leadRole = "TL") {
  const prefix = String(leadRole || "TL").toUpperCase();
  if (!LEAD_ID_PREFIXES.includes(prefix)) {
    throw new Error(`Lead role must be one of: ${LEAD_ID_PREFIXES.join(", ")}`);
  }
  const nums = employees
    .map((e) => e.id)
    .filter(Boolean)
    .map((id) => {
      const m = String(id).trim().match(new RegExp(`^${prefix}-?(\\d+)`, "i"));
      return m ? parseInt(m[1], 10) : 0;
    });
  const max = Math.max(0, ...nums);
  return `${prefix}${String(max + 1).padStart(2, "0")}`;
}

function collectIdentityIds(emp, allEmployees = []) {
  if (!emp) return [];
  const ids = new Set([emp.id]);
  parseFormerIds(emp.former_ids).forEach((id) => ids.add(id));
  if (emp.promoted_from_id) ids.add(emp.promoted_from_id);
  for (const e of allEmployees) {
    if (e.promoted_to_id === emp.id) ids.add(e.id);
    if (e.id === emp.promoted_to_id) ids.add(e.id);
  }
  return [...ids];
}

function resolveEmployeeIdForMonth(emp, month, allEmployees = []) {
  if (!emp) return null;
  if (emp.promoted_from_id && emp.effective_from_month && compareYearMonth(month, emp.effective_from_month) < 0) {
    return emp.promoted_from_id;
  }
  if (emp.promoted_to_id) {
    const successor = allEmployees.find((e) => e.id === emp.promoted_to_id) || null;
    const eff = successor?.effective_from_month;
    if (eff && compareYearMonth(month, eff) >= 0) return emp.promoted_to_id;
    if (!eff) return emp.promoted_to_id;
    return emp.id;
  }
  return emp.id;
}

function collectMonthEmployeeIds(store, month) {
  const ids = new Set();
  for (const r of store.getAttendanceEvents(month)) ids.add(r.employeeId);
  for (const r of store.getBonusEvents(month)) ids.add(r.employeeId);
  for (const r of store.getDeductionEvents(month)) ids.add(r.employeeId);
  for (const r of store.getPayrollAdjustments(month)) ids.add(r.employeeId);
  return ids;
}

function mergeEmployeesForMonth(baseEmployees, store, month) {
  const byId = new Map(baseEmployees.map((e) => [e.id, e]));
  for (const id of collectMonthEmployeeIds(store, month)) {
    if (!id || byId.has(id)) continue;
    const emp = store.getEmployeeById(id);
    if (!emp) continue;
    if (isNotYetActiveForMonth(emp, month)) continue;
    if (isSupersededForMonth(emp, month, byId)) continue;
    byId.set(id, emp);
  }
  return [...byId.values()];
}

module.exports = {
  LEAD_ID_PREFIXES,
  BACKEND_TRANSFER_ROLES,
  LEAD_POSITIONS,
  parseFormerIds,
  mergeFormerIds,
  isLeadershipId,
  sortEmployeesForLeadDeduct,
  isSupersededAgent,
  isSupersededForMonth,
  isNotYetActiveForMonth,
  suggestNextLeadId,
  collectIdentityIds,
  resolveEmployeeIdForMonth,
  mergeEmployeesForMonth,
  compareYearMonth,
};

const UNIT_ID_RULES = {
  "HS-1": { prefix: "HS1-", pad: 2 },
  "HS-2": { prefix: "HS2-", pad: 2 },
  "HS-3": { prefix: "HS3-", pad: 2 },
  "HS1-PT": { prefix: "PT-", pad: 2 },
  "HS2-PT": { prefix: "PT-", pad: 2 },
  "HS3-PT": { prefix: "PT-", pad: 2 },
};

const BACKEND_POOLS = {
  HR: { prefix: "HR-", pad: 1 },
  RTM: { prefix: "RTM", pad: 2 },
  IT: { prefix: "IT", pad: 2 },
  MG: { prefix: "MG", pad: 0 },
  OF: { prefix: "OF", pad: 0 },
  NW: { prefix: "NW-", pad: 2 },
};

const employeeIds = require("./employee-ids");

function parseIdNumber(id, prefix) {
  if (!id || !id.startsWith(prefix)) return 0;
  const num = parseInt(id.slice(prefix.length), 10);
  return Number.isFinite(num) ? num : 0;
}

function formatId(prefix, num, pad) {
  if (pad > 0) return `${prefix}${String(num).padStart(pad, "0")}`;
  return `${prefix}${num}`;
}

function suggestNextId(employees, unit, backendPool) {
  const reserved = employeeIds.collectReservedAppIds(employees);
  const rule = UNIT_ID_RULES[unit];
  if (rule) {
    const nums = [];
    for (const e of employees) {
      for (const id of [e.id, ...(employeeIds.parseFormerIds(e.former_ids)), e.archived_app_id].filter(Boolean)) {
        if (reserved.has(String(id).toUpperCase()) || String(id).toUpperCase().startsWith(rule.prefix.toUpperCase())) {
          nums.push(parseIdNumber(id, rule.prefix));
        }
      }
    }
    for (const id of reserved) {
      if (String(id).toUpperCase().startsWith(rule.prefix.toUpperCase())) {
        nums.push(parseIdNumber(id, rule.prefix));
      }
    }
    const max = Math.max(0, ...nums);
    let next = max + 1;
    while (reserved.has(formatId(rule.prefix, next, rule.pad).toUpperCase())) next += 1;
    const pad = unit === "HS-3" && next >= 100 ? 3 : rule.pad;
    return formatId(rule.prefix, next, pad);
  }

  if (unit === "HS-Back-End" && backendPool && BACKEND_POOLS[backendPool]) {
    const pool = BACKEND_POOLS[backendPool];
    const nums = [];
    for (const id of reserved) {
      if (String(id).toUpperCase().startsWith(pool.prefix.toUpperCase())) {
        nums.push(parseIdNumber(id, pool.prefix));
      }
    }
    const max = Math.max(0, ...nums);
    let next = max + 1;
    while (reserved.has(formatId(pool.prefix, next, pool.pad).toUpperCase())) next += 1;
    return formatId(pool.prefix, next, pool.pad);
  }

  if (unit === "HS-Back-End") {
    return suggestNextId(employees, "HS-Back-End", "NW");
  }

  const unitPrefix = unit.replace(/[^A-Z0-9]/gi, "").slice(0, 3).toUpperCase();
  const prefix = unitPrefix ? `${unitPrefix}-` : "EMP-";
  const nums = [];
  for (const id of reserved) {
    if (String(id).toUpperCase().startsWith(prefix.toUpperCase())) {
      nums.push(parseIdNumber(id, prefix));
    }
  }
  const max = Math.max(0, ...nums);
  let next = max + 1;
  while (reserved.has(formatId(prefix, next, 2).toUpperCase())) next += 1;
  return formatId(prefix, next, 2);
}

function getPrefixRule(unit, backendPool) {
  const rule = UNIT_ID_RULES[unit];
  if (rule) return { prefix: rule.prefix, pad: rule.pad };
  if (unit === "HS-Back-End" && backendPool && BACKEND_POOLS[backendPool]) {
    const pool = BACKEND_POOLS[backendPool];
    return { prefix: pool.prefix, pad: pool.pad };
  }
  if (unit === "HS-Back-End") {
    return getPrefixRule("HS-Back-End", "NW");
  }
  const unitPrefix = unit.replace(/[^A-Z0-9]/gi, "").slice(0, 3).toUpperCase();
  const prefix = unitPrefix ? `${unitPrefix}-` : "EMP-";
  return { prefix, pad: 2 };
}

function validateAppIdForUnit(id, unit, backendPool, employees = [], options = {}) {
  const trimmed = String(id || "").trim();
  if (!trimmed) throw new Error("Employee ID required");
  const enforcePrefix = options.enforcePrefix !== false;
  const reserved = employeeIds.collectReservedAppIds(employees);
  if (reserved.has(trimmed.toUpperCase())) {
    throw new Error(`ID ${trimmed} is already reserved or in use`);
  }
  if ((employees || []).some((e) => e.id === trimmed)) {
    throw new Error(`ID ${trimmed} already exists`);
  }
  if (enforcePrefix) {
    const { prefix } = getPrefixRule(unit, backendPool);
    if (prefix && !trimmed.toUpperCase().startsWith(prefix.toUpperCase())) {
      throw new Error(`ID must match unit prefix ${prefix} for ${unit}`);
    }
  }
  return trimmed;
}

function allocateNextAvailableId(employees, unit, backendPool) {
  const available = listAvailableIds(employees, unit, backendPool, 1);
  if (!available.length) throw new Error(`No available IDs for unit ${unit}`);
  return available[0];
}

function listAvailableIds(employees, unit, backendPool, limit = 20) {
  const reserved = employeeIds.collectReservedAppIds(employees);
  const { prefix, pad } = getPrefixRule(unit, backendPool);
  const ids = [];
  let nextNum = parseIdNumber(suggestNextId(employees, unit, backendPool), prefix) || 1;
  let guard = 0;
  while (ids.length < limit && guard < 500) {
    guard += 1;
    const usePad = unit === "HS-3" && nextNum >= 100 ? 3 : pad;
    const candidate = formatId(prefix, nextNum, usePad);
    if (
      !reserved.has(candidate.toUpperCase()) &&
      !(employees || []).some((e) => String(e.id).toUpperCase() === candidate.toUpperCase())
    ) {
      ids.push(candidate);
    }
    nextNum += 1;
  }
  return ids;
}

function getTeamsForUnit(employees, unit) {
  return [
    ...new Set(
      employees.filter((e) => e.unit === unit && e.team).map((e) => e.team)
    ),
  ].sort();
}

function getUnits(employees) {
  return [...new Set(employees.map((e) => e.unit).filter(Boolean))].sort();
}

function isOutEmployee(emp) {
  if (!emp) return true;
  if (emp.status === "Out") return true;
  if (!emp.status && !emp.american_name && !emp.arabic_name) return true;
  return false;
}

const {
  isSupersededAgent,
  isSupersededForMonth,
  isNotYetActiveForMonth,
} = require("./employee-ids");
const { shouldShowInMonth } = require("./depart-attendance");

function filterEmployeesForMonth(employees, month, { hideOut = true, attendanceRecords = [] } = {}) {
  let list = [...employees];
  if (hideOut) {
    list = list.filter((emp) => shouldShowInMonth(emp, month, attendanceRecords, { hideOut: true }));
  }
  const byId = new Map(list.map((e) => [e.id, e]));
  return list.filter((emp) => {
    if (isNotYetActiveForMonth(emp, month)) return false;
    if (isSupersededForMonth(emp, month, byId)) return false;
    return true;
  });
}

function filterEmployees(employees, { hideOut = true, unit, team, q, excludePromoted = true, month = null, includeDeleted = false, attendanceRecords = [] } = {}) {
  let list = [...employees];
  if (!includeDeleted) {
    const { isDeletedEmployee } = require("./employee-identity");
    list = list.filter((e) => !isDeletedEmployee(e));
  }
  if (hideOut && month) {
    const { shouldShowInMonth } = require("./depart-attendance");
    list = list.filter((emp) => shouldShowInMonth(emp, month, attendanceRecords, { hideOut: true }));
  } else if (hideOut) {
    list = list.filter((e) => !isOutEmployee(e));
  }
  if (month) return filterEmployeesForMonth(list, month, { hideOut: false, attendanceRecords });
  if (excludePromoted) list = list.filter((e) => !isSupersededAgent(e));
  if (unit) list = list.filter((e) => e.unit === unit);
  if (team) list = list.filter((e) => e.team === team);
  if (q) {
    const lower = q.toLowerCase();
    list = list.filter(
      (e) =>
        e.id.toLowerCase().includes(lower) ||
        (e.american_name || "").toLowerCase().includes(lower) ||
        (e.arabic_name || "").toLowerCase().includes(lower)
    );
  }
  return list;
}

module.exports = {
  suggestNextId,
  allocateNextAvailableId,
  getPrefixRule,
  validateAppIdForUnit,
  listAvailableIds,
  getTeamsForUnit,
  getUnits,
  isOutEmployee,
  filterEmployees,
  filterEmployeesForMonth,
  BACKEND_POOLS,
  UNIT_ID_RULES,
};

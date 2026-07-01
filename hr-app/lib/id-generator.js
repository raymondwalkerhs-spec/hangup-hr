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
  MG: { prefix: "MG", pad: 0 },
  OF: { prefix: "OF", pad: 0 },
  NW: { prefix: "NW-", pad: 2 },
};

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
  const rule = UNIT_ID_RULES[unit];
  if (rule) {
    const sameUnit = employees.filter((e) => e.unit === unit);
    const nums = sameUnit.map((e) => parseIdNumber(e.id, rule.prefix));
    const alsoByPrefix = employees
      .filter((e) => e.id?.startsWith(rule.prefix))
      .map((e) => parseIdNumber(e.id, rule.prefix));
    const max = Math.max(0, ...nums, ...alsoByPrefix);
    return formatId(rule.prefix, max + 1, rule.pad);
  }

  if (unit === "HS-Back-End" && backendPool && BACKEND_POOLS[backendPool]) {
    const pool = BACKEND_POOLS[backendPool];
    const nums = employees
      .filter((e) => e.id?.startsWith(pool.prefix))
      .map((e) => parseIdNumber(e.id, pool.prefix));
    const max = Math.max(0, ...nums);
    return formatId(pool.prefix, max + 1, pool.pad);
  }

  if (unit === "HS-Back-End") {
    return suggestNextId(employees, "HS-Back-End", "NW");
  }

  const unitPrefix = unit.replace(/[^A-Z0-9]/gi, "").slice(0, 3).toUpperCase();
  const prefix = unitPrefix ? `${unitPrefix}-` : "EMP-";
  const nums = employees
    .filter((e) => e.id?.startsWith(prefix))
    .map((e) => parseIdNumber(e.id, prefix));
  const max = Math.max(0, ...nums);
  return formatId(prefix, max + 1, 2);
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

function filterEmployees(employees, { hideOut = true, unit, team, q } = {}) {
  let list = [...employees];
  if (hideOut) list = list.filter((e) => !isOutEmployee(e));
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
  getTeamsForUnit,
  getUnits,
  isOutEmployee,
  filterEmployees,
  BACKEND_POOLS,
  UNIT_ID_RULES,
};

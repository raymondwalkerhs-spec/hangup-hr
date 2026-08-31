const { isLeadershipId } = require("./employee-ids");
const orgHierarchy = require("./org-hierarchy");

// Dynamic cache of unit → company mapping loaded from org_unit_managers (+ UNIT_RULES fallback).
// This is the authoritative source of truth for which company a unit belongs to.
const _companyUnitMap = new Map();

// Legacy HS2 unit set kept for backward compatibility (now derived from _companyUnitMap).
const _dynamicHs2Units = new Set();

async function refreshDynamicHs2Units() {
  try {
    const mgrs = await orgHierarchy.readUnitManagers();
    _companyUnitMap.clear();
    _dynamicHs2Units.clear();
    // Seed from hardcoded UNIT_RULES first.
    for (const [u, rule] of Object.entries(orgHierarchy.UNIT_RULES)) {
      _companyUnitMap.set(u, (rule && rule.company) || "hangup");
    }
    // Override / extend with the database-authoritative org_unit_managers.company column.
    for (const m of mgrs) {
      if (!m.unit) continue;
      if (m.company) {
        _companyUnitMap.set(m.unit, m.company);
        if (m.company === "hs2") _dynamicHs2Units.add(m.unit);
      }
    }
  } catch {
    /* best-effort */
  }
}

// "Hang-Up" company = HS-1, HS-3 and any non-HS2 unit
// "hs2" company = HS-2 and HS2-PT (and any unit tagged company='hs2' in org_unit_managers)
// This replaces the old 3-way HS1/HS2/HS3 split: HS1+HS3 are now both "Hang-Up"
const HANGUP_DISPLAY_NAME = "Hang-Up";

function parseCompanyContext(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "hs2" || raw === "hs-2") return "hs2";
  return "hangup";
}

/** Dialing units an operator may assign for a company (Hangup cannot set HS-2). */
function unitsForCompanyContext(context) {
  const ctx = parseCompanyContext(context);
  const dialing = orgHierarchy.DIALING_UNITS || ["HS-1", "HS-2", "HS-3"];
  return dialing.filter((u) => getCompanyForUnit(u) === ctx);
}

// Authoritative unit → company resolution. Prefers the DB-backed map, then UNIT_RULES,
// then defaults to "hangup".
function getCompanyForUnit(unit) {
  const u = String(unit || "").trim();
  if (!u) return "hangup";
  if (_companyUnitMap.has(u)) return _companyUnitMap.get(u);
  const rule = orgHierarchy.UNIT_RULES[u];
  if (rule && rule.company) return rule.company;
  return "hangup";
}

function isHs2Unit(unit) {
  return getCompanyForUnit(unit) === "hs2";
}

function isHs2Team(team) {
  const t = String(team || "").trim().toUpperCase();
  return t === "HS2" || t.startsWith("HS2-") || t.includes("HS2");
}

function isHs2Id(id, unit) {
  const s = String(id || "").trim().toUpperCase();
  if (s.startsWith("HS2-")) return true;
  if (s.startsWith("PT-") && isHs2Unit(unit)) return true;
  return false;
}

function isInHs2Scope(emp) {
  if (!emp) return false;
  if (isHs2Id(emp.id, emp.unit)) return true;
  return isHs2Unit(emp.unit) || isHs2Team(emp.team);
}

function isHs2Tl(emp) {
  if (!emp) return false;
  if (!isLeadershipId(emp.id) || !String(emp.id).trim().toUpperCase().startsWith("TL")) {
    return false;
  }
  return isInHs2Scope(emp);
}

function isHiddenInHangupDefault(emp) {
  return isInHs2Scope(emp) || isHs2Tl(emp);
}

function filterEmployeesByCompany(employees, context) {
  const list = Array.isArray(employees) ? employees : [];
  if (parseCompanyContext(context) === "hs2") {
    return list.filter(
      (e) => getCompanyForUnit(e.unit) === "hs2" || isInHs2Scope(e)
    );
  }
  return list.filter((e) => !isHiddenInHangupDefault(e));
}

function applyCompanyFilter(employees, context) {
  return filterEmployeesByCompany(employees, context);
}

function employeeInCompanyContext(emp, context) {
  if (!emp) return false;
  return filterEmployeesByCompany([emp], context).length > 0;
}

function isHs2SaleUnit(unit) {
  const u = String(unit || "").trim();
  return u === "HS-2" || u === "HS2" || isHs2Unit(u);
}

// Resolve the company a user's own unit belongs to (used to let scoped roles such as an
// OP assigned to an HS-2 unit see their own company's data).
function getCompanyForUser(userRole) {
  const unit = userRole && userRole.unit;
  if (unit) {
    const co = getCompanyForUnit(unit);
    if (co && co !== "hangup") return co;
  }
  return "hangup";
}

// Resolve company context for an HTTP request. An explicit ?company=hs2 is honored only for
// users with manage permission. Otherwise, a scoped user (e.g. OP/TL) whose own unit belongs
// to a non-default company sees that company — they are never forced into "hangup".
function resolveCompanyContextForRequest(req) {
  const roles = require("./roles");
  const explicit = parseCompanyContext(
    (req.query && req.query.company) || (req.body && req.body.company)
  );
  if (explicit === "hs2") {
    if (roles.canAccessHs2CompanyContext(req.userRole)) return "hs2";
    return "hangup";
  }
  const co = getCompanyForUser(req.userRole);
  if (co && co !== "hangup") return co;
  return "hangup";
}

function resolveCompanyContextForUser(value, userRole) {
  const roles = require("./roles");
  const explicit = parseCompanyContext(value);
  if (explicit === "hs2") {
    if (roles.canAccessHs2CompanyContext(userRole)) return "hs2";
    return "hangup";
  }
  const co = getCompanyForUser(userRole);
  if (co && co !== "hangup") return co;
  return explicit || "hangup";
}

function filterOrgUnitsForRole(orgUnits, userRole) {
  const roles = require("./roles");
  if (roles.canManageHs2Company(userRole)) return orgUnits || [];
  // A scoped user (OP/TL) whose own unit belongs to HS-2 still sees their company's units.
  if (getCompanyForUser(userRole) === "hs2") return orgUnits || [];
  return (orgUnits || []).filter((u) => !isHs2Unit(u));
}

function filterUnitsListForRole(units, userRole) {
  const roles = require("./roles");
  if (roles.canManageHs2Company(userRole)) return units || [];
  if (getCompanyForUser(userRole) === "hs2") return units || [];
  return (units || []).filter((u) => !isHs2Unit(u));
}

/** Strict: HS-2 sales only in hs2 company context; stripped on hangup tab for all roles. */
function filterSalesByCompanyContext(sales, context) {
  const list = sales || [];
  if (parseCompanyContext(context) === "hs2") {
    return list.filter((s) => isHs2SaleUnit(s.unit || s.formData?.unit));
  }
  return list.filter((s) => !isHs2SaleUnit(s.unit || s.formData?.unit));
}

function filterHs2SalesForRole(sales, userRole, context) {
  if (context != null) return filterSalesByCompanyContext(sales, context);
  return filterSalesByCompanyContext(sales, getCompanyForUser(userRole));
}

module.exports = {
  parseCompanyContext,
  unitsForCompanyContext,
  resolveCompanyContextForUser,
  resolveCompanyContextForRequest,
  getCompanyForUser,
  getCompanyForUnit,
  filterEmployeesByCompany,
  applyCompanyFilter,
  employeeInCompanyContext,
  filterOrgUnitsForRole,
  filterUnitsListForRole,
  filterHs2SalesForRole,
  filterSalesByCompanyContext,
  isHs2SaleUnit,
  isInHs2Scope,
  isHiddenInHangupDefault,
  isHs2Tl,
  isHs2Unit,
  isHs2Team,
  isHs2Id,
  refreshDynamicHs2Units,
};

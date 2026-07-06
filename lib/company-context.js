const { isLeadershipId } = require("./employee-ids");

const HS2_UNITS = new Set(["HS-2", "HS2-PT"]);

function parseCompanyContext(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "hs2" || raw === "hs-2") return "hs2";
  return "hangup";
}

function isHs2Unit(unit) {
  return HS2_UNITS.has(String(unit || "").trim());
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
    return list.filter(isInHs2Scope);
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

function resolveCompanyContextForUser(value, userRole) {
  const company = parseCompanyContext(value);
  if (company !== "hs2") return company;
  const roles = require("./roles");
  return roles.canManageHs2Company(userRole) ? "hs2" : "hangup";
}

function filterOrgUnitsForRole(orgUnits, userRole) {
  const roles = require("./roles");
  if (roles.canManageHs2Company(userRole)) return orgUnits || [];
  return (orgUnits || []).filter((u) => u !== "HS-2");
}

function filterUnitsListForRole(units, userRole) {
  const roles = require("./roles");
  if (roles.canManageHs2Company(userRole)) return units || [];
  return (units || []).filter((u) => {
    const t = String(u || "").trim();
    return t !== "HS-2" && t !== "HS2" && t !== "HS2-PT";
  });
}

function filterHs2SalesForRole(sales, userRole) {
  const roles = require("./roles");
  if (roles.canSeeHs2InSales(userRole)) return sales || [];
  return (sales || []).filter((s) => !isHs2SaleUnit(s.unit || s.formData?.unit));
}

module.exports = {
  parseCompanyContext,
  resolveCompanyContextForUser,
  filterEmployeesByCompany,
  applyCompanyFilter,
  employeeInCompanyContext,
  filterOrgUnitsForRole,
  filterUnitsListForRole,
  filterHs2SalesForRole,
  isHs2SaleUnit,
  isInHs2Scope,
  isHiddenInHangupDefault,
  isHs2Tl,
  isHs2Unit,
  isHs2Team,
  isHs2Id,
};

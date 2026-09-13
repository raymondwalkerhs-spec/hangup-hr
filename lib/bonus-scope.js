/**
 * Role-scoped recipient / payer lists for Bonus from TL / OP (and bonus requests).
 *
 * - HR / Admin / CEO: anyone (non-deleted / not Out)
 * - TL: anyone in their unit(s) (led teams' units + home unit), any team
 * - OP: anyone in their OP units
 * - RTM: anyone Active in their unit (any team)
 * - Quality: any agent in dialing units (HS-1 / HS-2 / HS-3)
 */
const roles = require("./roles");
const employeeIds = require("./employee-ids");
const employeeStatus = require("./employee-status");
const orgHierarchy = require("./org-hierarchy");
const { isDeletedEmployee } = require("./employee-identity");

function normalizeRole(userRole) {
  return roles.normalizeRole(userRole?.role || userRole);
}

function isActiveEmp(emp) {
  return employeeStatus.normalizeStatusKey(emp?.status) === "active";
}

function isAliveEmp(emp) {
  if (!emp || isDeletedEmployee(emp)) return false;
  return !employeeStatus.isOutStatus(emp.status);
}

function dialingUnitSet() {
  return new Set(orgHierarchy.DIALING_UNITS || ["HS-1", "HS-2", "HS-3"]);
}

function isDialingAgent(emp) {
  if (!emp) return false;
  if (!dialingUnitSet().has(String(emp.unit || "").trim())) return false;
  return !employeeIds.isBonusTransferPayerId(emp.id);
}

function tlUnits(userRole) {
  const units = new Set();
  if (userRole?.unit) units.add(String(userRole.unit).trim());
  for (const lt of userRole?.leadTeams || []) {
    if (lt?.unit) units.add(String(lt.unit).trim());
  }
  for (const xt of userRole?.teamDashboardExtraTeams || []) {
    if (xt?.unit) units.add(String(xt.unit).trim());
  }
  return units;
}

function opUnits(userRole) {
  const units = new Set(userRole?.opUnits || []);
  if (userRole?.unit) units.add(String(userRole.unit).trim());
  return units;
}

function rtmUnit(userRole) {
  return String(userRole?.unit || "").trim();
}

function sortById(list) {
  return [...list].sort((a, b) =>
    String(a.id).localeCompare(String(b.id), undefined, { numeric: true })
  );
}

function employeesForBonusRecipient(userRole, employees) {
  const list = (employees || []).filter(isAliveEmp);
  const role = normalizeRole(userRole);

  if (roles.canManageEmployees(userRole) || ["admin", "ceo", "hr"].includes(role)) {
    return sortById(list);
  }

  if (role === "tl") {
    const units = tlUnits(userRole);
    if (!units.size) {
      return sortById(list.filter((e) => e.id === userRole.employeeId));
    }
    return sortById(list.filter((e) => units.has(String(e.unit || "").trim())));
  }

  if (role === "op") {
    const units = opUnits(userRole);
    if (!units.size) return sortById(list);
    return sortById(list.filter((e) => units.has(String(e.unit || "").trim())));
  }

  if (role === "rtm") {
    const unit = rtmUnit(userRole);
    const active = list.filter(isActiveEmp);
    if (!unit) return sortById(active);
    return sortById(active.filter((e) => String(e.unit || "").trim() === unit));
  }

  if (role === "quality") {
    return sortById(list.filter(isDialingAgent));
  }

  return sortById(roles.filterEmployeesForUser(list, userRole));
}

function employeesForBonusPayer(userRole, employees) {
  const list = (employees || []).filter(isAliveEmp);
  const role = normalizeRole(userRole);

  // HR / Admin / CEO: anyone (to and from)
  if (roles.canManageEmployees(userRole) || ["admin", "ceo", "hr"].includes(role)) {
    return sortById(list);
  }

  // Payers = transfer-capable IDs (or self) inside the same geographic scope as recipients.
  let scopeFilter = () => true;
  if (role === "tl") {
    const units = tlUnits(userRole);
    scopeFilter = (e) =>
      !units.size ||
      units.has(String(e.unit || "").trim()) ||
      e.id === userRole?.employeeId;
  } else if (role === "op") {
    const units = opUnits(userRole);
    scopeFilter = (e) =>
      !units.size ||
      units.has(String(e.unit || "").trim()) ||
      e.id === userRole?.employeeId;
  } else if (role === "rtm") {
    const unit = rtmUnit(userRole);
    scopeFilter = (e) =>
      !unit ||
      String(e.unit || "").trim() === unit ||
      e.id === userRole?.employeeId;
  } else if (role === "quality") {
    const dialing = dialingUnitSet();
    scopeFilter = (e) =>
      dialing.has(String(e.unit || "").trim()) || e.id === userRole?.employeeId;
  }

  const scoped = list.filter(scopeFilter);
  const payers = scoped.filter(
    (e) => employeeIds.isBonusTransferPayerId(e.id) || e.id === userRole?.employeeId
  );
  if (payers.length) return sortById(payers);
  return sortById(scoped);
}

function canGrantBonusTransfer(userRole, recipient, giverEmp, employees) {
  if (!recipient || !giverEmp) return false;
  if (roles.canManageEmployees(userRole)) return true;
  if (!roles.canTransferBonus(userRole)) return false;
  const all = employees || [];
  const recipients = employeesForBonusRecipient(userRole, all);
  const payers = employeesForBonusPayer(userRole, all);
  const okTo = recipients.some((e) => e.id === recipient.id);
  const okFrom = payers.some((e) => e.id === giverEmp.id);
  return okTo && okFrom;
}

function pickerPayload(employees) {
  return (employees || []).map((e) => ({
    id: e.id,
    american_name: e.american_name || e.americanName || "",
    unit: e.unit || "",
    team: e.team || "",
    status: e.status || "",
  }));
}

function buildBonusPickerScope(userRole, employees) {
  return {
    recipients: pickerPayload(employeesForBonusRecipient(userRole, employees)),
    payers: pickerPayload(employeesForBonusPayer(userRole, employees)),
    canManageWide: roles.canManageEmployees(userRole),
    canTransfer: roles.canTransferBonus(userRole),
  };
}

module.exports = {
  employeesForBonusRecipient,
  employeesForBonusPayer,
  canGrantBonusTransfer,
  buildBonusPickerScope,
  isDialingAgent,
  tlUnits,
};

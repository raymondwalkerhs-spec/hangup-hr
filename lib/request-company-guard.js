/**
 * Shared company-context guards for API routes (Hang-Up vs HS-2).
 */
const companyContext = require("./company-context");
const roles = require("./roles");
const store = require("./data-store");

function parseCompany(req) {
  return companyContext.resolveCompanyContextForUser(req.query.company || req.body?.company, req.userRole);
}

function assertEmployeeInCompanyContext(emp, req) {
  if (!emp) return false;
  if (!companyContext.employeeInCompanyContext(emp, parseCompany(req))) return false;
  return roles.canAccessEmployee(req.userRole, emp);
}

function requireEmployeeInContext(req, res, employeeId) {
  const emp = store.getEmployeeById(employeeId);
  if (!emp || !assertEmployeeInCompanyContext(emp, req)) {
    res.status(404).json({ error: "Employee not found" });
    return null;
  }
  return emp;
}

function unitInCompanyContext(unit, req) {
  if (!unit) return false;
  return companyContext.getCompanyForUnit(unit) === parseCompany(req);
}

async function teamInCompanyContext(teamId, req) {
  const hrms = require("./hrms-repo");
  const teams = await hrms.readOrgTeams();
  const team = (teams || []).find((t) => String(t.id) === String(teamId));
  if (!team?.unit) return false;
  return unitInCompanyContext(team.unit, req);
}

async function assertRegistrationInContext(req, res, registrationId) {
  const registration = require("./registration");
  const company = parseCompany(req);
  const pending = await registration.listPendingRegistrations(company);
  const row = pending.find((r) => String(r.id) === String(registrationId));
  if (!row) {
    res.status(404).json({ error: "Registration not found" });
    return false;
  }
  return true;
}

module.exports = {
  parseCompany,
  assertEmployeeInCompanyContext,
  requireEmployeeInContext,
  unitInCompanyContext,
  teamInCompanyContext,
  assertRegistrationInContext,
};

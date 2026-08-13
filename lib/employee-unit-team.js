/**
 * Keep employee unit + team in the same company / org unit.
 */
const { teamsMatch } = require("./team-names");
const companyContext = require("./company-context");

async function teamsForUnit(unit) {
  const u = String(unit || "").trim();
  if (!u) return [];
  const names = new Set();
  try {
    const hrms = require("./hrms-repo");
    const orgTeams = await hrms.readOrgTeams();
    for (const t of orgTeams || []) {
      if (String(t.unit || "").trim() === u && t.name) names.add(String(t.name).trim());
    }
  } catch {
    /* optional */
  }
  try {
    const store = require("./data-store");
    for (const t of store.getTeams(u) || []) names.add(String(t).trim());
  } catch {
    /* optional */
  }
  return [...names].filter(Boolean);
}

function teamInList(team, allowed) {
  const t = String(team || "").trim();
  if (!t) return true;
  if (!allowed.length) return true;
  return allowed.some((n) => teamsMatch(n, t));
}

async function assertEmployeeUnitTeam({
  unit,
  team,
  previousUnit,
  previousTeam,
  requireTeamOnCompanyChange = false,
} = {}) {
  const u = String(unit || "").trim();
  if (!u) throw new Error("Unit is required");
  const t = String(team || "").trim();
  const prevU = String(previousUnit || "").trim();
  const prevT = String(previousTeam || "").trim();
  const companyChanged =
    Boolean(prevU) && companyContext.getCompanyForUnit(prevU) !== companyContext.getCompanyForUnit(u);

  if (companyChanged && requireTeamOnCompanyChange) {
    if (!t) throw new Error("Moving to another company requires choosing a team in that company");
    if (prevT && teamsMatch(t, prevT)) {
      throw new Error("Moving to another company requires choosing a different team");
    }
  }

  const allowed = await teamsForUnit(u);
  if (t && !teamInList(t, allowed)) {
    throw new Error(`Team "${t}" is not in unit ${u}. Choose a team for that unit.`);
  }
  return true;
}

module.exports = {
  teamsForUnit,
  teamInList,
  assertEmployeeUnitTeam,
};

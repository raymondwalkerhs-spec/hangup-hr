/** Normalize team labels ("Team Tris" → "Tris") for roster vs org_teams matching. */
function normalizeTeamName(name) {
  let n = String(name || "").trim();
  if (/^team\s+/i.test(n)) n = n.replace(/^team\s+/i, "").trim();
  return n;
}

function teamsMatch(a, b) {
  if (!a || !b) return false;
  return normalizeTeamName(a).toLowerCase() === normalizeTeamName(b).toLowerCase();
}

function canonicalTeamName(name, teamsMeta = []) {
  const norm = normalizeTeamName(name).toLowerCase();
  if (!norm) return "";
  for (const t of teamsMeta) {
    if (normalizeTeamName(t.name).toLowerCase() === norm) return t.name;
  }
  return normalizeTeamName(name);
}

function employeeTeamKey(emp, teamsMeta = []) {
  return canonicalTeamName(emp?.team, teamsMeta) || normalizeTeamName(emp?.team);
}

module.exports = {
  normalizeTeamName,
  teamsMatch,
  canonicalTeamName,
  employeeTeamKey,
};

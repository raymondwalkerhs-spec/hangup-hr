const { isLeadershipId } = require("./employee-ids");
const { isOutStatus, normalizeStatusKey } = require("./employee-status");

const NON_DIAL_UNITS = new Set(["HS-Back-End", "HS-MGMT", "HR-MGMT", "Management"]);
const NON_DIAL_TEAMS = new Set(["HR", "Quality", "Back-End", "Daemon"]);
const NON_DIAL_ID_PREFIXES = ["HR", "MG", "OF", "NW", "RTM", "QA", "OP", "TL", "CL"];

function isPartTimeUnit(unit) {
  const u = String(unit || "").trim();
  return /-PT$/i.test(u) || u.includes("PT");
}

function isNonDialPosition(position) {
  const p = String(position || "").trim().toLowerCase();
  if (!p) return false;
  return (
    p.includes("team leader") ||
    p.includes("closer") ||
    p === "op" ||
    p.includes("quality") ||
    p.includes("rtm") ||
    p.includes("hr ") ||
    p.startsWith("hr ")
  );
}

function isDialingAgent(emp, { includeOut = false, activeOnly = false } = {}) {
  if (!emp) return false;
  const id = String(emp.id || "").trim().toUpperCase();
  if (!id) return false;
  if (isLeadershipId(id)) return false;
  if (NON_DIAL_ID_PREFIXES.some((p) => id.startsWith(p))) return false;

  const unit = String(emp.unit || "").trim();
  if (NON_DIAL_UNITS.has(unit)) return false;
  if (isPartTimeUnit(unit)) return false;

  const team = String(emp.team || "").trim();
  if (NON_DIAL_TEAMS.has(team)) return false;

  if (isNonDialPosition(emp.position)) return false;

  if (activeOnly && normalizeStatusKey(emp.status) !== "active") return false;
  if (!includeOut && isOutStatus(emp.status)) return false;
  return true;
}

function filterDialingAgents(employees, opts = {}) {
  return (employees || []).filter((e) => isDialingAgent(e, opts));
}

module.exports = {
  isDialingAgent,
  filterDialingAgents,
  NON_DIAL_UNITS,
  NON_DIAL_TEAMS,
};

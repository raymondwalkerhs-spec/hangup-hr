const { teamsMatch } = require("./team-names");
const { normalizeRole } = require("./roles");

const IMAGE_PLACEMENTS = ["top", "middle", "bottom"];

const ROLE_LABELS = {
  agent: "Agent",
  office_assistant: "Office assistant",
  quality: "Quality",
  rtm: "RTM",
  public_relations: "Public relations",
  tl: "Team lead",
  op: "OP",
  finance: "Finance",
  it: "IT",
  hr: "HR",
  admin: "Admin",
  ceo: "CEO",
};

async function filterAudienceToCompany({ audienceUnits, audienceTeams, audienceRoles } = {}, company) {
  const companyContext = require("./company-context");
  const co = company === "hs2" ? "hs2" : "hangup";
  const rawUnits = normalizeList(audienceUnits);
  const rawTeams = normalizeList(audienceTeams);
  const units = rawUnits.filter((u) => companyContext.getCompanyForUnit(u) === co);
  let teams = rawTeams;
  if (rawTeams.length) {
    const allowed = new Set();
    try {
      const store = require("./data-store");
      for (const e of companyContext.filterEmployeesByCompany(store.getEmployees({ hideOut: true }) || [], co)) {
        if (e.team) allowed.add(String(e.team).trim());
      }
    } catch {
      /* optional */
    }
    try {
      const orgTeams = await require("./hrms-repo").readOrgTeams();
      for (const t of orgTeams || []) {
        const unit = String(t.unit || "").trim();
        const name = String(t.name || t.team || "").trim();
        if (!name || !unit) continue;
        if (companyContext.getCompanyForUnit(unit) === co) allowed.add(name);
      }
    } catch {
      /* optional */
    }
    teams = rawTeams.filter((name) => [...allowed].some((a) => teamsMatch(a, name)));
  }
  if (rawUnits.length && !units.length) {
    throw new Error("Audience units must belong to the current company");
  }
  if (rawTeams.length && !teams.length) {
    throw new Error("Audience teams must belong to the current company");
  }
  return {
    audienceUnits: units,
    audienceTeams: teams,
    audienceRoles: normalizeRoles(audienceRoles),
  };
}

function normalizeList(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((v) => String(v || "").trim()).filter(Boolean))];
}

function normalizeRoles(values) {
  return [...new Set(normalizeList(values).map((v) => normalizeRole(v)).filter((v) => v && v !== "none"))];
}

function normalizePlacement(value) {
  const v = String(value || "top").trim().toLowerCase();
  return IMAGE_PLACEMENTS.includes(v) ? v : "top";
}

function isCompanyWide(ann) {
  return (
    !normalizeList(ann?.audienceUnits).length &&
    !normalizeList(ann?.audienceTeams).length &&
    !normalizeList(ann?.audienceRoles).length
  );
}

function userTeams(userRole) {
  const out = [];
  if (userRole?.team) out.push(userRole.team);
  for (const t of userRole?.leadTeams || []) if (t?.team) out.push(t.team);
  for (const t of userRole?.closerTeams || []) if (t?.team) out.push(t.team);
  return out;
}

function userUnits(userRole) {
  const out = [];
  if (userRole?.unit) out.push(userRole.unit);
  for (const t of userRole?.leadTeams || []) if (t?.unit) out.push(t.unit);
  for (const t of userRole?.closerTeams || []) if (t?.unit) out.push(t.unit);
  return out;
}

function canViewAnnouncement(ann, userRole, { isEditor = false } = {}) {
  if (isEditor) return true;
  if (!ann) return false;
  if (isCompanyWide(ann)) return true;
  const units = normalizeList(ann.audienceUnits);
  const teams = normalizeList(ann.audienceTeams);
  const roleList = normalizeRoles(ann.audienceRoles);
  if (units.length) {
    const mine = userUnits(userRole);
    if (!units.some((u) => mine.includes(u))) return false;
  }
  if (teams.length) {
    const mine = userTeams(userRole);
    if (!teams.some((t) => mine.some((m) => teamsMatch(t, m)))) return false;
  }
  if (roleList.length) {
    const role = normalizeRole(userRole?.role);
    if (!roleList.includes(role)) return false;
  }
  return true;
}

function audienceSummary(ann) {
  if (isCompanyWide(ann)) return "Whole company";
  const parts = [];
  const units = normalizeList(ann.audienceUnits);
  const teams = normalizeList(ann.audienceTeams);
  const roleList = normalizeRoles(ann.audienceRoles);
  if (units.length) parts.push(`Units: ${units.join(", ")}`);
  if (teams.length) parts.push(`Teams: ${teams.join(", ")}`);
  if (roleList.length) parts.push(`Roles: ${roleList.map((r) => ROLE_LABELS[r] || r).join(", ")}`);
  return parts.join(" · ") || "Whole company";
}

function splitBodyHtml(html) {
  const s = String(html || "");
  const tokens = s.split(/(<\/p>)/i);
  if (tokens.length < 3) return { before: s, after: "" };
  let cut = Math.ceil(tokens.length / 2);
  while (cut < tokens.length && !/^<\/p>$/i.test(tokens[cut] || "")) cut += 1;
  if (cut >= tokens.length) cut = Math.ceil(tokens.length / 2);
  return {
    before: tokens.slice(0, cut + 1).join(""),
    after: tokens.slice(cut + 1).join(""),
  };
}

module.exports = {
  IMAGE_PLACEMENTS,
  ROLE_LABELS,
  normalizeList,
  filterAudienceToCompany,
  normalizeRoles,
  normalizePlacement,
  isCompanyWide,
  canViewAnnouncement,
  audienceSummary,
  splitBodyHtml,
};

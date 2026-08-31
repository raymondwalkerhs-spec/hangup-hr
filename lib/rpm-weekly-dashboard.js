/**
 * RPM weekly Dashboard aggregation: closers, agents, clients, team targets.
 */
const { employeeDisplayName } = require("./attendance");
const { employeeTeamKey, teamsMatch, normalizeTeamName } = require("./team-names");
const { saleMatchesCountMode, normalizeCountMode } = require("./rpm-sale-bucket");
const salesScope = require("./sales-scope");

function pad2(n) {
  return String(n).padStart(2, "0");
}

function isoDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function mondayOf(dateStr) {
  const dt = new Date(`${String(dateStr).slice(0, 10)}T12:00:00`);
  const day = dt.getDay();
  const monday = new Date(dt);
  monday.setDate(dt.getDate() - ((day + 6) % 7));
  return isoDate(monday);
}

function fridayOfMonday(monday) {
  const dt = new Date(`${monday}T12:00:00`);
  dt.setDate(dt.getDate() + 4);
  return isoDate(dt);
}

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

/** Weeks (Mon–Fri) that overlap the calendar month YYYY-MM. */
function listWeeksForMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("month=YYYY-MM required");
  const [y, m] = month.split("-").map(Number);
  const first = `${y}-${pad2(m)}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const last = `${y}-${pad2(m)}-${pad2(lastDay)}`;
  const weeks = [];
  let monday = mondayOf(first);
  // If first weekday of month is after Friday of that week, still include if any Mon–Fri day falls in month
  while (monday <= last) {
    const friday = fridayOfMonday(monday);
    const overlaps = monday <= last && friday >= first;
    if (overlaps) {
      const daysInMonth = [];
      for (let i = 0; i < 5; i++) {
        const d = addDays(monday, i);
        if (d >= first && d <= last) daysInMonth.push(d);
      }
      if (daysInMonth.length) {
        weeks.push({
          weekIndex: weeks.length + 1,
          monday,
          friday,
          daysInMonth,
        });
      }
    }
    monday = addDays(monday, 7);
    if (weeks.length > 8) break;
  }
  return weeks;
}

function saleWorkingDay(sale) {
  return String(sale.workingDay || String(sale.submissionDate || "").slice(0, 10) || "").slice(0, 10);
}

function empByIdMap(employees) {
  const map = new Map();
  for (const e of employees || []) {
    if (!e?.id) continue;
    map.set(e.id, e);
    map.set(String(e.id).toUpperCase(), e);
  }
  return map;
}

function resolvePersonName(empMap, id, formDataName) {
  const key = String(id || "").trim();
  if (!key) return "";
  const emp = empMap.get(key) || empMap.get(key.toUpperCase());
  if (emp) {
    const n = employeeDisplayName(emp);
    if (n && n !== emp.id) return n;
    if (emp.american_name?.trim()) return emp.american_name.trim();
    if (emp.arabic_name?.trim()) return emp.arabic_name.trim();
  }
  const fd = String(formDataName || "").trim();
  if (fd) return fd;
  return key;
}

function targetPct(count, target) {
  if (target == null || !(Number(target) > 0)) return null;
  return Math.round((Number(count) / Number(target)) * 100);
}

function targetColorBand(pct) {
  if (pct == null) return null;
  if (pct < 50) return "red";
  if (pct < 100) return "amber";
  if (pct <= 120) return "green";
  return "teal";
}

function rankEntries(countMap, nameResolver) {
  const rows = [...countMap.entries()]
    .map(([id, count]) => ({
      id,
      name: nameResolver(id),
      count,
    }))
    .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

function buildWeekBlock({
  week,
  sales,
  mode,
  empMap,
  teamsMeta,
  targetsByKey,
  teamFilter,
}) {
  const monday = week.monday;
  const friday = week.friday;
  const inWeek = (sales || []).filter((s) => {
    const wd = saleWorkingDay(s);
    if (!wd || wd < monday || wd > friday) return false;
    if (!saleMatchesCountMode(s, mode)) return false;
    if (teamFilter) {
      const { teamsMatch: tm } = require("./team-names");
      if (!tm(s.team, teamFilter)) return false;
    }
    return true;
  });

  const closerCounts = new Map();
  const agentCounts = new Map();
  const clientCounts = new Map();
  const teamCounts = new Map();
  let unassignedCloserCount = 0;
  let unassignedAgentCount = 0;
  const closerFormName = new Map();
  const agentFormName = new Map();

  const canonicalMeta = new Map();
  for (const t of teamsMeta || []) {
    canonicalMeta.set(employeeTeamKey({ team: t.name }, teamsMeta), t.name);
  }

  for (const s of inWeek) {
    const fd = s.formData && typeof s.formData === "object" ? s.formData : {};
    const closerId = String(s.closerId || "").trim();
    const agentId = String(s.agentId || "").trim();
    if (closerId) {
      closerCounts.set(closerId, (closerCounts.get(closerId) || 0) + 1);
      if (!closerFormName.has(closerId) && fd.closerName) closerFormName.set(closerId, fd.closerName);
    } else {
      unassignedCloserCount += 1;
    }
    if (agentId) {
      agentCounts.set(agentId, (agentCounts.get(agentId) || 0) + 1);
      if (!agentFormName.has(agentId) && fd.agentName) agentFormName.set(agentId, fd.agentName);
    } else {
      unassignedAgentCount += 1;
    }
    const client = String(s.client || "").trim() || "Unassigned client";
    clientCounts.set(client, (clientCounts.get(client) || 0) + 1);

    const rawTeam = String(s.team || "").trim();
    if (rawTeam) {
      const key = employeeTeamKey({ team: rawTeam }, teamsMeta) || normalizeTeamName(rawTeam) || rawTeam;
      const canonical = canonicalMeta.get(key) || key;
      teamCounts.set(canonical, (teamCounts.get(canonical) || 0) + 1);
    }
  }

  const weekTotal = inWeek.length;

  const closers = rankEntries(closerCounts, (id) =>
    resolvePersonName(empMap, id, closerFormName.get(id))
  ).map((r) => ({
    ...r,
    sharePct: weekTotal ? Math.round((r.count / weekTotal) * 100) : 0,
  }));

  const agents = rankEntries(agentCounts, (id) =>
    resolvePersonName(empMap, id, agentFormName.get(id))
  ).map((r) => ({
    ...r,
    sharePct: weekTotal ? Math.round((r.count / weekTotal) * 100) : 0,
  }));

  const clients = rankEntries(clientCounts, (id) => id).map((r) => ({
    ...r,
    sharePct: weekTotal ? Math.round((r.count / weekTotal) * 100) : 0,
  }));

  return {
    weekIndex: week.weekIndex,
    monday,
    friday,
    daysInMonth: week.daysInMonth,
    total: weekTotal,
    closers,
    agents,
    clients,
    teamCounts,
    unassignedCloserCount,
    unassignedAgentCount,
    targetsByKey,
  };
}

function collectTeamRoster({ teamsMeta, sales, targets, company, opUnits, leadTeams, teamFilter }) {
  const byKey = new Map();
  const leadEntries = Array.isArray(leadTeams) ? leadTeams : null;

  function matchesLead(name, unit) {
    if (!leadEntries || !leadEntries.length) return true;
    return leadEntries.some(
      (lt) =>
        teamsMatch(name, lt.team || lt.name) &&
        (!lt.unit || !unit || String(lt.unit) === String(unit))
    );
  }

  function addTeam(name, unit) {
    const n = String(name || "").trim();
    if (!n) return;
    if (teamFilter && !teamsMatch(n, teamFilter)) return;
    const u = String(unit || "").trim();
    if (opUnits && opUnits.size && u && !opUnits.has(u)) return;
    if (!matchesLead(n, u)) return;
    const key = `${u}::${normalizeTeamName(n) || n}`.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, { team: n, unit: u });
  }

  for (const t of teamsMeta || []) {
    if (t.dialsSales === false) continue;
    addTeam(t.name, t.unit);
  }

  for (const s of sales || []) {
    if (!s.team) continue;
    addTeam(s.team, s.unit);
  }

  for (const t of targets || []) {
    addTeam(t.team, t.unit);
  }

  return [...byKey.values()].sort((a, b) => {
    const u = String(a.unit).localeCompare(String(b.unit));
    if (u) return u;
    return String(a.team).localeCompare(String(b.team));
  });
}

/** Lead-team entries for TL / dual-role TL viewers. */
function leadTeamEntriesForUser(userRole) {
  const entries = [
    ...(userRole?.leadTeams || []),
    ...(userRole?.teamDashboardExtraTeams || []),
  ]
    .map((lt) => ({
      team: String(lt.team || lt.name || "").trim(),
      unit: String(lt.unit || "").trim() || null,
    }))
    .filter((lt) => lt.team);
  if (!entries.length && String(userRole?.role || "").toLowerCase() === "tl" && userRole?.team) {
    entries.push({
      team: String(userRole.team).trim(),
      unit: String(userRole.unit || "").trim() || null,
    });
  }
  const seen = new Set();
  return entries.filter((lt) => {
    const k = `${lt.unit || ""}|${lt.team}`.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function saleMatchesLeadTeams(sale, leadEntries) {
  if (!leadEntries?.length) return true;
  return leadEntries.some(
    (lt) =>
      teamsMatch(sale.team, lt.team) &&
      (!lt.unit || !sale.unit || String(sale.unit) === String(lt.unit))
  );
}

/** Company-wide weekly viewers (not OP/TL scoped). */
function isCompanyRpmWeeklyViewer(userRole) {
  return (salesScope.COMPANY_VIEW_ROLES || []).includes(userRole?.role);
}

function isTlScopedRpmWeeklyViewer(userRole) {
  if (isCompanyRpmWeeklyViewer(userRole)) return false;
  if (String(userRole?.role || "").toLowerCase() === "op") return false;
  return leadTeamEntriesForUser(userRole).length > 0;
}

function targetLookupKey(company, unit, team, weekStart) {
  return `${company}|${String(unit || "").trim()}|${normalizeTeamName(team) || team}|${weekStart}`.toLowerCase();
}

function buildRpmWeeklyDashboard({
  month,
  mode: rawMode,
  sales,
  employees,
  teamsMeta = [],
  targets = [],
  targetsAvailable = true,
  userRole,
  company = "hangup",
  teamFilter = null,
  truncated = false,
}) {
  const mode = normalizeCountMode(rawMode);
  const weeksMeta = listWeeksForMonth(month);
  const empMap = empByIdMap(employees);

  const opUnits =
    userRole?.role === "op"
      ? new Set([...(userRole.opUnits || []), userRole.unit].filter(Boolean).map(String))
      : null;

  const leadTeams = isTlScopedRpmWeeklyViewer(userRole) ? leadTeamEntriesForUser(userRole) : null;

  const targetsByKey = new Map();
  for (const t of targets || []) {
    const k = targetLookupKey(t.company || company, t.unit, t.team, t.weekStart);
    targetsByKey.set(k, t);
    // also without normalize variants
    const k2 = `${t.company || company}|${String(t.unit || "").trim()}|${t.team}|${t.weekStart}`.toLowerCase();
    targetsByKey.set(k2, t);
  }

  const roster = collectTeamRoster({
    teamsMeta,
    sales,
    targets,
    company,
    opUnits,
    leadTeams,
    teamFilter,
  });

  const weeks = weeksMeta.map((week) => {
    const block = buildWeekBlock({
      week,
      sales,
      mode,
      empMap,
      teamsMeta,
      targetsByKey,
      teamFilter,
    });

    const teams = roster.map((r) => {
      let count = 0;
      for (const [name, c] of block.teamCounts.entries()) {
        if (teamsMatch(name, r.team)) count += c;
      }
      const tgt =
        targetsByKey.get(targetLookupKey(company, r.unit, r.team, week.monday)) ||
        targetsByKey.get(`${company}|${r.unit}|${r.team}|${week.monday}`.toLowerCase());
      const targetCount = tgt?.targetCount ?? null;
      const pct = targetPct(count, targetCount);
      return {
        team: r.team,
        unit: r.unit,
        count,
        targetCount,
        pct,
        colorBand: targetColorBand(pct),
      };
    });

    return {
      weekIndex: block.weekIndex,
      monday: block.monday,
      friday: block.friday,
      daysInMonth: block.daysInMonth,
      total: block.total,
      closers: block.closers,
      agents: block.agents,
      clients: block.clients,
      teams,
      unassignedCloserCount: block.unassignedCloserCount,
      unassignedAgentCount: block.unassignedAgentCount,
    };
  });

  let scope = "scoped";
  if (teamFilter) scope = "team";
  else if (userRole?.role === "op") scope = "unit";
  else if (leadTeams?.length) scope = "team";
  else if (isCompanyRpmWeeklyViewer(userRole)) scope = "company";

  return {
    month,
    mode,
    company,
    scope,
    targetsAvailable,
    truncated: Boolean(truncated),
    weeks,
  };
}

module.exports = {
  listWeeksForMonth,
  buildRpmWeeklyDashboard,
  saleWorkingDay,
  mondayOf,
  fridayOfMonday,
  targetPct,
  targetColorBand,
  resolvePersonName,
  empByIdMap,
  leadTeamEntriesForUser,
  saleMatchesLeadTeams,
  isTlScopedRpmWeeklyViewer,
  isCompanyRpmWeeklyViewer,
};

/**
 * Q Feedback Analysis — closer Q→sale funnel + team TL targets (active agents that day).
 */
const { isQFeedbackSheetImport } = require("./rpm-checks-repo");
const { teamsMatch } = require("./team-names");
const teamDashboardRoster = require("./team-dashboard-roster");
const { isAgentDayOff } = require("./team-dashboard");

const DEFAULT_CLOSER_TARGET = 2;

function ratio(num, den) {
  const n = Number(num) || 0;
  const d = Number(den) || 0;
  if (!d) return null;
  return n / d;
}

function formatPct(ratioValue) {
  if (ratioValue == null || !Number.isFinite(ratioValue)) return "—";
  return `${(ratioValue * 100).toFixed(2)}%`;
}

function normalizeNameKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function canonicalTeamName(raw, dialingTeams) {
  const name = String(raw || "").trim();
  if (!name) return "";
  for (const t of dialingTeams || []) {
    const tn = String(t.name || t.team || "").trim();
    if (tn && teamsMatch(tn, name)) return tn;
  }
  return name;
}

function datesInRange(from, to) {
  const out = [];
  if (!from) return out;
  const end = to || from;
  let cur = from;
  while (cur <= end) {
    out.push(cur);
    const dt = new Date(`${cur}T12:00:00`);
    dt.setDate(dt.getDate() + 1);
    cur = dt.toISOString().slice(0, 10);
  }
  return out;
}

function activeAgentsForTeamOnDay({
  team,
  day,
  rosterAgents,
  attendanceRecords,
  dialingTeams,
}) {
  const onTeam = (rosterAgents || []).filter((e) =>
    teamsMatch(canonicalTeamName(e.team, dialingTeams), team)
  );
  return onTeam.filter((e) => !isAgentDayOff(attendanceRecords, e.id, day)).length;
}

function averageActiveAgentsForTeam({
  team,
  from,
  to,
  rosterAgents,
  attendanceRecords,
  dialingTeams,
}) {
  const days = datesInRange(from, to);
  if (!days.length) return 0;
  let sum = 0;
  for (const day of days) {
    sum += activeAgentsForTeamOnDay({
      team,
      day,
      rosterAgents,
      attendanceRecords,
      dialingTeams,
    });
  }
  return Math.round(sum / days.length);
}

/**
 * Build live Q Feedback analysis.
 * - Closer: Qs they received / sales from those Qs (sale feedback or linked sale)
 * - Team TL target: active dialing members that day (avg across period)
 * - Closer target: manual defaultCloserTarget (default 2)
 */
function buildLiveQFeedbackAnalysis({
  checks = [],
  employees = [],
  orgTeams = [],
  appUsers = [],
  attendanceRecords = [],
  from,
  to,
  closerTarget = DEFAULT_CLOSER_TARGET,
} = {}) {
  const byId = new Map((employees || []).map((e) => [e.id, e]));
  const dialingTeams = (orgTeams || []).filter((t) => t.dialsSales !== false);
  const rosterAgents = teamDashboardRoster.filterTeamDashboardAgents(employees, {
    teamsMeta: dialingTeams,
    appUsers,
  });

  const scopedChecks = (checks || []).filter((c) => !isQFeedbackSheetImport(c));
  const qChecks = scopedChecks.filter((c) => c.checkStatus === "q");

  const target = Math.max(0, Number(closerTarget) || DEFAULT_CLOSER_TARGET);

  // --- Closers keyed by employee id (no duplicate names) ---
  const closerMap = new Map(); // id -> { id, name }

  function ensureCloser(id, fallbackName) {
    const cid = String(id || "").trim();
    if (!cid) return null;
    if (closerMap.has(cid)) return closerMap.get(cid);
    const emp = byId.get(cid);
    const name = String(emp?.american_name || fallbackName || cid).trim() || cid;
    const row = { id: cid, name };
    closerMap.set(cid, row);
    return row;
  }

  for (const t of dialingTeams) {
    for (const id of t.closerEmployeeIds || []) ensureCloser(id);
    const tl = String(t.tlEmployeeId || t.tl_employee_id || "").trim();
    // TLs are not closers unless also assigned as closer
  }
  for (const c of qChecks) {
    if (c.closerId) ensureCloser(c.closerId, c.closerName);
  }

  // Deduplicate display names that map to the same person via name-only collisions:
  // keep one row per id; if two ids share the same display name, suffix the id.
  const nameCounts = new Map();
  for (const row of closerMap.values()) {
    const key = normalizeNameKey(row.name);
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  }
  for (const row of closerMap.values()) {
    const key = normalizeNameKey(row.name);
    if ((nameCounts.get(key) || 0) > 1) {
      row.displayName = `${row.name} (${row.id})`;
    } else {
      row.displayName = row.name;
    }
  }

  const closerRows = [];
  for (const closer of [...closerMap.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" })
  )) {
    const qs = qChecks.filter((c) => String(c.closerId || "") === closer.id);
    const salesFromQs = qs.filter(
      (c) => c.feedbackStatus === "sale" || Boolean(c.linkedRpmSaleId)
    ).length;
    const qCount = qs.length;
    const conversion = ratio(salesFromQs, qCount);
    const salesTarget = ratio(salesFromQs, target);
    closerRows.push({
      closerId: closer.id,
      closer: closer.displayName,
      qs: qCount,
      sales: salesFromQs,
      open: qs.filter((c) => !c.feedbackStatus && !c.linkedRpmSaleId).length,
      target,
      salesTarget,
      salesTargetLabel: formatPct(salesTarget),
      conversion,
      conversionLabel: formatPct(conversion),
    });
  }

  // --- Teams keyed by canonical dialing team name ---
  const teamKeys = [];
  const seenTeam = new Set();
  for (const t of dialingTeams) {
    const name = String(t.name || t.team || "").trim();
    if (!name) continue;
    const key = normalizeNameKey(name);
    if (seenTeam.has(key)) continue;
    seenTeam.add(key);
    teamKeys.push(name);
  }

  const teamRows = [];
  for (const team of teamKeys.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))) {
    const teamQs = qChecks.filter(
      (c) =>
        canonicalTeamName(c.team || byId.get(c.agentId)?.team || "", dialingTeams) === team
    );
    const salesFromQs = teamQs.filter(
      (c) => c.feedbackStatus === "sale" || Boolean(c.linkedRpmSaleId)
    ).length;
    const activeTarget = averageActiveAgentsForTeam({
      team,
      from,
      to,
      rosterAgents,
      attendanceRecords,
      dialingTeams,
    });
    const qCount = teamQs.length;
    const conversion = ratio(salesFromQs, qCount);
    const salesTarget = ratio(salesFromQs, activeTarget);
    teamRows.push({
      team,
      target: activeTarget,
      qs: qCount,
      sales: salesFromQs,
      open: teamQs.filter((c) => !c.feedbackStatus && !c.linkedRpmSaleId).length,
      salesTarget,
      salesTargetLabel: formatPct(salesTarget),
      conversion,
      conversionLabel: formatPct(conversion),
    });
  }

  const totalQs = closerRows.reduce((s, r) => s + r.qs, 0);
  const totalSales = closerRows.reduce((s, r) => s + r.sales, 0);
  const totalOpen = closerRows.reduce((s, r) => s + r.open, 0);

  return {
    source: "live",
    from,
    to,
    workingDay: from === to ? from : null,
    closerTarget: target,
    closerRows,
    teamRows,
    totals: {
      qs: totalQs,
      sales: totalSales,
      open: totalOpen,
      conversion: ratio(totalSales, totalQs),
      conversionLabel: formatPct(ratio(totalSales, totalQs)),
    },
  };
}

module.exports = {
  DEFAULT_CLOSER_TARGET,
  buildLiveQFeedbackAnalysis,
  formatPct,
  averageActiveAgentsForTeam,
  canonicalTeamName,
};

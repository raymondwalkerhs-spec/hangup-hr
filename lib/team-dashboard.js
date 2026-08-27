/**
 * Daily / weekly team sales dashboards (agent roster + team summary).
 * RPM layout: Passed, Pending, Dropped, Retransfer, Total.
 */
const { datesInRange } = require("./leave-attendance");
const { employeeDisplayName } = require("./attendance");
const { employeeTeamKey, teamsMatch } = require("./team-names");
const teamDashboardRoster = require("./team-dashboard-roster");
const { rpmClientBucket } = require("./rpm-sale-bucket");

function saleWorkingDay(sale) {
  return (
    sale.workingDay ||
    String(sale.submissionDate || "").slice(0, 10) ||
    ""
  );
}

/** Dashboard counting uses workingDay only (no OR with effective/submission). */
function saleTouchesDate(sale, date) {
  return saleWorkingDay(sale) === date;
}

function emptyAgentCounts() {
  return { approved: 0, pending: 0, dropped: 0, retransfer: 0, postdated: 0, totalSent: 0 };
}

function emptyCheckCounts() {
  return { q: 0, nq: 0, age_limit: 0, under_age: 0, duplicate: 0 };
}

function attachCheckCounts(row, checks = emptyCheckCounts()) {
  const q = Number(checks.q) || 0;
  const nq = Number(checks.nq) || 0;
  const age = Number(checks.age_limit) || 0;
  const under = Number(checks.under_age) || 0;
  const dup = Number(checks.duplicate) || 0;
  return {
    ...row,
    checksQ: q,
    checksNq: nq,
    checksAgeLimit: age,
    checksUnderAge: under,
    checksDuplicate: dup,
    // Match HS3 Daily status columns sum (Q+NQ+Age+Under+Dup)
    checksTotal: q + nq + age + under + dup,
  };
}

/** Conversion = Sent Sales ÷ Q checks (Excel Transfers). */
function formatConversion(sentSales, qChecks) {
  const sent = Number(sentSales) || 0;
  const q = Number(qChecks) || 0;
  if (q > 0) return `${((sent / q) * 100).toFixed(2)}%`;
  if (sent > 0) return "—";
  return "no sales yet";
}

function agentCountsForDay(sales, agentId, date) {
  const rows = sales.filter((s) => s.agentId === agentId && saleTouchesDate(s, date));
  const counts = emptyAgentCounts();
  for (const s of rows) {
    const bucket = rpmClientBucket(s);
    counts[bucket] += 1;
  }
  counts.totalSent = counts.approved + counts.pending + counts.dropped + counts.retransfer;
  return counts;
}

function isAgentDayOff(attendanceRecords, employeeId, date) {
  return (attendanceRecords || []).some(
    (r) => r.employeeId === employeeId && r.date === date && r.status === "Day-OFF"
  );
}

function teamDayOffCount(attendanceRecords, teamAgentIds, date) {
  const ids = new Set(teamAgentIds);
  return (attendanceRecords || []).filter(
    (r) => r.date === date && r.status === "Day-OFF" && ids.has(r.employeeId)
  ).length;
}

function buildDayDashboard({
  date,
  sales,
  employees,
  attendanceRecords,
  teamsMeta = [],
  appUsers = [],
  checksByAgent = {},
  targetDivisor = 1,
}) {
  const divisor = Math.max(1, Number(targetDivisor) || 1);
  const unassignedSales = sales.filter((s) => !s.agentId && saleTouchesDate(s, date)).length;
  const excludedIds = teamDashboardRoster.collectExcludedEmployeeIds(teamsMeta, appUsers);
  const dialing = teamDashboardRoster.filterTeamDashboardAgents(employees, { teamsMeta, appUsers });
  const empById = new Map(employees.map((e) => [e.id, e]));
  const teamOrder = new Map();
  const dialTeams = new Set();
  const canonicalMeta = new Map();
  for (const t of teamsMeta) {
    teamOrder.set(t.name, t);
    canonicalMeta.set(employeeTeamKey({ team: t.name }, teamsMeta), t.name);
    if (t.dialsSales !== false) dialTeams.add(t.name);
  }

  const teamNames = new Set();
  for (const e of dialing) {
    const key = employeeTeamKey(e, teamsMeta);
    if (!key) continue;
    const canonical = canonicalMeta.get(key) || key;
    if (!dialTeams.size || [...dialTeams].some((dt) => teamsMatch(dt, canonical))) {
      teamNames.add(canonical);
    }
  }

  for (const s of sales) {
    if (!saleTouchesDate(s, date) || !s.agentId) continue;
    const emp = empById.get(s.agentId);
    if (!emp) continue;
    const key = employeeTeamKey(emp, teamsMeta);
    if (key) teamNames.add(canonicalMeta.get(key) || key);
  }

  const sortedTeams = [...teamNames]
    .filter((team) => teamIsEligible(team, dialing, teamsMeta))
    .sort((a, b) => {
    const oa = teamOrder.get(a)?.displayOrder ?? 999;
    const ob = teamOrder.get(b)?.displayOrder ?? 999;
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b);
  });

  const weekend = isWeekendDate(date);

  const agentRows = [];
  const teamSummaries = [];
  let grandApproved = 0;
  let grandPending = 0;
  let grandDropped = 0;
  let grandRetransfer = 0;
  let grandTotal = 0;

  for (const team of sortedTeams) {
    const allTeamAgents = dialing.filter((e) => teamsMatch(employeeTeamKey(e, teamsMeta), team));
    const teamAgentIds = allTeamAgents.map((e) => e.id);

    if (weekend && !teamHasWeekendWork(attendanceRecords, date, teamAgentIds)) {
      agentRows.push({
        team,
        teamKey: team,
        agentId: "",
        agentName: "DAY-OFF",
        dayOff: true,
        ...emptyAgentCounts(),
      });
      const activeAgentsCount = 0;
      teamSummaries.push({
        team,
        agentsCount: allTeamAgents.length,
        activeAgentsCount,
        approved: 0,
        pending: 0,
        passedPending: 0,
        total: 0,
        checksQ: 0,
        conversion: formatConversion(0, 0),
        targetPercentage: teamDashboardRoster.teamTargetPercentage(0, activeAgentsCount, divisor),
        dayOffs: allTeamAgents.length,
      });
      continue;
    }

    let activeAgents = allTeamAgents.filter((e) => !isAgentDayOff(attendanceRecords, e.id, date));
    if (weekend) {
      activeAgents = allTeamAgents.filter((e) => agentWorkedWeekend(attendanceRecords, e.id, date));
    }
    const dayOffAgents = weekend
      ? []
      : allTeamAgents.filter((e) => isAgentDayOff(attendanceRecords, e.id, date));

    const agents = [...activeAgents];
    if (!agents.length) {
      const saleAgentIds = new Set(
        sales.filter((s) => saleTouchesDate(s, date) && s.agentId).map((s) => s.agentId)
      );
      for (const agentId of saleAgentIds) {
        const emp = empById.get(agentId);
        if (!emp || !teamsMatch(employeeTeamKey(emp, teamsMeta), team)) continue;
        if (teamDashboardRoster.isExcludedFromTeamDashboardRoster(emp, excludedIds)) continue;
        if (!teamDashboardRoster.isActiveDashboardAgent(emp)) continue;
        if (isAgentDayOff(attendanceRecords, emp.id, date)) continue;
        if (agents.some((a) => a.id === emp.id)) continue;
        const counts = agentCountsForDay(sales, emp.id, date);
        if (!counts.totalSent && !counts.approved) continue;
        agents.push(emp);
      }
      agents.sort((a, b) => employeeDisplayName(a).localeCompare(employeeDisplayName(b)));
    }

    if (!agents.length && !dayOffAgents.length) continue;

    let teamApproved = 0;
    let teamPending = 0;
    let teamTotal = 0;
    let teamQ = 0;
    const teamAgentRows = [];

    for (const emp of agents) {
      const counts = agentCountsForDay(sales, emp.id, date);
      const withChecks = attachCheckCounts(counts, checksByAgent[emp.id]);
      teamApproved += counts.approved;
      teamPending += counts.pending;
      teamTotal += counts.totalSent;
      teamQ += withChecks.checksQ;
      grandApproved += counts.approved;
      grandPending += counts.pending;
      grandDropped += counts.dropped;
      grandRetransfer += counts.retransfer;
      grandTotal += counts.totalSent;
      teamAgentRows.push({
        agentId: emp.id,
        agentName: employeeDisplayName(emp),
        dayOff: false,
        ...withChecks,
      });
    }

    for (const emp of dayOffAgents) {
      teamAgentRows.push({
        agentId: emp.id,
        agentName: `${employeeDisplayName(emp)} (DAY-OFF)`,
        dayOff: true,
        ...attachCheckCounts(emptyAgentCounts(), emptyCheckCounts()),
      });
    }

    teamAgentRows.sort((a, b) => String(a.agentName).localeCompare(String(b.agentName)));

    let firstInTeam = true;
    for (const row of teamAgentRows) {
      agentRows.push({
        team: firstInTeam ? team : "",
        teamKey: team,
        ...row,
      });
      firstInTeam = false;
    }

    const dayOffs = dayOffAgents.length;
    // Target N = agents who are NOT Day-OFF (weekend: agents who worked)
    const activeAgentsCount = weekend
      ? activeAgents.length
      : allTeamAgents.filter((e) => !isAgentDayOff(attendanceRecords, e.id, date)).length;
    const passedPending = teamApproved + teamPending;
    // Conversion = Sent Sales ÷ Q checks; Achieved / target % uses Sent Sales.
    const conversion = formatConversion(teamTotal, teamQ);
    const targetPercentage = teamDashboardRoster.teamTargetPercentage(
      teamTotal,
      activeAgentsCount,
      divisor
    );

    teamSummaries.push({
      team,
      agentsCount: activeAgentsCount,
      activeAgentsCount,
      approved: teamApproved,
      pending: teamPending,
      passedPending,
      total: teamTotal,
      checksQ: teamQ,
      conversion,
      targetPercentage,
      dayOffs,
    });
  }

  return {
    date,
    agentRows,
    teamSummaries,
    targetDivisor: divisor,
    totals: {
      approved: grandApproved,
      pending: grandPending,
      dropped: grandDropped,
      retransfer: grandRetransfer,
      totalSent: grandTotal,
      unassignedSales,
    },
  };
}

const WEEKEND_WORK_STATUSES = new Set(["Attended", "WFH", "Half Day"]);

function isWeekendDate(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  const day = d.getDay();
  return day === 0 || day === 6;
}

function teamHasWeekendWork(attendanceRecords, date, teamAgentIds) {
  const ids = new Set(teamAgentIds);
  return (attendanceRecords || []).some(
    (r) =>
      r.date === date &&
      ids.has(r.employeeId) &&
      WEEKEND_WORK_STATUSES.has(String(r.status || "").trim())
  );
}

function agentWorkedWeekend(attendanceRecords, employeeId, date) {
  return (attendanceRecords || []).some(
    (r) =>
      r.employeeId === employeeId &&
      r.date === date &&
      WEEKEND_WORK_STATUSES.has(String(r.status || "").trim())
  );
}

function teamIsEligible(teamName, dialing, teamsMeta) {
  const meta = (teamsMeta || []).find((t) => teamsMatch(t.name, teamName));
  const hasTl = Boolean(meta?.tlEmployeeId);
  const hasAgents = dialing.some((e) => teamsMatch(employeeTeamKey(e, teamsMeta), teamName));
  return hasTl || hasAgents;
}

function buildWeekDashboard({
  from,
  to,
  sales,
  employees,
  attendanceRecords,
  teamsMeta = [],
  appUsers = [],
  checksByAgentByDay = {},
}) {
  const dates = datesInRange(from, to);
  const days = dates.map((date) =>
    buildDayDashboard({
      date,
      sales,
      employees,
      attendanceRecords,
      teamsMeta,
      appUsers,
      checksByAgent: checksByAgentByDay[date] || {},
    })
  );
  return { from, to, dates, days };
}

/**
 * Period totals (weekly / monthly) — one aggregated table like HS3 Stats / Monthly Stats.
 */
function buildPeriodTotalsDashboard({
  from,
  to,
  sales,
  employees,
  attendanceRecords,
  teamsMeta = [],
  appUsers = [],
  checksByAgent = {},
  targetDivisor = 1,
}) {
  const divisor = Math.max(1, Number(targetDivisor) || 1);
  const dates = datesInRange(from, to);
  const excludedIds = teamDashboardRoster.collectExcludedEmployeeIds(teamsMeta, appUsers);
  const dialing = teamDashboardRoster.filterTeamDashboardAgents(employees, { teamsMeta, appUsers });
  const empById = new Map(employees.map((e) => [e.id, e]));
  const teamOrder = new Map();
  const dialTeams = new Set();
  const canonicalMeta = new Map();
  for (const t of teamsMeta) {
    teamOrder.set(t.name, t);
    canonicalMeta.set(employeeTeamKey({ team: t.name }, teamsMeta), t.name);
    if (t.dialsSales !== false) dialTeams.add(t.name);
  }

  const teamNames = new Set();
  for (const e of dialing) {
    const key = employeeTeamKey(e, teamsMeta);
    if (!key) continue;
    const canonical = canonicalMeta.get(key) || key;
    if (!dialTeams.size || [...dialTeams].some((dt) => teamsMatch(dt, canonical))) {
      teamNames.add(canonical);
    }
  }
  for (const s of sales) {
    const day = saleWorkingDay(s);
    if (!day || day < from || day > to || !s.agentId) continue;
    const emp = empById.get(s.agentId);
    if (!emp) continue;
    const key = employeeTeamKey(emp, teamsMeta);
    if (key) teamNames.add(canonicalMeta.get(key) || key);
  }
  for (const agentId of Object.keys(checksByAgent || {})) {
    const emp = empById.get(agentId);
    if (!emp) continue;
    const key = employeeTeamKey(emp, teamsMeta);
    if (key) teamNames.add(canonicalMeta.get(key) || key);
  }

  const sortedTeams = [...teamNames]
    .filter((team) => teamIsEligible(team, dialing, teamsMeta))
    .sort((a, b) => {
      const oa = teamOrder.get(a)?.displayOrder ?? 999;
      const ob = teamOrder.get(b)?.displayOrder ?? 999;
      if (oa !== ob) return oa - ob;
      return a.localeCompare(b);
    });

  function agentPeriodCounts(agentId) {
    const counts = emptyAgentCounts();
    for (const date of dates) {
      const dayCounts = agentCountsForDay(sales, agentId, date);
      counts.approved += dayCounts.approved;
      counts.pending += dayCounts.pending;
      counts.dropped += dayCounts.dropped;
      counts.retransfer += dayCounts.retransfer;
      counts.totalSent += dayCounts.totalSent;
    }
    return attachCheckCounts(counts, checksByAgent[agentId]);
  }

  const agentRows = [];
  const teamSummaries = [];
  let grandApproved = 0;
  let grandPending = 0;
  let grandDropped = 0;
  let grandRetransfer = 0;
  let grandTotal = 0;
  let grandQ = 0;

  for (const team of sortedTeams) {
    const allTeamAgents = dialing.filter((e) => teamsMatch(employeeTeamKey(e, teamsMeta), team));
    const agentIds = new Set(allTeamAgents.map((e) => e.id));
    for (const s of sales) {
      const day = saleWorkingDay(s);
      if (!day || day < from || day > to || !s.agentId) continue;
      const emp = empById.get(s.agentId);
      if (!emp || !teamsMatch(employeeTeamKey(emp, teamsMeta), team)) continue;
      if (teamDashboardRoster.isExcludedFromTeamDashboardRoster(emp, excludedIds)) continue;
      agentIds.add(emp.id);
    }
    for (const agentId of Object.keys(checksByAgent || {})) {
      const emp = empById.get(agentId);
      if (!emp || !teamsMatch(employeeTeamKey(emp, teamsMeta), team)) continue;
      if (teamDashboardRoster.isExcludedFromTeamDashboardRoster(emp, excludedIds)) continue;
      agentIds.add(agentId);
    }

    const agents = [...agentIds]
      .map((id) => empById.get(id))
      .filter(Boolean)
      .sort((a, b) => employeeDisplayName(a).localeCompare(employeeDisplayName(b)));

    if (!agents.length) continue;

    let teamApproved = 0;
    let teamPending = 0;
    let teamTotal = 0;
    let teamQ = 0;
    let firstInTeam = true;
    for (const emp of agents) {
      const row = agentPeriodCounts(emp.id);
      if (
        !row.totalSent &&
        !row.checksTotal &&
        !row.checksDuplicate &&
        !allTeamAgents.some((a) => a.id === emp.id)
      ) {
        continue;
      }
      teamApproved += row.approved;
      teamPending += row.pending;
      teamTotal += row.totalSent;
      teamQ += row.checksQ;
      grandApproved += row.approved;
      grandPending += row.pending;
      grandDropped += row.dropped;
      grandRetransfer += row.retransfer;
      grandTotal += row.totalSent;
      grandQ += row.checksQ;
      agentRows.push({
        team: firstInTeam ? team : "",
        teamKey: team,
        agentId: emp.id,
        agentName: employeeDisplayName(emp),
        dayOff: false,
        ...row,
      });
      firstInTeam = false;
    }

    const activeAgentsCount = allTeamAgents.length || agents.length;
    teamSummaries.push({
      team,
      agentsCount: activeAgentsCount,
      activeAgentsCount,
      approved: teamApproved,
      pending: teamPending,
      passedPending: teamApproved + teamPending,
      total: teamTotal,
      checksQ: teamQ,
      conversion: formatConversion(teamTotal, teamQ),
      targetPercentage: teamDashboardRoster.teamTargetPercentage(
        teamTotal,
        activeAgentsCount,
        divisor
      ),
      dayOffs: 0,
    });
  }

  return {
    from,
    to,
    dates,
    periodTotals: true,
    targetDivisor: divisor,
    agentRows,
    teamSummaries,
    totals: {
      approved: grandApproved,
      pending: grandPending,
      dropped: grandDropped,
      retransfer: grandRetransfer,
      totalSent: grandTotal,
      checksQ: grandQ,
      unassignedSales: 0,
    },
  };
}

module.exports = {
  buildDayDashboard,
  buildWeekDashboard,
  buildPeriodTotalsDashboard,
  agentCountsForDay,
  formatConversion,
  emptyCheckCounts,
  attachCheckCounts,
  rpmClientBucket,
  isAgentDayOff,
  isWeekendDate,
  teamHasWeekendWork,
  teamIsEligible,
  WEEKEND_WORK_STATUSES,
};


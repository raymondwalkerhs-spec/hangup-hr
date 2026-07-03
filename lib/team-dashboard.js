/**
 * Daily / weekly team sales dashboards (agent roster + team summary).
 * Matches spreadsheet layout: Approved, PostDated, Dropped, Total Sent.
 */
const { datesInRange } = require("./leave-attendance");
const { employeeDisplayName } = require("./attendance");
const { filterDialingAgents } = require("./dialing-agents");
const { employeeTeamKey, teamsMatch } = require("./team-names");
const salesScope = require("./sales-scope");

function saleTouchesDate(sale, date) {
  const eff = sale.effectiveDate || "";
  const sub = sale.submissionDate || "";
  return eff === date || sub === date;
}

function agentCountsForDay(sales, agentId, date) {
  const rows = sales.filter((s) => s.agentId === agentId && saleTouchesDate(s, date));
  let approved = 0;
  let postdated = 0;
  let dropped = 0;

  for (const s of rows) {
    if (s.status === "denied") {
      dropped += 1;
      continue;
    }
    if (s.status === "postdated") {
      if (s.effectiveDate === date || s.submissionDate === date) postdated += 1;
      continue;
    }
    if (s.status === "passed") {
      const { counted } = salesScope.countSaleForDashboard(s, date);
      if (counted) approved += 1;
      continue;
    }
  }

  const totalSent = approved + postdated + dropped;
  return { approved, postdated, dropped, totalSent };
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

function buildDayDashboard({ date, sales, employees, attendanceRecords, teamsMeta = [] }) {
  const unassignedSales = sales.filter((s) => !s.agentId && saleTouchesDate(s, date)).length;
  const dialing = filterDialingAgents(employees, { includeOut: false, activeOnly: true });
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

  const sortedTeams = [...teamNames].sort((a, b) => {
    const oa = teamOrder.get(a)?.displayOrder ?? 999;
    const ob = teamOrder.get(b)?.displayOrder ?? 999;
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b);
  });

  const agentRows = [];
  const teamSummaries = [];
  let grandApproved = 0;
  let grandPostdated = 0;
  let grandDropped = 0;
  let grandTotal = 0;

  for (const team of sortedTeams) {
    const agents = dialing
      .filter((e) => teamsMatch(employeeTeamKey(e, teamsMeta), team) && !isAgentDayOff(attendanceRecords, e.id, date))
      .sort((a, b) => employeeDisplayName(a).localeCompare(employeeDisplayName(b)));

    if (!agents.length) {
      const saleAgentIds = new Set(
        sales.filter((s) => saleTouchesDate(s, date) && s.agentId).map((s) => s.agentId)
      );
      for (const agentId of saleAgentIds) {
        const emp = empById.get(agentId);
        if (!emp || !teamsMatch(employeeTeamKey(emp, teamsMeta), team)) continue;
        if (isAgentDayOff(attendanceRecords, emp.id, date)) continue;
        const counts = agentCountsForDay(sales, emp.id, date);
        if (!counts.totalSent && !counts.approved) continue;
        agents.push(emp);
      }
      agents.sort((a, b) => employeeDisplayName(a).localeCompare(employeeDisplayName(b)));
    }

    if (!agents.length) continue;

    let teamApproved = 0;
    let teamTotal = 0;
    let firstInTeam = true;

    for (const emp of agents) {
      const counts = agentCountsForDay(sales, emp.id, date);
      teamApproved += counts.approved;
      teamTotal += counts.totalSent;
      grandApproved += counts.approved;
      grandPostdated += counts.postdated;
      grandDropped += counts.dropped;
      grandTotal += counts.totalSent;

      agentRows.push({
        team: firstInTeam ? team : "",
        teamKey: team,
        agentId: emp.id,
        agentName: employeeDisplayName(emp),
        ...counts,
      });
      firstInTeam = false;
    }

    const allTeamAgents = dialing.filter((e) => teamsMatch(employeeTeamKey(e, teamsMeta), team));
    const dayOffs = teamDayOffCount(
      attendanceRecords,
      allTeamAgents.map((a) => a.id),
      date
    );
    const conversion =
      teamTotal > 0 ? `${((teamApproved / teamTotal) * 100).toFixed(2)}%` : teamApproved > 0 ? "100.00%" : "no sales yet";

    teamSummaries.push({
      team,
      agentsCount: agents.length,
      approved: teamApproved,
      total: teamTotal,
      conversion,
      dayOffs,
    });
  }

  return {
    date,
    agentRows,
    teamSummaries,
    totals: {
      approved: grandApproved,
      postdated: grandPostdated,
      dropped: grandDropped,
      totalSent: grandTotal,
      unassignedSales,
    },
  };
}

function buildWeekDashboard({ from, to, sales, employees, attendanceRecords, teamsMeta = [] }) {
  const dates = datesInRange(from, to);
  const days = dates.map((date) =>
    buildDayDashboard({ date, sales, employees, attendanceRecords, teamsMeta })
  );
  return { from, to, dates, days };
}

module.exports = {
  buildDayDashboard,
  buildWeekDashboard,
  agentCountsForDay,
  isAgentDayOff,
};


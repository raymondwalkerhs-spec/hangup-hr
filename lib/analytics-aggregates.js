const companyContext = require("./company-context");

const EXCLUDED_POSITION_KEYWORDS = /^(TL|OP|HR|ADMIN|CEO|RTM|QUALITY)$/i;
const EXCLUDED_ATTENDANCE_STATUSES = new Set([
  "Day-OFF",
  "OUT",
  "Paused",
  "Paused still get paid",
  "OUT BUT STILL GET PAID",
]);
const PRESENT_STATUSES = ["Present", "WFH", "Present (Late)"];

function resolvePeriod(month) {
  const ym = month || new Date().toISOString().slice(0, 7);
  const year = Number(String(ym).slice(0, 4));
  const monthNum = Number(String(ym).slice(5, 7));
  const startDate = new Date(year, monthNum - 1, 1).toISOString().slice(0, 10);
  const endDate = new Date(year, monthNum, 0).toISOString().slice(0, 10);
  return { month: ym, year, monthNum, startDate, endDate };
}

function filterEmployeesByCompany(employees, company) {
  return companyContext.filterEmployeesByCompany(employees, company);
}

function aggregateLeave(leaveRequests) {
  const byStatus = {};
  for (const r of leaveRequests || []) {
    const s = String(r.status || "unknown").toLowerCase();
    byStatus[s] = (byStatus[s] || 0) + 1;
  }
  return { total: (leaveRequests || []).length, byStatus };
}

function aggregateCompanyCosts({ expenses = [], bills = [] } = {}) {
  const { resolveExpenseCategory } = require("./expense-category");
  const byCategory = {};
  const byPaidBy = { petty_cash: 0, main_fund: 0, other: 0 };
  let expenseTotal = 0;
  let pendingTotal = 0;
  let paidCount = 0;
  let pendingCount = 0;

  for (const e of expenses || []) {
    const status = String(e.status || "").toLowerCase();
    if (status === "archived" || status === "denied") continue;
    const amt = Number(e.amount) || 0;
    if (status !== "paid") {
      pendingTotal += amt;
      pendingCount += 1;
      continue;
    }
    paidCount += 1;
    expenseTotal += amt;
    const cat = resolveExpenseCategory({
      category: e.category,
      description: e.description,
      vendorName: e.vendorName,
    });
    byCategory[cat] = (byCategory[cat] || 0) + amt;
    const method = String(e.paymentMethod || "").toLowerCase();
    if (method === "petty_cash") byPaidBy.petty_cash += amt;
    else if (method === "main_fund") byPaidBy.main_fund += amt;
    else byPaidBy.other += amt;
  }

  const billsTotal = (bills || []).reduce((s, b) => s + (Number(b.amount) || 0), 0);
  return {
    companyCosts: expenseTotal + billsTotal,
    expenseTotal,
    billsTotal,
    pendingTotal,
    paidCount,
    pendingCount,
    byCategory,
    byPaidBy,
    byPaidByLabels: {
      "Petty cash": byPaidBy.petty_cash,
      "Main Fund": byPaidBy.main_fund,
      Other: byPaidBy.other,
    },
  };
}

function aggregateAttendance({
  employees = [],
  attendance = [],
  month,
  company,
}) {
  const { startDate, endDate } = resolvePeriod(month);
  const scopedEmployees = filterEmployeesByCompany(employees, company);
  const empMap = new Map(scopedEmployees.map((e) => [e.id, e]));
  const scopedIds = new Set(scopedEmployees.map((e) => e.id));
  const monthAttendance = (attendance || []).filter(
    (r) => scopedIds.has(r.employeeId) && r.date >= startDate && r.date <= endDate
  );

  const teamAttendance = {};
  for (const rec of monthAttendance) {
    const team = empMap.get(rec.employeeId)?.team || "Unknown";
    if (!teamAttendance[team]) teamAttendance[team] = { days: 0, present: 0 };
    teamAttendance[team].days += 1;
    if (PRESENT_STATUSES.includes(rec.status)) teamAttendance[team].present += 1;
  }
  const byTeam = Object.entries(teamAttendance)
    .map(([team, data]) => ({
      team,
      days: data.days,
      present: data.present,
      average: data.days > 0 ? Math.round((data.present / data.days) * 100) : 0,
    }))
    .sort((a, b) => b.average - a.average);

  const overall =
    monthAttendance.length > 0
      ? Math.round(
          (monthAttendance.filter((r) => PRESENT_STATUSES.includes(r.status)).length /
            monthAttendance.length) *
            100
        )
      : 0;

  const activeEmployees = scopedEmployees.filter(
    (e) => String(e.status || "").toLowerCase() === "active"
  );
  const currentMonthDepartures = scopedEmployees.filter((e) => {
    const dep = String(e.depart_date || e.status_date || "").slice(0, 7);
    return String(e.status || "").toLowerCase() === "out" && dep === month;
  });
  const turnoverCount = currentMonthDepartures.length;
  const activeAtMonthStart = scopedEmployees.filter((e) => {
    const dep = String(e.depart_date || e.status_date || "");
    return String(e.status || "").toLowerCase() === "active" && (!dep || dep >= startDate);
  }).length;
  const turnoverRatio =
    activeAtMonthStart > 0 ? Math.round((turnoverCount / activeAtMonthStart) * 100) : 0;

  const newEmployeesThisMonth = scopedEmployees.filter((e) => {
    const created = e.created_at || e.employment_date || "";
    return String(created).slice(0, 7) === month;
  }).length;
  const newEmployeeRatio =
    activeEmployees.length > 0
      ? Math.round((newEmployeesThisMonth / activeEmployees.length) * 100)
      : 0;

  return {
    overall,
    byTeam,
    turnover: { count: turnoverCount, ratio: turnoverRatio },
    newEmployees: { count: newEmployeesThisMonth, ratio: newEmployeeRatio },
    workingDaysRecords: monthAttendance,
    empMap,
    scopedIds,
  };
}

function aggregateSales({
  sales = [],
  attendance = [],
  employees = [],
  salesMonth,
  agentsMonth,
  company,
}) {
  const salesPeriod = resolvePeriod(salesMonth);
  const agentsPeriod = resolvePeriod(agentsMonth);
  const scopedEmployees = filterEmployeesByCompany(employees, company);
  const empMap = new Map(scopedEmployees.map((e) => [e.id, e]));
  const scopedIds = new Set(scopedEmployees.map((e) => e.id));

  const attendanceExclusionMap = new Map();
  for (const rec of attendance || []) {
    if (!scopedIds.has(rec.employeeId)) continue;
    if (EXCLUDED_ATTENDANCE_STATUSES.has(rec.status)) {
      const key = `${rec.employeeId}|${rec.date}`;
      if (!attendanceExclusionMap.has(key)) attendanceExclusionMap.set(key, true);
    }
  }

  const workingDaysByAgent = {};
  for (const rec of attendance || []) {
    if (!scopedIds.has(rec.employeeId)) continue;
    if (rec.date < agentsPeriod.startDate || rec.date > agentsPeriod.endDate) continue;
    if (!EXCLUDED_ATTENDANCE_STATUSES.has(rec.status)) {
      workingDaysByAgent[rec.employeeId] = (workingDaysByAgent[rec.employeeId] || 0) + 1;
    }
  }

  function saleWorkingDate(s) {
    return String(s.workingDay || s.submissionDate || s.effectiveDate || s.date || "").slice(0, 10);
  }

  // Team headcount for avg/agent: agents on the team during the sales month (not only sellers)
  const teamHeadcount = {};
  const teamAgentIds = {};
  for (const emp of scopedEmployees) {
    const position = String(emp.position || emp.role || "").trim();
    if (EXCLUDED_POSITION_KEYWORDS.test(position)) continue;
    const team = String(emp.team || "").trim();
    if (!team) continue;
    const hire = String(emp.employment_date || "").slice(0, 10);
    const depart = String(emp.depart_date || "").slice(0, 10);
    if (hire && hire > salesPeriod.endDate) continue;
    if (depart && depart < salesPeriod.startDate) continue;
    if (!teamHeadcount[team]) teamHeadcount[team] = 0;
    if (!teamAgentIds[team]) teamAgentIds[team] = new Set();
    teamHeadcount[team] += 1;
    teamAgentIds[team].add(emp.id);
  }

  const teamSales = {};
  const closerSales = {};
  const salesStatusByTeam = {};
  for (const s of sales) {
    const saleDate = saleWorkingDate(s);
    if (!saleDate || saleDate < salesPeriod.startDate || saleDate > salesPeriod.endDate) continue;
    const agentId = s.agentId || "";
    const closerId = s.closerId || "";
    const agentEmp = agentId ? empMap.get(agentId) : null;
    const closerEmp = closerId ? empMap.get(closerId) : null;
    if (agentEmp) {
      const position = String(agentEmp.position || agentEmp.role || "").trim();
      if (EXCLUDED_POSITION_KEYWORDS.test(position)) continue;
      const exclusionKey = `${agentId}|${saleDate}`;
      if (attendanceExclusionMap.has(exclusionKey)) continue;
      const team = String(agentEmp.team || "Unknown").trim() || "Unknown";
      if (!teamSales[team]) teamSales[team] = { count: 0, total: 0, agents: new Set() };
      teamSales[team].count += 1;
      teamSales[team].total += Number(s.price || 0);
      teamSales[team].agents.add(agentId);
      const saleStatus = String(s.status || "pending").toLowerCase();
      if (!salesStatusByTeam[team]) {
        salesStatusByTeam[team] = { passed: 0, pending: 0, postdated: 0, denied: 0, callback: 0 };
      }
      if (saleStatus === "passed") salesStatusByTeam[team].passed += 1;
      else if (saleStatus === "pending") salesStatusByTeam[team].pending += 1;
      else if (saleStatus === "postdated") salesStatusByTeam[team].postdated += 1;
      else if (saleStatus === "denied") salesStatusByTeam[team].denied += 1;
      else if (saleStatus === "callback") salesStatusByTeam[team].callback += 1;
    }
    if (closerEmp) {
      const position = String(closerEmp.position || closerEmp.role || "").trim();
      if (EXCLUDED_POSITION_KEYWORDS.test(position)) continue;
      const unit = String(closerEmp.unit || "Unknown").trim() || "Unknown";
      if (!closerSales[unit]) closerSales[unit] = { count: 0, total: 0 };
      closerSales[unit].count += 1;
      closerSales[unit].total += Number(s.price || 0);
    }
  }

  const allTeams = new Set([
    ...Object.keys(teamSales),
    ...Object.keys(teamHeadcount),
    ...Object.keys(salesStatusByTeam),
  ]);
  const salesPerTeam = [...allTeams]
    .map((team) => {
      const data = teamSales[team] || { count: 0, total: 0, agents: new Set() };
      const agentCount = teamHeadcount[team] || data.agents.size || 0;
      const avgPerAgent =
        agentCount > 0 ? Math.round((data.count / agentCount) * 100) / 100 : 0;
      const agentsForDays = teamAgentIds[team] || data.agents;
      const totalWorkingDays = [...agentsForDays].reduce(
        (sum, id) => sum + (workingDaysByAgent[id] || 0),
        0
      );
      const avgPerAgentPerDay =
        totalWorkingDays > 0 ? Math.round((data.count / totalWorkingDays) * 100) / 100 : 0;
      return {
        team,
        count: data.count,
        total: data.total,
        agentCount,
        sellersCount: data.agents.size,
        avgPerAgent,
        avgPerAgentPerDay,
        average: data.count > 0 ? Math.round(data.total / data.count) : 0,
      };
    })
    .filter((t) => t.count > 0 || t.agentCount > 0)
    .sort((a, b) => b.avgPerAgent - a.avgPerAgent);

  const closersByUnit = Object.entries(closerSales)
    .map(([unit, data]) => ({
      unit,
      count: data.count,
      average: data.count > 0 ? Math.round(data.total / data.count) : 0,
    }))
    .sort((a, b) => b.average - a.average);
  const topCloser = closersByUnit[0] || null;
  const agentsByTeam = salesPerTeam.map((t) => ({
    team: t.team,
    count: t.count,
    average: t.avgPerAgent,
  }));
  const topAgent = [...agentsByTeam].sort((a, b) => b.average - a.average)[0] || null;
  const averagesByTeam = salesPerTeam
    .map(({ team, avgPerAgent, agentCount }) => ({ team, avgPerAgent, agentCount }))
    .sort((a, b) => b.avgPerAgent - a.avgPerAgent);
  const averagesByTeamPerDay = salesPerTeam
    .map(({ team, avgPerAgentPerDay, agentCount }) => ({ team, avgPerAgentPerDay, agentCount }))
    .sort((a, b) => b.avgPerAgentPerDay - a.avgPerAgentPerDay);
  const statusByTeam = Object.entries(salesStatusByTeam)
    .map(([team, data]) => ({
      team,
      ...data,
      total: data.passed + data.pending + data.postdated + data.denied + data.callback,
    }))
    .sort((a, b) => (b.total || 0) - (a.total || 0));

  return {
    byTeam: salesPerTeam,
    closersByUnit,
    topCloser,
    agentsByTeam,
    topAgent,
    averagesByTeam,
    averagesByTeamPerDay,
    statusByTeam,
    salesMonth: salesPeriod.month,
    agentsMonth: agentsPeriod.month,
  };
}

function aggregateTrainingPipeline(trainingPrograms) {
  let inTraining = 0;
  let finished = 0;
  const phases = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const [, prog] of trainingPrograms || []) {
    if (!prog.active) {
      finished++;
      continue;
    }
    const phase4 = (prog.allPhases || []).find((p) => p.phaseNumber === 4);
    if (phase4 && ["passed", "passed_exception"].includes(phase4.status)) {
      finished++;
      continue;
    }
    inTraining++;
    const activePhase = (prog.allPhases || []).find(
      (p) => p.status && !["passed", "passed_exception", "failed"].includes(p.status)
    );
    const phaseNum = activePhase?.phaseNumber || prog.currentPhase || 1;
    if (phases[phaseNum] != null) phases[phaseNum] += 1;
  }
  return { inTraining, finished, phases };
}

function aggregatePayrollFinancials({ bonuses = [], deductions = [], employees = [], company }) {
  const scopedEmployees = filterEmployeesByCompany(employees, company);
  const empMap = new Map(scopedEmployees.map((e) => [e.id, e]));
  const bonusByTeam = {};
  for (const b of bonuses) {
    const emp = empMap.get(b.employeeId);
    if (!emp) continue;
    const team = String(emp.team || "Unknown").trim() || "Unknown";
    if (!bonusByTeam[team]) bonusByTeam[team] = { count: 0, total: 0 };
    bonusByTeam[team].count += 1;
    bonusByTeam[team].total += Number(b.amount || 0);
  }
  const deductionByTeam = {};
  for (const d of deductions) {
    const emp = empMap.get(d.employeeId);
    if (!emp) continue;
    const team = String(emp.team || "Unknown").trim() || "Unknown";
    if (!deductionByTeam[team]) deductionByTeam[team] = { count: 0, total: 0 };
    deductionByTeam[team].count += 1;
    deductionByTeam[team].total += Number(d.amount || 0);
  }
  const scopedBonuses = bonuses.filter((b) => empMap.has(b.employeeId));
  const scopedDeductions = deductions.filter((d) => empMap.has(d.employeeId));
  return {
    bonuses: Object.entries(bonusByTeam)
      .map(([team, data]) => ({ team, ...data }))
      .sort((a, b) => b.total - a.total),
    deductions: Object.entries(deductionByTeam)
      .map(([team, data]) => ({ team, ...data }))
      .sort((a, b) => b.total - a.total),
    totalBonuses: scopedBonuses.reduce((s, b) => s + (Number(b.amount) || 0), 0),
    totalDeductions: scopedDeductions.reduce((s, d) => s + (Number(d.amount) || 0), 0),
  };
}

module.exports = {
  resolvePeriod,
  aggregateLeave,
  aggregateCompanyCosts,
  aggregateSales,
  aggregateAttendance,
  aggregateTrainingPipeline,
  aggregatePayrollFinancials,
};

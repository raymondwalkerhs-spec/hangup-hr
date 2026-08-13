const { summarizeEmployeeMonth } = require("./attendance");
const { buildPayrollViews } = require("./training-payroll");
const { sumPayrollRowMetrics } = require("./payroll-row-metrics");

function shiftMonth(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function buildTurnoverReport(employees, companyCtx, company) {
  let list = employees;
  if (companyCtx && company) {
    list = companyCtx.filterEmployeesByCompany(list, company);
  }
  const byUnit = {};
  const byStatus = {};
  let active = 0;
  let out = 0;
  const idGen = require("./id-generator");
  for (const e of list) {
    const unit = e.unit || "Unknown";
    byUnit[unit] = (byUnit[unit] || 0) + 1;
    const st = e.status || "Unknown";
    byStatus[st] = (byStatus[st] || 0) + 1;
    if (idGen.isOutEmployee(e)) out += 1;
    else if (st === "Active") active += 1;
  }
  return {
    generatedAt: new Date().toISOString(),
    headcount: { total: list.length, active, out, byUnit, byStatus },
    note: "Rolling 12-month trends use depart_date when employment_periods history is synced.",
  };
}

async function buildAttendanceRankings(month, store, companyCtx, company) {
  let employees = store.getEmployeesForMonth(month, { hideOut: false });
  if (companyCtx && company) {
    employees = companyCtx.filterEmployeesByCompany(employees, company);
  }
  const config = store.getConfig();
  const rows = [];
  for (const emp of employees) {
    const records = store.getAttendanceEvents(month).filter((r) => r.employeeId === emp.id);
    const s = summarizeEmployeeMonth(emp, records, config);
    rows.push({
      employeeId: emp.id,
      name: s.name,
      unit: emp.unit,
      nsnc: s.nsnc,
      lateness: s.lateness,
      halfDays: s.halfDays,
    });
  }
  rows.sort((a, b) => b.nsnc - a.nsnc || b.lateness - a.lateness);
  return { month, rankings: rows };
}

function agentTotalsFromBundle(bundle, company) {
  const companyCtx = require("./company-context");
  let rows = buildPayrollViews(bundle.payroll).agent.rows;
  if (company) {
    const empIds = new Set(companyCtx.filterEmployeesByCompany(bundle.employees, company).map((e) => e.id));
    rows = rows.filter((r) => empIds.has(r.employeeId));
  }
  const totals = sumPayrollRowMetrics(rows);
  return {
    month: undefined,
    totalNet: totals.totalNet,
    totalBasic: totals.totalBasic,
    employees: totals.employees,
    byUnit: rows.reduce((acc, p) => {
      const u = p.unit || "Unknown";
      const { payrollRowDisplayNet } = require("./payroll-display-net");
      acc[u] = (acc[u] || 0) + payrollRowDisplayNet(p);
      return acc;
    }, {}),
  };
}

async function buildPayrollCompare(month, store, company, fetchAgentMonth) {
  const prev = shiftMonth(month, -1);

  const build = async (ym) => {
    if (fetchAgentMonth) {
      const bundle = await fetchAgentMonth(ym);
      const result = agentTotalsFromBundle(bundle, company);
      return { ...result, month: ym };
    }

    const config = company ? store.getConfigForCompany(company) : store.getConfig();
    const rates = store.getPositionRates();
    const { buildPayroll } = require("./payroll");
    let employees = store.getEmployeesForMonth(ym, { hideOut: false });
    if (company) {
      const companyCtx = require("./company-context");
      employees = companyCtx.filterEmployeesByCompany(employees, company);
    }
    const summaries = employees.map((emp) => {
      const recs = store.getAttendanceEvents(ym).filter((r) => r.employeeId === emp.id);
      return summarizeEmployeeMonth(emp, recs, config);
    });
    const payroll = buildPayroll(
      employees,
      summaries,
      ym,
      config,
      rates,
      store.getBonusEvents(ym),
      store.getDeductionEvents(ym),
      store.getPayrollAdjustments(ym),
      new Map(),
      store.getCommissionTiers(ym, company || "hangup"),
      store.getEmployeeLoans(),
      store.getLoanPayments()
    );
    return {
      month: ym,
      totalNet: payroll.reduce((s, p) => s + (p.netSalary || 0), 0),
      totalBasic: payroll.reduce((s, p) => s + (p.basicSalary || 0), 0),
      employees: payroll.length,
      byUnit: payroll.reduce((acc, p) => {
        const u = p.unit || "Unknown";
        acc[u] = (acc[u] || 0) + (p.netSalary || 0);
        return acc;
      }, {}),
    };
  };

  const current = await build(month);
  const previous = await build(prev);
  const deltaNet = Math.round((current.totalNet - previous.totalNet) * 100) / 100;
  const anomalies = [];
  if (Math.abs(deltaNet) > 50000) {
    anomalies.push(`Large net pay swing vs prior month: ${deltaNet} EGP`);
  }
  return { current, previous, deltaNet, anomalies };
}

module.exports = {
  buildTurnoverReport,
  buildAttendanceRankings,
  buildPayrollCompare,
  agentTotalsFromBundle,
};

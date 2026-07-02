const { summarizeEmployeeMonth } = require("./attendance");
const { buildPayroll } = require("./payroll");
const idGen = require("./id-generator");

function shiftMonth(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function buildTurnoverReport(employees) {
  const byUnit = {};
  const byStatus = {};
  let active = 0;
  let out = 0;
  for (const e of employees) {
    const unit = e.unit || "Unknown";
    byUnit[unit] = (byUnit[unit] || 0) + 1;
    const st = e.status || "Unknown";
    byStatus[st] = (byStatus[st] || 0) + 1;
    if (idGen.isOutEmployee(e)) out += 1;
    else if (st === "Active") active += 1;
  }
  return {
    generatedAt: new Date().toISOString(),
    headcount: { total: employees.length, active, out, byUnit, byStatus },
    note: "Rolling 12-month trends use depart_date when employment_periods history is synced.",
  };
}

async function buildAttendanceRankings(month, store) {
  const employees = store.getEmployeesForMonth(month, { hideOut: false });
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

async function buildPayrollCompare(month, store) {
  const prev = shiftMonth(month, -1);
  const config = store.getConfig();
  const rates = store.getPositionRates();
  const build = (ym) => {
    const employees = store.getEmployeesForMonth(ym, { hideOut: false });
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
      store.getCommissionTiers(ym),
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
  const current = build(month);
  const previous = build(prev);
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
};

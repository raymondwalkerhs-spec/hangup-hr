const { isPayrollEligible, employeeDisplayName } = require("./attendance");
const idGen = require("./id-generator");

function buildMonthlyReport({ employees, payroll, summaries, month, adjustments = [] }) {
  const adjMap = new Map(adjustments.map((a) => [a.employeeId, a]));
  const byUnit = {};
  const byStatus = {};
  let totalNsnc = 0;
  let totalNsncHalf = 0;
  let totalLateness = 0;

  for (const emp of employees) {
    const unit = emp.unit || "Unknown";
    const status = emp.status || "Unknown";
    byUnit[unit] = byUnit[unit] || { count: 0, payrollEligible: 0, netPay: 0 };
    byStatus[status] = (byStatus[status] || 0) + 1;
    byUnit[unit].count += 1;
    if (isPayrollEligible(emp)) byUnit[unit].payrollEligible += 1;
  }

  for (const s of summaries) {
    totalNsnc += s.nsnc || 0;
    totalNsncHalf += s.nsncHalf || 0;
    totalLateness += s.lateness || 0;
  }

  for (const p of payroll) {
    const unit = p.unit || "Unknown";
    if (!byUnit[unit]) byUnit[unit] = { count: 0, payrollEligible: 0, netPay: 0 };
    byUnit[unit].netPay += p.netSalary || 0;
  }

  const active = employees.filter((e) => e.status === "Active").length;
  const out = employees.filter((e) => idGen.isOutEmployee(e)).length;
  const onHold = adjustments.filter((a) => a.twoWeekHold).length;

  return {
    month,
    generatedAt: new Date().toISOString(),
    headcount: {
      total: employees.length,
      active,
      out,
      byStatus,
      byUnit: Object.fromEntries(
        Object.entries(byUnit).map(([u, v]) => [u, { employees: v.count, payrollEligible: v.payrollEligible }])
      ),
    },
    attendance: {
      totalNsnc,
      totalNsncHalf,
      totalLatenessEvents: totalLateness,
    },
    payroll: {
      employees: payroll.length,
      totalBasic: roundSum(payroll, "basicSalary"),
      totalBonuses: roundSum(payroll, "totalBonuses"),
      totalDeductions: roundSum(payroll, "totalDeductions"),
      totalNet: roundSum(payroll, "netSalary"),
      twoWeekHolds: onHold,
      byUnit: Object.fromEntries(
        Object.entries(byUnit).map(([u, v]) => [u, Math.round(v.netPay * 100) / 100])
      ),
    },
  };
}

function roundSum(rows, key) {
  return Math.round(rows.reduce((s, r) => s + (r[key] || 0), 0) * 100) / 100;
}

function reportToMarkdown(report) {
  const lines = [
    `# HR Report — ${report.month}`,
    "",
    `Generated: ${new Date(report.generatedAt).toLocaleString()}`,
    "",
    "## Headcount",
    `- Total employees: **${report.headcount.total}**`,
    `- Active: **${report.headcount.active}**`,
    `- Out / inactive: **${report.headcount.out}**`,
    "",
    "### By unit",
  ];
  for (const [unit, data] of Object.entries(report.headcount.byUnit)) {
    lines.push(`- ${unit}: ${data.employees} (${data.payrollEligible} payroll-eligible)`);
  }
  lines.push(
    "",
    "## Attendance",
    `- NSNC (full): **${report.attendance.totalNsnc}**`,
    `- NSNC Half Day: **${report.attendance.totalNsncHalf}**`,
    `- Lateness events: **${report.attendance.totalLatenessEvents}**`,
    "",
    "## Payroll",
    `- Employees on payroll: **${report.payroll.employees}**`,
    `- Total basic: **${report.payroll.totalBasic} EGP**`,
    `- Total bonuses: **${report.payroll.totalBonuses} EGP**`,
    `- Total deductions: **${report.payroll.totalDeductions} EGP**`,
    `- Net payroll: **${report.payroll.totalNet} EGP**`,
    `- 2-week holds: **${report.payroll.twoWeekHolds}**`,
    "",
    "### Net pay by unit"
  );
  for (const [unit, net] of Object.entries(report.payroll.byUnit)) {
    lines.push(`- ${unit}: **${net} EGP**`);
  }
  return lines.join("\n");
}

module.exports = {
  buildMonthlyReport,
  reportToMarkdown,
  employeeDisplayName,
};

/**
 * Auto-compute payroll sales_count from imported sales rows.
 */
function saleCountsForAgentMonth(sale, employeeId, yearMonth) {
  if (!sale || sale.agentId !== employeeId) return false;
  if (!["passed", "postdated"].includes(sale.status)) return false;
  const prefix = String(yearMonth || "").slice(0, 7);
  const eff = String(sale.effectiveDate || "").slice(0, 7);
  const sub = String(sale.submissionDate || "").slice(0, 7);
  return eff === prefix || sub === prefix;
}

function countSalesForAgentMonth(sales, employeeId, yearMonth) {
  return (sales || []).filter((s) => saleCountsForAgentMonth(s, employeeId, yearMonth)).length;
}

module.exports = {
  saleCountsForAgentMonth,
  countSalesForAgentMonth,
};

/**
 * Auto-compute payroll sales counts from MLA + RPM sales rows.
 */
function saleCountsForAgentMonth(sale, employeeId, yearMonth) {
  if (!sale || sale.agentId !== employeeId) return false;
  if (!["passed", "postdated"].includes(sale.status)) return false;
  const prefix = String(yearMonth || "").slice(0, 7);
  const wd = String(sale.workingDay || sale.effectiveDate || sale.submissionDate || "").slice(0, 7);
  const eff = String(sale.effectiveDate || "").slice(0, 7);
  const sub = String(sale.submissionDate || "").slice(0, 7);
  return wd === prefix || eff === prefix || sub === prefix;
}

function countSalesForAgentMonth(sales, employeeId, yearMonth) {
  return (sales || []).filter((s) => saleCountsForAgentMonth(s, employeeId, yearMonth)).length;
}

function countMlaSalesForAgentMonth(sales, employeeId, yearMonth) {
  return (sales || []).filter((s) => !s.program || s.program === "mla").filter((s) => saleCountsForAgentMonth(s, employeeId, yearMonth)).length;
}

function countRpmSalesForAgentMonth(sales, employeeId, yearMonth) {
  return (sales || []).filter((s) => s.program === "rpm").filter((s) => saleCountsForAgentMonth(s, employeeId, yearMonth)).length;
}

function countCombinedSalesForAgentMonth(mlaSales, rpmSales, employeeId, yearMonth) {
  return (
    countMlaSalesForAgentMonth(mlaSales, employeeId, yearMonth) +
    countRpmSalesForAgentMonth(rpmSales, employeeId, yearMonth)
  );
}

module.exports = {
  saleCountsForAgentMonth,
  countSalesForAgentMonth,
  countMlaSalesForAgentMonth,
  countRpmSalesForAgentMonth,
  countCombinedSalesForAgentMonth,
};

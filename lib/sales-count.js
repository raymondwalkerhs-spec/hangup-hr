/**
 * Auto-compute payroll sales counts from MLA + RPM sales rows.
 * Theme unlocks use RPM sent/closed helpers separately (not passed/postdated).
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

function saleInWorkingMonth(sale, yearMonth) {
  const prefix = String(yearMonth || "").slice(0, 7);
  const wd = String(sale.workingDay || sale.effectiveDate || sale.submissionDate || "").slice(0, 7);
  const eff = String(sale.effectiveDate || "").slice(0, 7);
  const sub = String(sale.submissionDate || "").slice(0, 7);
  return wd === prefix || eff === prefix || sub === prefix;
}

function isRpmSale(sale) {
  return Boolean(sale && sale.program === "rpm");
}

/**
 * RPM "sent" sale for theme unlock: any RPM row for the agent this month
 * (submitted RPM sales — same idea as team-dash totalSent, not MLA passed/postdated).
 */
function saleCountsAsRpmSentForAgent(sale, employeeId, yearMonth) {
  if (!sale || String(sale.agentId || "") !== String(employeeId || "")) return false;
  if (sale.program && sale.program !== "rpm") return false;
  return saleInWorkingMonth(sale, yearMonth);
}

/**
 * RPM "closed" sale: any RPM row where the employee is closer this month.
 */
function saleCountsAsRpmClosedForCloser(sale, employeeId, yearMonth) {
  if (!sale || String(sale.closerId || "") !== String(employeeId || "")) return false;
  if (sale.program && sale.program !== "rpm") return false;
  return saleInWorkingMonth(sale, yearMonth);
}

function countSalesForAgentMonth(sales, employeeId, yearMonth) {
  return (sales || []).filter((s) => saleCountsForAgentMonth(s, employeeId, yearMonth)).length;
}

function countRpmSentSalesForAgentMonth(sales, employeeId, yearMonth) {
  return (sales || []).filter((s) => saleCountsAsRpmSentForAgent(s, employeeId, yearMonth)).length;
}

function countRpmClosedSalesForCloserMonth(sales, employeeId, yearMonth) {
  return (sales || []).filter((s) => saleCountsAsRpmClosedForCloser(s, employeeId, yearMonth)).length;
}

function countMlaSalesForAgentMonth(sales, employeeId, yearMonth) {
  return (sales || [])
    .filter((s) => !s.program || s.program === "mla")
    .filter((s) => saleCountsForAgentMonth(s, employeeId, yearMonth)).length;
}

function countRpmSalesForAgentMonth(sales, employeeId, yearMonth) {
  return (sales || [])
    .filter((s) => s.program === "rpm")
    .filter((s) => saleCountsForAgentMonth(s, employeeId, yearMonth)).length;
}

function countCombinedSalesForAgentMonth(mlaSales, rpmSales, employeeId, yearMonth) {
  return (
    countMlaSalesForAgentMonth(mlaSales, employeeId, yearMonth) +
    countRpmSalesForAgentMonth(rpmSales, employeeId, yearMonth)
  );
}

module.exports = {
  saleCountsForAgentMonth,
  saleInWorkingMonth,
  isRpmSale,
  saleCountsAsRpmSentForAgent,
  saleCountsAsRpmClosedForCloser,
  countSalesForAgentMonth,
  countRpmSentSalesForAgentMonth,
  countRpmClosedSalesForCloserMonth,
  countMlaSalesForAgentMonth,
  countRpmSalesForAgentMonth,
  countCombinedSalesForAgentMonth,
};

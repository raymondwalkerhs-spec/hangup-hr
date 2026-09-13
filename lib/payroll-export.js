/**
 * Shared payroll export rows (PDF + XLS) using display-net / paid-net metrics.
 */
const XLSX = require("xlsx");
const { payrollRowMetrics, sumPayrollRowMetrics } = require("./payroll-row-metrics");
const { isPayrollSettled, isTrainingDeferredRow } = require("./payroll-settled");

const EXPORT_COLUMNS = [
  { key: "employee", label: "Employee" },
  { key: "americanName", label: "American name" },
  { key: "employeeId", label: "ID" },
  { key: "paymentMethod", label: "Payment method" },
  { key: "workingDays", label: "Working days" },
  { key: "salesCount", label: "Sales" },
  { key: "commission", label: "Commission" },
  { key: "basicSalary", label: "Basic" },
  { key: "loan", label: "Loans" },
  { key: "transport", label: "Transport" },
  { key: "otherBonuses", label: "Bonus" },
  { key: "deductions", label: "Deductions" },
  { key: "netRemaining", label: "Net remaining" },
  { key: "paidNet", label: "Paid" },
  { key: "statusFlags", label: "Status flags" },
];

function fmtMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function employeeLabel(row) {
  const arabic = String(row?.arabicName || "").trim();
  const american = String(row?.name || row?.employeeName || "").trim();
  if (arabic && american && arabic !== american) return `${arabic}\n${american}`;
  return arabic || american || "—";
}

function paymentMethodLabel(row) {
  return String(row?.paymentMethod || row?.payment_method || "").trim() || "—";
}

function statusFlags(row) {
  const flags = [];
  const kind = row?.payrollKind;
  if (kind && kind !== "agent") flags.push(String(kind));
  if (row?.trainingPayrollPaid) flags.push("training paid");
  if (isPayrollSettled(row)) flags.push("paid");
  if (isTrainingDeferredRow(row)) flags.push("deferred");
  if (row?.noPayroll) flags.push("no payroll");
  if (row?.monthlySalaryOverrideActive) flags.push("sal override");
  if (row?.netSalaryOverrideActive) flags.push("net override");
  return flags.join(" · ");
}

function buildPayrollExportRows(payrollRows) {
  return (payrollRows || []).map((row) => {
    const m = payrollRowMetrics(row);
    const americanName = String(row?.name || row?.employeeName || "").trim();
    return {
      employee: employeeLabel(row),
      arabicName: row?.arabicName || "",
      americanName: americanName || "—",
      name: americanName,
      employeeId: row?.employeeId || "",
      paymentMethod: paymentMethodLabel(row),
      workingDays: m.workingDays,
      salesCount: m.salesCount,
      commission: fmtMoney(m.commission),
      basicSalary: fmtMoney(m.basicSalary),
      loan: fmtMoney(m.loan),
      transport: fmtMoney(m.transport),
      otherBonuses: fmtMoney(m.otherBonuses),
      deductions: fmtMoney(m.deductions),
      netRemaining: fmtMoney(m.netSalary),
      paidNet: fmtMoney(m.paidNet),
      statusFlags: statusFlags(row),
    };
  });
}

function buildPayrollExportTotals(payrollRows) {
  const totals = sumPayrollRowMetrics(payrollRows || []);
  return {
    totalNet: totals.totalNet,
    totalPaidNet: totals.totalPaidNet,
    totalAllNet: totals.totalAllNet,
    totalBasic: totals.totalBasic,
    totalTransport: totals.totalTransport,
    totalCommission: totals.totalCommission,
    totalLoan: totals.totalLoan,
    employees: totals.employees,
  };
}

function filterPayrollRowsByEmployeeIds(payrollRows, employeeIds) {
  if (!employeeIds || !employeeIds.length) return payrollRows || [];
  const set = new Set(employeeIds.map(String));
  return (payrollRows || []).filter((r) => set.has(String(r.employeeId)));
}

function parseEmployeeIdsQuery(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.flatMap((v) => String(v).split(",")).map((s) => s.trim()).filter(Boolean);
  }
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function toPayrollXlsxBuffer(payrollRows, month, totals) {
  const rows = buildPayrollExportRows(payrollRows);
  const cols = EXPORT_COLUMNS;
  const sheetRows = rows.map((row) => {
    const out = {};
    for (const col of cols) out[col.label] = row[col.key];
    return out;
  });
  const t = totals || buildPayrollExportTotals(payrollRows);
  sheetRows.push({});
  sheetRows.push({
    Employee: "TOTALS",
    "American name": "",
    ID: `${t.employees} employees`,
    "Payment method": "",
    "Working days": "",
    Sales: "",
    Commission: t.totalCommission,
    Basic: t.totalBasic,
    Loans: t.totalLoan,
    Transport: t.totalTransport,
    Bonus: "",
    Deductions: "",
    "Net remaining": t.totalNet,
    Paid: t.totalPaidNet,
    "Status flags": `Total net: ${t.totalAllNet}`,
  });
  const ws = XLSX.utils.json_to_sheet(sheetRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Payroll ${month || ""}`.slice(0, 31));
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

module.exports = {
  EXPORT_COLUMNS,
  buildPayrollExportRows,
  buildPayrollExportTotals,
  filterPayrollRowsByEmployeeIds,
  parseEmployeeIdsQuery,
  toPayrollXlsxBuffer,
};

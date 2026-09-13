const archiver = require("archiver");
const store = require("../lib/data-store");
const changelog = require("../lib/changelog");
const documents = require("../lib/documents");
const { buildPayroll } = require("../lib/payroll");
const { summarizeEmployeeMonth, isPayrollEligible } = require("../lib/attendance");
const { buildPayslipPdf } = require("../lib/payslip-pdf");
const roles = require("../lib/roles");

function payrollToCsv(month, payroll) {
  const header = "employeeId,name,unit,basic,bonuses,deductions,net,payrollStatus";
  const lines = payroll.map((p) =>
    [p.employeeId, p.name, p.unit, p.basicSalary, p.totalBonuses, p.totalDeductions, p.netSalary, p.payrollStatus || ""]
      .map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`)
      .join(",")
  );
  return [header, ...lines].join("\n");
}

function changelogToCsv(entries) {
  const lines = ["timestamp,username,entity,entity_id,action,summary"];
  for (const e of entries) {
    lines.push(
      [e.timestamp, e.username, e.entity, e.entityId, e.action, JSON.stringify(e.summary || "")]
        .map((c) => `"${String(c || "").replace(/"/g, '""')}"`)
        .join(",")
    );
  }
  return lines.join("\n");
}

async function buildFinanceHandoffZip(month, userRole, company = "hangup") {
  const companyCtx = require("./company-context");
  const co = String(company || "hangup").toLowerCase();
  const config = store.getConfigForCompany(co);
  let rates = store.getPositionRates(month);
  rates = rates.filter((r) => (co === "hs2" ? r.company === "hs2" : !r.company || r.company === "hangup"));
  let employees = store.getEmployeesForMonth(month, { hideOut: false });
  employees = companyCtx.filterEmployeesByCompany(employees, co);
  employees = roles.filterEmployeesForUser(employees, userRole);
  const records = store.getAttendanceEvents(month);
  const adjustments = store.getPayrollAdjustments(month);
  const attendanceMap = store.buildAttendanceMap(month);
  const {
    commissionTiers,
    loans,
    loanPayments,
    loanMonthOverrides = [],
    loanScheduleLines = [],
  } = store.getPayrollExtras(month, co);
  const allPayrollSplits = store.getAllPayrollSplits();
  const summaries = employees.map((emp) =>
    summarizeEmployeeMonth(emp, records.filter((r) => r.employeeId === emp.id), config)
  );
  const payroll = buildPayroll(
    employees.filter(isPayrollEligible),
    summaries,
    month,
    config,
    rates,
    store.getBonusEvents(month),
    store.getDeductionEvents(month),
    adjustments,
    attendanceMap,
    commissionTiers,
    loans,
    loanPayments,
    allPayrollSplits,
    [],
    new Map(),
    [],
    loanMonthOverrides,
    loanScheduleLines
  );

  const archive = archiver("zip", { zlib: { level: 6 } });
  const chunks = [];
  archive.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
  });

  archive.append(payrollToCsv(month, payroll), { name: `payroll-${month}.csv` });
  const scopedIds = new Set(employees.map((e) => e.id));
  const logEntries = await changelog.readChangeLog({ limit: 2000, employeeIds: scopedIds, company: co });
  archive.append(changelogToCsv(logEntries), { name: `change-log.csv` });

  const { buildPayslipPdf: buildPdf } = require("../lib/payslip-pdf");
  for (const row of payroll) {
    const emp = store.getEmployeeById(row.employeeId);
    if (!emp) continue;
    const bonusEvents = store.getBonusEvents(month, emp.id);
    const deductionEvents = store.getDeductionEvents(month, emp.id);
    const att = records.filter((r) => r.employeeId === emp.id);
    const pdf = await buildPdf(row, month, {
      bonusEvents,
      deductionEvents,
      attendanceRecords: att,
      config,
      employees: store.getEmployees(),
    });
    const safe = (row.name || emp.id).replace(/[^\w\s-]+/g, "").trim().replace(/\s+/g, "-");
    archive.append(pdf, { name: `payslips/payslip-${emp.id}-${safe}-${month}.pdf` });
  }

  archive.finalize();
  return done;
}

async function buildDocumentsZip({ employeeId, unit, company = "hangup" }) {
  const companyCtx = require("./company-context");
  const co = String(company || "hangup").toLowerCase();
  let docs = store.getEmployeeDocuments(employeeId || undefined);
  if (unit) {
    let emps = store.getEmployees().filter((e) => e.unit === unit);
    emps = companyCtx.filterEmployeesByCompany(emps, co);
    const ids = new Set(emps.map((e) => e.id));
    docs = store.getEmployeeDocuments().filter((d) => ids.has(d.employeeId));
  } else if (employeeId) {
    const emp = store.getEmployeeById(employeeId);
    if (!emp || !companyCtx.employeeInCompanyContext(emp, co)) {
      throw new Error("Employee not found");
    }
  }
  if (!docs.length) throw new Error("No documents found for export");

  const archive = archiver("zip", { zlib: { level: 6 } });
  const chunks = [];
  archive.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
  });

  for (const doc of docs) {
    const fileId = doc.driveFileId || doc.storagePath;
    if (!fileId) continue;
    try {
      const { stream } = await documents.getDriveFileStream(fileId);
      const name = `${doc.employeeId}/${doc.docType}-${doc.fileName || "file"}`.replace(/[/\\?%*:|"<>]/g, "-");
      archive.append(stream, { name });
    } catch {
      archive.append(`Could not download: ${doc.fileName}\n`, { name: `${doc.employeeId}/MISSING-${doc.fileName}.txt` });
    }
  }

  archive.finalize();
  return done;
}

module.exports = {
  buildFinanceHandoffZip,
  buildDocumentsZip,
  payrollToCsv,
  changelogToCsv,
};

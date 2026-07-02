const { summarizeEmployeeMonth, employeeDisplayName } = require("./attendance");
const employeeIds = require("./employee-ids");

function listRecentMonths(count = 36) {
  const now = new Date();
  const months = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

function monthHasEmployeeActivity(store, identityIds, month) {
  const ids = new Set(identityIds);
  if (store.getAttendanceEvents(month).some((r) => ids.has(r.employeeId))) return true;
  if (store.getBonusEvents(month).some((r) => ids.has(r.employeeId))) return true;
  if (store.getDeductionEvents(month).some((r) => ids.has(r.employeeId))) return true;
  if (store.getPayrollAdjustments(month).some((r) => ids.has(r.employeeId))) return true;
  return false;
}

function listEmployeePayrollMonths(store, emp, count = 36) {
  const all = store.getEmployees();
  const identityIds = employeeIds.collectIdentityIds(emp, all);
  const months = [];
  for (const month of listRecentMonths(count)) {
    if (!monthHasEmployeeActivity(store, identityIds, month)) continue;
    const payrollId = employeeIds.resolveEmployeeIdForMonth(emp, month, all);
    months.push({ month, employeeId: payrollId });
  }
  return months.sort((a, b) => a.month.localeCompare(b.month));
}

function buildEmployeeAttendanceSummary(store, emp) {
  const all = store.getEmployees();
  const identityIds = employeeIds.collectIdentityIds(emp, all);
  const config = store.getConfig();
  const byMonth = new Map();

  for (const id of identityIds) {
    for (const record of store.getAttendanceForEmployee(id)) {
      const month = String(record.date).slice(0, 7);
      if (!byMonth.has(month)) byMonth.set(month, []);
      byMonth.get(month).push(record);
    }
  }

  const rows = [];
  for (const [month, records] of [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const summary = summarizeEmployeeMonth(emp, records, config);
    rows.push({
      month,
      employeeId: records[0]?.employeeId || emp.id,
      workingDays: summary.workingDays,
      daysOff: summary.daysOff,
      halfDays: summary.halfDays,
      quarterDays: summary.quarterOff,
      lateness: summary.lateness,
      latenessDeduction: summary.latenessDeductions,
      nsnc: summary.nsnc,
      nsncHalf: summary.nsncHalf,
      wfh: summary.wfh,
    });
  }
  return {
    employeeId: emp.id,
    name: employeeDisplayName(emp),
    identityIds,
    rows,
  };
}

function attendanceSummaryToCsv(report) {
  const header = [
    "Month",
    "Employee ID",
    "Working days",
    "Days off",
    "Half days",
    "Quarter days",
    "Lateness count",
    "Lateness deduction (EGP)",
    "NSNC",
    "NSNC half",
    "WFH",
  ].join(",");
  const lines = report.rows.map((r) =>
    [
      r.month,
      r.employeeId,
      r.workingDays,
      r.daysOff,
      r.halfDays,
      r.quarterDays,
      r.lateness,
      r.latenessDeduction,
      r.nsnc,
      r.nsncHalf,
      r.wfh,
    ].join(",")
  );
  return [header, ...lines].join("\n");
}

function buildAttendanceSummaryPdf(report) {
  const PDFDocument = require("pdfkit");
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text("Hangup HR — Attendance Summary", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor("#666").text(`${report.name} · ${report.employeeId}`, { align: "center" });
    if (report.identityIds.length > 1) {
      doc.text(`IDs: ${report.identityIds.join(", ")}`, { align: "center" });
    }
    doc.fillColor("#000").moveDown();

    doc.fontSize(9).font("Helvetica-Bold");
    const cols = [
      { label: "Month", w: 58 },
      { label: "ID", w: 52 },
      { label: "Worked", w: 42, align: "right" },
      { label: "Off", w: 32, align: "right" },
      { label: "Half", w: 32, align: "right" },
      { label: "1/4", w: 28, align: "right" },
      { label: "Late", w: 32, align: "right" },
      { label: "Late EGP", w: 52, align: "right" },
      { label: "NSNC", w: 36, align: "right" },
      { label: "WFH", w: 32, align: "right" },
    ];
    let x = 50;
    const hy = doc.y;
    cols.forEach((c, i) => {
      doc.text(c.label, x, hy, { width: cols[i].w, align: c.align || "left" });
      x += cols[i].w;
    });
    doc.font("Helvetica").moveDown(0.6);

    for (const r of report.rows) {
      if (doc.y > 720) {
        doc.addPage();
        doc.fontSize(9);
      }
      x = 50;
      const y = doc.y;
      const cells = [
        r.month,
        r.employeeId,
        String(r.workingDays),
        String(r.daysOff),
        String(r.halfDays),
        String(r.quarterDays),
        String(r.lateness),
        String(r.latenessDeduction),
        String(r.nsnc + r.nsncHalf),
        String(r.wfh),
      ];
      cols.forEach((c, i) => {
        doc.text(cells[i], x, y, { width: c.w, align: c.align || "left" });
        x += c.w;
      });
      doc.moveDown(0.35);
    }
    doc.end();
  });
}

module.exports = {
  listEmployeePayrollMonths,
  buildEmployeeAttendanceSummary,
  attendanceSummaryToCsv,
  buildAttendanceSummaryPdf,
};

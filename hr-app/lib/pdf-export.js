const PDFDocument = require("pdfkit");

function fmt(n) {
  return (Math.round((n || 0) * 100) / 100).toLocaleString("en-EG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function pdfBuffer(buildFn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    buildFn(doc);
    doc.end();
  });
}

function buildPayrollTablePdf(payroll, month, totals = {}) {
  return pdfBuffer((doc) => {
    doc.fontSize(18).text("Hangup HR — Payroll Summary", { align: "center" });
    doc.fontSize(10).fillColor("#666").text(month, { align: "center" });
    doc.fillColor("#000").moveDown();

    doc.fontSize(10);
    doc.text(`Employees: ${payroll.length}  ·  Net payroll: ${fmt(totals.totalNet)} EGP`);
    doc.moveDown(0.5);

    const cols = [
      { label: "Employee", w: 130 },
      { label: "Sales", w: 36, align: "center" },
      { label: "Basic", w: 58, align: "right" },
      { label: "Transport", w: 58, align: "right" },
      { label: "Commission", w: 58, align: "right" },
      { label: "Loan", w: 48, align: "right" },
      { label: "Net", w: 62, align: "right" },
    ];

    let x = 40;
    const headerY = doc.y;
    doc.font("Helvetica-Bold").fontSize(8);
    for (const col of cols) {
      doc.text(col.label, x, headerY, { width: col.w, align: col.align || "left" });
      x += col.w;
    }
    doc.font("Helvetica").moveDown(0.6);

    for (const row of payroll) {
      if (doc.y > 740) {
        doc.addPage();
        doc.fontSize(8);
      }
      const y = doc.y;
      x = 40;
      const cells = [
        `${row.name}\n${row.employeeId}`,
        String(row.salesCount || "—"),
        fmt(row.basicSalary),
        fmt(row.transportAllowance || 0),
        row.commissionAmount ? fmt(row.commissionAmount) : "—",
        row.loanDeductionTotal ? `-${fmt(row.loanDeductionTotal)}` : "—",
        fmt(row.netSalary),
      ];
      cols.forEach((col, i) => {
        doc.text(cells[i], x, y, { width: col.w, align: col.align || "left", lineGap: 1 });
        x += col.w;
      });
      doc.moveDown(0.35);
      doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor("#e2e8f0").stroke();
      doc.strokeColor("#000").moveDown(0.2);
    }

    doc.moveDown();
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text(`Total net: ${fmt(totals.totalNet)} EGP`, { align: "right" });
  });
}

function buildMonthlyReportPdf(report, month) {
  return pdfBuffer((doc) => {
    doc.fontSize(18).text("Hangup HR — Monthly Report", { align: "center" });
    doc.fontSize(10).fillColor("#666").text(month, { align: "center" });
    doc.fillColor("#000").moveDown();

    section(doc, "Headcount");
    row(doc, "Total employees", report.headcount.total);
    row(doc, "Active", report.headcount.active);
    for (const [unit, data] of Object.entries(report.headcount.byUnit || {})) {
      row(doc, unit, `${data.employees} (${data.payrollEligible} payroll)`);
    }

    section(doc, "Attendance");
    row(doc, "NSNC (full day)", report.attendance.totalNsnc);
    row(doc, "NSNC Half Day", report.attendance.totalNsncHalf);
    row(doc, "Total lateness deductions", `${fmt(report.attendance.totalLateness)} EGP`);

    section(doc, "Payroll");
    row(doc, "Employees on payroll", report.payroll.employees);
    row(doc, "Total basic", `${fmt(report.payroll.totalBasic)} EGP`);
    row(doc, "Total bonuses", `${fmt(report.payroll.totalBonuses)} EGP`);
    row(doc, "Total deductions", `${fmt(report.payroll.totalDeductions)} EGP`);
    row(doc, "2-week holds", report.payroll.twoWeekHolds);
    row(doc, "Net payroll", `${fmt(report.payroll.totalNet)} EGP`, true);

    section(doc, "Net pay by unit");
    for (const [unit, amount] of Object.entries(report.payroll.byUnit || {})) {
      row(doc, unit, `${fmt(amount)} EGP`);
    }
  });
}

function section(doc, title) {
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor("#333").text(title.toUpperCase());
  doc.fillColor("#000").moveDown(0.25);
}

function row(doc, label, value, bold = false) {
  const y = doc.y;
  doc.fontSize(10);
  if (bold) doc.font("Helvetica-Bold");
  doc.text(label, 40, y, { width: 300 });
  doc.text(String(value), 340, y, { width: 200, align: "right" });
  if (bold) doc.font("Helvetica");
  doc.moveDown(0.15);
}

module.exports = { buildPayrollTablePdf, buildMonthlyReportPdf };

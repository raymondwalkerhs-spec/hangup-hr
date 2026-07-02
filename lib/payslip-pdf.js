const PDFDocument = require("pdfkit");
const { buildPayslipPdfContext } = require("./payslip-detail");

function fmt(n) {
  return (Math.round((n || 0) * 100) / 100).toLocaleString("en-EG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function buildPayslipPdf(payslip, month, detailCtx = {}) {
  const ctx = buildPayslipPdfContext(payslip, detailCtx);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).text("Hangup HR — Payslip", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor("#666").text(month, { align: "center" });
    doc.fillColor("#000");
    doc.moveDown();

    doc.fontSize(14).text(payslip.name || "—", { continued: false });
    if (payslip.arabicName && payslip.arabicName !== payslip.name) {
      doc.fontSize(10).text(payslip.arabicName);
    }
    doc.fontSize(10).text(`${payslip.employeeId} · ${payslip.unit || "—"} · ${payslip.position || "—"}`);
    doc.moveDown();

    section(doc, "Salary basis");
    row(doc, "Monthly salary", `${fmt(payslip.monthlySalary)} EGP`);
    row(doc, "Working days in month", payslip.workingDaysInMonth);
    row(doc, "Days worked", payslip.totalWorkingDays);
    if (payslip.extraDays) row(doc, "Extra days", payslip.extraDays);
    if (payslip.nsnc) row(doc, "NSNC", payslip.nsnc);
    if (payslip.nsncHalf) row(doc, "NSNC Half Day", payslip.nsncHalf);
    row(doc, "Daily rate", `${fmt(payslip.dailyRate)} EGP`);
    row(doc, "Basic salary", `${fmt(payslip.basicSalary)} EGP`, true);
    if (payslip.transportAllowance > 0) {
      const dayLabel =
        payslip.transportDays % 1 === 0
          ? `${payslip.transportDays} days`
          : `${payslip.transportDays} day-units`;
      row(doc, "Transportation", `+${fmt(payslip.transportAllowance)} EGP (${dayLabel})`);
    }
    if (payslip.salesCount) row(doc, "Sales", payslip.salesCount);
    if (payslip.commissionAmount > 0) row(doc, "Commission total", `+${fmt(payslip.commissionAmount)} EGP`);

    if (ctx.attendanceLines.length) {
      section(doc, "Attendance notes");
      ctx.attendanceLines.forEach((l) => detailRow(doc, l.text));
    }

    section(doc, "Bonuses");
    if (!ctx.bonusLines.length) doc.fontSize(10).text("None");
    else ctx.bonusLines.forEach((l) => detailRow(doc, l.label, `+${fmt(l.amount)} EGP`));

    section(doc, "Deductions");
    if (!ctx.deductionLines.length) doc.fontSize(10).text("None");
    else ctx.deductionLines.forEach((l) => detailRow(doc, l.label, l.amount ? `-${fmt(l.amount)} EGP` : ""));

    row(doc, "Total deductions", `-${fmt(payslip.totalDeductions)} EGP`, true);

    if (payslip.deferredIn) row(doc, "Carried from prior month", `+${fmt(payslip.deferredIn)} EGP`);
    if (payslip.calculatedNet != null) row(doc, "Calculated net", `${fmt(payslip.calculatedNet)} EGP`);
    if (payslip.receivedTotal) row(doc, "Paid (splits)", `-${fmt(payslip.receivedTotal)} EGP`);
    if (payslip.deferredOut) row(doc, "Deferred to later month", `-${fmt(payslip.deferredOut)} EGP`);

    doc.moveDown();
    const balance = payslip.remainingBalance ?? payslip.netSalary;
    doc.fontSize(14).text(`Balance due: ${fmt(balance)} EGP`, { align: "right" });

    doc.end();
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
  else doc.font("Helvetica");
  doc.text(label, 50, y, { width: 280 });
  doc.text(String(value), 330, y, { width: 200, align: "right" });
  if (bold) doc.font("Helvetica");
  doc.moveDown(0.15);
}

function detailRow(doc, label, value = "") {
  const y = doc.y;
  doc.font("Helvetica").fontSize(9);
  doc.text(label, 55, y, { width: value ? 300 : 480, lineGap: 1 });
  if (value) doc.text(value, 360, y, { width: 170, align: "right" });
  doc.moveDown(0.12);
}

module.exports = { buildPayslipPdf };

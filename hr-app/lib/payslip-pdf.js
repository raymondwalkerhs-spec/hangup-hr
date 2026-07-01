const PDFDocument = require("pdfkit");

function fmt(n) {
  return (Math.round((n || 0) * 100) / 100).toLocaleString("en-EG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function buildPayslipPdf(payslip, month) {
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

    doc.fontSize(14).text(payslip.name, { continued: false });
    doc.fontSize(10).text(`${payslip.employeeId} · ${payslip.unit || "—"} · ${payslip.position || "—"}`);
    if (payslip.arabicName) doc.text(payslip.arabicName);
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
  if (payslip.commissionAmount > 0) row(doc, "Commission", `+${fmt(payslip.commissionAmount)} EGP`);

    section(doc, "Bonuses");
    const bonuses = Object.entries(payslip.bonuses || {}).filter(([, v]) => v > 0);
    if (!bonuses.length) doc.text("None");
    else bonuses.forEach(([k, v]) => row(doc, k, `+${fmt(v)} EGP`));

    section(doc, "Deductions");
    row(doc, "Lateness", `-${fmt(payslip.latenessDeduction)} EGP`);
    const deds = Object.entries(payslip.deductions || {}).filter(
      ([k, v]) => v > 0 && k !== "Lateness Deduction"
    );
    deds.forEach(([k, v]) => row(doc, k, `-${fmt(v)} EGP`));
    if (payslip.holdAmount > 0) row(doc, "2-week hold", `-${fmt(payslip.holdAmount)} EGP`);
    row(doc, "Total deductions", `-${fmt(payslip.totalDeductions)} EGP`, true);

    doc.moveDown();
    doc.fontSize(14).text(`Net salary: ${fmt(payslip.netSalary)} EGP`, { align: "right" });

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
  doc.text(label, 50, y, { width: 280 });
  doc.text(String(value), 330, y, { width: 200, align: "right" });
  if (bold) doc.font("Helvetica");
  doc.moveDown(0.15);
}

module.exports = { buildPayslipPdf };

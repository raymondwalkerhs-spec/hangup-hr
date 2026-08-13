const PDFDocument = require("pdfkit");
const { buildPayslipPdfContext } = require("./payslip-detail");

function fmt(n) {
  return (Math.round((n || 0) * 100) / 100).toLocaleString("en-EG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function isLikelyCorruptedName(value) {
  const s = String(value || "").trim();
  if (!s) return true;
  if (s.length < 2) return true;
  if (/\d/.test(s)) return true;
  if (/[^\p{L}\p{M}\s'\-\.]/u.test(s)) return true;
  return false;
}

function buildExtraPayrollPdf(entry, employee, month) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const name = employee?.american_name || employee?.id || "—";
      const legalName = !isLikelyCorruptedName(employee?.arabic_name) ? employee?.arabic_name : "";

      doc.fontSize(20).text("Hangup Portal — Extra Payroll", { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor("#666").text(month, { align: "center" });
      doc.fillColor("#000");
      doc.moveDown();

      doc.fontSize(14).text(name, { continued: false });
      doc.fontSize(10).fillColor("#666").text(`American Name: ${name}`);
      if (legalName && legalName !== name) {
        doc.text(`Legal Name: ${legalName}`);
      }
      doc.fillColor("#000");
      doc.fontSize(10).text(`${employee?.id || "—"} · ${employee?.unit || "—"} · ${employee?.position || "—"}`);
      doc.moveDown();

      section(doc, "Extra Payroll Details");
      row(doc, "Label", entry.label || "Extra");
      row(doc, "Working days", `${entry.workingDays || 0} days`);
      row(doc, "Daily rate", `${fmt(entry.dailyRate || 0)} EGP`);
      row(doc, "Net amount", `${fmt(entry.netAmount || 0)} EGP`, true);

      doc.moveDown();
      doc.fontSize(10).fillColor("#666").text(`Entry ID: ${entry.id}`);
      doc.text(`Created: ${entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "—"}`);
      if (entry.updatedAt && entry.updatedAt !== entry.createdAt) {
        doc.text(`Updated: ${new Date(entry.updatedAt).toLocaleString()}`);
      }
      doc.fillColor("#000");

      doc.end();
    } catch (err) {
      reject(err);
    }
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

    doc.fontSize(20).text(`Hangup Portal — Payslip${payslip.payrollKind === "training" ? " (Training)" : payslip.payrollKind === "agent" ? " (Agent)" : detailCtx.payrollKindLabel ? ` (${detailCtx.payrollKindLabel})` : ""}`, { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor("#666").text(month, { align: "center" });
    doc.fillColor("#000");
    doc.moveDown();

    doc.fontSize(14).text(payslip.name || "—", { continued: false });
    doc.fontSize(10).fillColor("#666").text(`American Name: ${payslip.name || "—"}`);
    const rawLegal = payslip.arabicName || payslip.legalName || "";
    const legalName = !isLikelyCorruptedName(rawLegal) ? rawLegal : "";
    if (legalName && legalName !== payslip.name) {
      doc.text(`Legal Name: ${legalName}`);
    }
    doc.fillColor("#000");
    doc.fontSize(10).text(`${payslip.employeeId} · ${payslip.unit || "—"} · ${payslip.position || "—"}`);
    doc.moveDown();

    if (payslip.noPayroll) {
      doc.fontSize(11).fillColor("#b45309").text("NO PAYROLL — net pay cleared for this month", { align: "center" });
      doc.fillColor("#000");
      doc.moveDown();
    }
    const gateNotes = detailCtx.payslipGateNotes || payslip.payslipGateNotes || [];
    if (gateNotes.length) {
      doc.fontSize(10).fillColor("#b45309").text("Offboarding / clearance warnings:", { underline: true });
      gateNotes.forEach((n) => doc.fontSize(9).text(`• ${n}`));
      doc.fillColor("#000");
      doc.moveDown();
    }
    if (detailCtx.splitLabel) {
      doc.fontSize(11).text(`Payment tranche: ${detailCtx.splitLabel}`, { align: "center" });
      doc.moveDown();
    }

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

    if (payslip.bonusTransferPayroll > 0) {
      row(doc, "Agent bonuses (from payroll)", `-${fmt(payslip.bonusTransferPayroll)} EGP`);
    }
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

module.exports = { buildPayslipPdf, buildExtraPayrollPdf };

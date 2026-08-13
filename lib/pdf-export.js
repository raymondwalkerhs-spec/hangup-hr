const PDFDocument = require("pdfkit");
const {
  buildPayrollExportRows,
  buildPayrollExportTotals,
} = require("./payroll-export");

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

function drawTableRow(doc, cells, widths, opts = {}) {
  const startX = opts.startX ?? 40;
  const fontSize = opts.fontSize ?? 7.5;
  const padding = opts.padding ?? 4;
  const alignFor = opts.alignFor || (() => "left");
  const bold = opts.bold === true;

  if (bold) doc.font("Helvetica-Bold");
  else doc.font("Helvetica");
  doc.fontSize(fontSize);

  let maxH = 0;
  const heights = cells.map((text, i) => {
    const h = doc.heightOfString(String(text ?? ""), {
      width: widths[i],
      align: alignFor(i),
      lineGap: 1,
    });
    if (h > maxH) maxH = h;
    return h;
  });

  const y = doc.y;
  let x = startX;
  cells.forEach((text, i) => {
    doc.text(String(text ?? ""), x, y, {
      width: widths[i],
      align: alignFor(i),
      lineGap: 1,
    });
    x += widths[i];
  });

  const rowBottom = y + maxH + padding;
  doc.y = rowBottom;
  return { heights, maxH, rowBottom };
}

function buildPayrollTablePdf(payroll, month, totals = {}) {
  return pdfBuffer((doc) => {
    const exportRows = buildPayrollExportRows(payroll);
    const metrics = {
      ...buildPayrollExportTotals(payroll),
      ...totals,
    };

    doc.fontSize(18).text("Hangup Portal — Payroll Summary", { align: "center" });
    doc.fontSize(10).fillColor("#666").text(month, { align: "center" });
    doc.fillColor("#000").moveDown();

    doc.fontSize(9);
    doc.text(
      `Employees: ${exportRows.length}  ·  Net remaining: ${fmt(metrics.totalNet)}  ·  Paid: ${fmt(metrics.totalPaidNet)}  ·  Total net: ${fmt(metrics.totalAllNet)} EGP`
    );
    doc.moveDown(0.5);

    // Portrait A4 usable width ~515pt; keep sum ≤ 510
    const cols = [
      { label: "Employee", w: 118, align: "left" },
      { label: "ID", w: 48, align: "left" },
      { label: "Days", w: 28, align: "center" },
      { label: "Sales", w: 28, align: "center" },
      { label: "Basic", w: 48, align: "right" },
      { label: "Trans.", w: 44, align: "right" },
      { label: "Comm.", w: 44, align: "right" },
      { label: "Loan", w: 40, align: "right" },
      { label: "Net rem.", w: 52, align: "right" },
      { label: "Paid", w: 50, align: "right" },
    ];
    const widths = cols.map((c) => c.w);
    const pageRight = 40 + widths.reduce((a, b) => a + b, 0);

    drawTableRow(
      doc,
      cols.map((c) => c.label),
      widths,
      {
        fontSize: 7.5,
        bold: true,
        padding: 3,
        alignFor: (i) => cols[i].align,
      }
    );
    doc.moveTo(40, doc.y).lineTo(pageRight, doc.y).strokeColor("#cbd5e1").stroke();
    doc.strokeColor("#000");
    doc.moveDown(0.15);

    for (const row of exportRows) {
      if (doc.y > 720) {
        doc.addPage();
        doc.fontSize(8);
      }
      const cells = [
        row.employee,
        row.employeeId,
        String(row.workingDays || "—"),
        String(row.salesCount || "—"),
        fmt(row.basicSalary),
        fmt(row.transport),
        row.commission ? fmt(row.commission) : "—",
        row.loan ? `-${fmt(row.loan)}` : "—",
        fmt(row.netRemaining),
        row.paidNet ? fmt(row.paidNet) : "—",
      ];
      drawTableRow(doc, cells, widths, {
        fontSize: 7,
        padding: 3,
        alignFor: (i) => cols[i].align,
      });
      doc.moveTo(40, doc.y).lineTo(pageRight, doc.y).strokeColor("#e2e8f0").stroke();
      doc.strokeColor("#000").moveDown(0.12);
    }

    doc.moveDown(0.4);
    doc.font("Helvetica-Bold").fontSize(9);
    doc.text(`Net remaining: ${fmt(metrics.totalNet)} EGP`, { align: "right" });
    doc.text(`Paid: ${fmt(metrics.totalPaidNet)} EGP`, { align: "right" });
    doc.text(`Total net: ${fmt(metrics.totalAllNet)} EGP`, { align: "right" });
    doc.font("Helvetica");
  });
}

function buildMonthlyReportPdf(report, month) {
  return pdfBuffer((doc) => {
    doc.fontSize(18).text("Hangup Portal — Monthly Report", { align: "center" });
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

function buildPaymentSheetPdf({ title, month, columns, rows, total }) {
  const amountKeys = new Set(["netSalary", "roundedSalary"]);
  const pageWidth = 515;
  const weights = columns.map((c) => {
    if (amountKeys.has(c.key)) return 1.1;
    if (c.key === "employeeId") return 0.7;
    if (c.key === "name" || c.key === "americanName") return 1.2;
    return 1.4;
  });
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => Math.floor((w / weightSum) * pageWidth));

  return pdfBuffer((doc) => {
    doc.fontSize(16).font("Helvetica-Bold").text(title, { align: "center" });
    doc.font("Helvetica").fontSize(10).fillColor("#666").text(month, { align: "center" });
    doc.fillColor("#000").moveDown();

    const colAlign = (col) => col.align || (amountKeys.has(col.key) ? "right" : "left");
    const cellText = (row, col) => {
      const val = row[col.key];
      return amountKeys.has(col.key) ? fmt(val) : String(val ?? "");
    };

    drawTableRow(
      doc,
      columns.map((c) => c.label),
      widths,
      {
        fontSize: 8,
        bold: true,
        padding: 3,
        alignFor: (i) => colAlign(columns[i]),
      }
    );
    doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor("#cbd5e1").stroke();
    doc.strokeColor("#000").moveDown(0.15);

    for (const row of rows) {
      if (doc.y > 720) {
        doc.addPage();
        doc.fontSize(8);
      }
      drawTableRow(
        doc,
        columns.map((col) => cellText(row, col)),
        widths,
        {
          fontSize: 7.5,
          padding: 3,
          alignFor: (i) => colAlign(columns[i]),
        }
      );
      doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor("#e2e8f0").stroke();
      doc.strokeColor("#000").moveDown(0.1);
    }

    if (total != null) {
      doc.moveDown(0.35);
      const amountIdx = columns.findIndex((c) => amountKeys.has(c.key));
      const totalCells = columns.map((col, i) => {
        if (i === amountIdx) return fmt(total);
        if (i === amountIdx - 1) return "Total";
        return "";
      });
      drawTableRow(doc, totalCells, widths, {
        fontSize: 9,
        bold: true,
        padding: 2,
        alignFor: (i) => colAlign(columns[i]),
      });
    }
    doc.font("Helvetica");
  });
}

module.exports = { buildPayrollTablePdf, buildMonthlyReportPdf, buildPaymentSheetPdf };

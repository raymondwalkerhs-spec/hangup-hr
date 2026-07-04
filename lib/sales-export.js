const XLSX = require("xlsx");
const { buildPaymentSheetPdf } = require("./pdf-export");

const EXPORT_COLUMNS = [
  { key: "submissionDate", label: "Submission date" },
  { key: "effectiveDate", label: "Effective date" },
  { key: "fullName", label: "Customer" },
  { key: "phoneNumber", label: "Phone" },
  { key: "device", label: "Device" },
  { key: "client", label: "Client" },
  { key: "price", label: "Price" },
  { key: "status", label: "Status" },
  { key: "agentId", label: "Agent ID" },
  { key: "agentName", label: "Agent name" },
  { key: "closerId", label: "Closer ID" },
  { key: "closerName", label: "Closer name" },
  { key: "team", label: "Team" },
  { key: "unit", label: "Unit" },
  { key: "feedback", label: "Feedback" },
  { key: "submittedBy", label: "Submitted by" },
  { key: "reviewedBy", label: "Reviewed by" },
];

function empName(empById, id) {
  if (!id) return "";
  const e = empById.get(id);
  return e ? e.american_name || e.full_name || id : id;
}

function saleToRow(sale, empById) {
  return {
    submissionDate: sale.submissionDate || "",
    effectiveDate: sale.effectiveDate || "",
    fullName: sale.fullName || "",
    phoneNumber: sale.phoneNumber || "",
    device: sale.device || sale.formData?.deviceType || "",
    client: sale.client || "",
    price: sale.price != null ? sale.price : "",
    status: sale.status || "",
    agentId: sale.agentId || "",
    agentName: empName(empById, sale.agentId),
    closerId: sale.closerId || "",
    closerName: empName(empById, sale.closerId),
    team: sale.team || "",
    unit: sale.unit || "",
    feedback: sale.feedback || "",
    submittedBy: sale.submittedBy || "",
    reviewedBy: sale.reviewedBy || "",
  };
}

function buildRows(sales, employees) {
  const empById = new Map((employees || []).map((e) => [e.id, e]));
  return (sales || []).map((s) => saleToRow(s, empById));
}

function csvEscape(val) {
  const s = String(val == null ? "" : val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows) {
  const header = EXPORT_COLUMNS.map((c) => csvEscape(c.label)).join(",");
  const body = rows
    .map((row) => EXPORT_COLUMNS.map((c) => csvEscape(row[c.key])).join(","))
    .join("\n");
  return `${header}\n${body}\n`;
}

function toXlsxBuffer(rows) {
  const sheetRows = rows.map((row) => {
    const out = {};
    for (const col of EXPORT_COLUMNS) out[col.label] = row[col.key];
    return out;
  });
  const ws = XLSX.utils.json_to_sheet(sheetRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sales");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

async function toPdfBuffer(rows, meta = {}) {
  const cols = EXPORT_COLUMNS.map((c) => ({ label: c.label, key: c.key, w: 52 }));
  cols[2].w = 72;
  cols[3].w = 68;
  return buildPaymentSheetPdf({
    title: meta.title || "Hangup Portal — Sales export",
    month: meta.subtitle || "",
    columns: cols,
    rows,
    total: null,
  });
}

async function buildExport({ sales, employees, format, meta }) {
  const rows = buildRows(sales, employees);
  const fmt = String(format || "csv").toLowerCase();
  if (fmt === "xlsx" || fmt === "excel") {
    return { buffer: toXlsxBuffer(rows), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" };
  }
  if (fmt === "pdf") {
    const buffer = await toPdfBuffer(rows, meta);
    return { buffer, contentType: "application/pdf", ext: "pdf" };
  }
  return { buffer: Buffer.from(toCsv(rows), "utf8"), contentType: "text/csv", ext: "csv" };
}

module.exports = {
  EXPORT_COLUMNS,
  buildRows,
  buildExport,
};

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
  { key: "priceTierLabel", label: "Price tier" },
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
  { key: "paymentMethod", label: "Payment method" },
  { key: "cardNumber", label: "Card number" },
  { key: "cardExpDate", label: "Card expiry" },
  { key: "cvv", label: "CVV" },
  { key: "bankName", label: "Bank name" },
  { key: "bankAddress", label: "Bank address" },
  { key: "bankAccountNumber", label: "Bank account" },
  { key: "routingNumber", label: "Routing number" },
  { key: "notes", label: "Notes" },
];

// Keys that should not appear as standalone export columns (already covered above)
const FORM_DATA_EXCLUDE_KEYS = new Set([
  "salesClientId", "salesProductId", "salesPriceId",
  "client", "deviceType", "price",
  "priceTier", "priceTierLabel",
  "paymentMethod", "cardNumber", "cardExpDate", "cvv",
  "bankName", "bankAddress", "bankAccountNumber", "routingNumber",
  "notes",
]);

function empName(empById, id) {
  if (!id) return "";
  const e = empById.get(id);
  return e ? e.american_name || e.full_name || id : id;
}

function saleToRow(sale, empById) {
  const fd = sale.formData || {};
  return {
    submissionDate: sale.submissionDate || "",
    effectiveDate: sale.effectiveDate || "",
    fullName: sale.fullName || "",
    phoneNumber: sale.phoneNumber || "",
    device: sale.device || fd.deviceType || "",
    client: sale.client || fd.client || "",
    price: sale.price != null ? sale.price : fd.price != null ? fd.price : "",
    priceTierLabel: sale.priceTierLabel || fd.priceTierLabel || fd.priceTier || "",
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
    paymentMethod: fd.paymentMethod || "",
    cardNumber: fd.cardNumber || "",
    cardExpDate: fd.cardExpDate || "",
    cvv: fd.cvv || "",
    bankName: fd.bankName || "",
    bankAddress: fd.bankAddress || "",
    bankAccountNumber: fd.bankAccountNumber || "",
    routingNumber: fd.routingNumber || "",
    notes: fd.notes || "",
  };
}

function buildRows(sales, employees, columns) {
  const empById = new Map((employees || []).map((e) => [e.id, e]));
  return (sales || []).map((s) => saleToRow(s, empById));
}

function filterColumnsForUser(columns, visibleFieldKeys) {
  if (!visibleFieldKeys || !visibleFieldKeys.size) return columns;
  // Always include core fields
  const alwaysInclude = new Set([
    "submissionDate", "effectiveDate", "fullName", "phoneNumber",
    "agentId", "agentName", "closerId", "closerName", "team", "unit",
    "status", "feedback", "submittedBy", "reviewedBy",
  ]);
  return columns.filter((c) => alwaysInclude.has(c.key) || visibleFieldKeys.has(c.key));
}

function csvEscape(val) {
  const s = String(val == null ? "" : val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows, columns) {
  const cols = columns || EXPORT_COLUMNS;
  const header = cols.map((c) => csvEscape(c.label)).join(",");
  const body = rows
    .map((row) => cols.map((c) => csvEscape(row[c.key])).join(","))
    .join("\n");
  return `${header}\n${body}\n`;
}

function toXlsxBuffer(rows, columns) {
  const cols = columns || EXPORT_COLUMNS;
  const sheetRows = rows.map((row) => {
    const out = {};
    for (const col of cols) out[col.label] = row[col.key];
    return out;
  });
  const ws = XLSX.utils.json_to_sheet(sheetRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sales");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

async function toPdfBuffer(rows, meta = {}, columns) {
  const cols = (columns || EXPORT_COLUMNS).map((c) => ({ label: c.label, key: c.key, w: 52 }));
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

async function buildExport({ sales, employees, format, meta, columns }) {
  const cols = columns || EXPORT_COLUMNS;
  const rows = buildRows(sales, employees, cols);
  const fmt = String(format || "csv").toLowerCase();
  if (fmt === "xlsx" || fmt === "excel") {
    return { buffer: toXlsxBuffer(rows, cols), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" };
  }
  if (fmt === "pdf") {
    const buffer = await toPdfBuffer(rows, meta, cols);
    return { buffer, contentType: "application/pdf", ext: "pdf" };
  }
  return { buffer: Buffer.from(toCsv(rows, cols), "utf8"), contentType: "text/csv", ext: "csv" };
}

module.exports = {
  EXPORT_COLUMNS,
  FORM_DATA_EXCLUDE_KEYS,
  filterColumnsForUser,
  buildRows,
  buildExport,
};

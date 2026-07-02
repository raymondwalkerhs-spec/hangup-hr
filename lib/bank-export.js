const CASH_ROUND_TO = 5;

function ceilToStep(amount, step = CASH_ROUND_TO) {
  if (!amount || amount <= 0) return 0;
  return Math.ceil(amount / step) * step;
}

function normalizePaymentMethod(method) {
  const m = String(method || "").trim().toLowerCase();
  if (!m) return "other";
  if (m.includes("insta") || m.includes("wallet") || m.includes("instapay")) return "insta";
  if (m.includes("cash")) return "cash";
  if (m.includes("bank")) return "bank";
  return "other";
}

function buildPaymentExports(payrollRows, employees) {
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const cash = [];
  const bank = [];
  const insta = [];
  let serial = 1;

  for (const row of payrollRows) {
    const emp = empMap.get(row.employeeId) || {};
    const method = normalizePaymentMethod(emp.payment_method || row.paymentMethod);
    const net = row.netSalary || 0;
    if (net <= 0) continue;

    const base = {
      employeeId: row.employeeId,
      name: row.arabicName || row.name,
      americanName: row.name,
      netSalary: net,
      unit: row.unit,
      paymentMethod: emp.payment_method || row.paymentMethod,
      bankReference: emp.bank_refrence_number || "",
      bankName: emp.bank_name_as_bank_sheet || "",
      instaDetails: emp.payment_details_insta_wallet || "",
    };

    if (method === "cash") {
      cash.push({
        serial: serial++,
        ...base,
        roundedSalary: ceilToStep(net),
      });
    } else if (method === "bank") {
      bank.push(base);
    } else if (method === "insta") {
      insta.push(base);
    }
  }

  return { cash, bank, insta };
}

function toCsv(rows, columns) {
  const header = columns.map((c) => c.label).join(",");
  const lines = rows.map((row) =>
    columns
      .map((c) => {
        const val = row[c.key];
        const s = val == null ? "" : String(val);
        return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(",")
  );
  return [header, ...lines].join("\n");
}

const AMOUNT_KEYS = new Set(["netSalary", "roundedSalary"]);

function getPaymentExportColumns(method) {
  const base = [
    { key: "employeeId", label: "ID" },
    { key: "name", label: "Name" },
    { key: "americanName", label: "American Name" },
  ];
  if (method === "cash") {
    return [...base, { key: "roundedSalary", label: "Net Salary", align: "right" }];
  }
  if (method === "bank") {
    return [
      ...base,
      { key: "netSalary", label: "Net Salary", align: "right" },
      { key: "bankReference", label: "Bank Reference Number" },
      { key: "bankName", label: "Bank Sheet Name" },
    ];
  }
  return [
    ...base,
    { key: "netSalary", label: "Net Salary", align: "right" },
    { key: "instaDetails", label: "Instapay / Wallet Details" },
  ];
}

function paymentExportAmount(row, method) {
  if (method === "cash") return row.roundedSalary ?? ceilToStep(row.netSalary);
  return row.netSalary || 0;
}

function sumPaymentExport(rows, method) {
  return rows.reduce((sum, row) => sum + paymentExportAmount(row, method), 0);
}

function toCsvWithTotal(rows, columns, total) {
  const amountIdx = columns.findIndex((c) => AMOUNT_KEYS.has(c.key));
  const footer = columns.map((c, i) => {
    if (i === amountIdx) return String(Math.round(total * 100) / 100);
    if (i === amountIdx - 1) return "Total";
    return "";
  });
  const escape = (val) => {
    const s = val == null ? "" : String(val);
    return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [toCsv(rows, columns), footer.map(escape).join(",")].join("\n");
}

const PAYMENT_EXPORT_META = {
  cash: { title: "Cash Payroll Sheet", filename: "cash" },
  bank: { title: "Bank Payroll Sheet", filename: "bank" },
  insta: { title: "Instapay / Wallet Payroll Sheet", filename: "instapay" },
};

module.exports = {
  CASH_ROUND_TO,
  ceilToStep,
  buildPaymentExports,
  toCsv,
  toCsvWithTotal,
  getPaymentExportColumns,
  paymentExportAmount,
  sumPaymentExport,
  PAYMENT_EXPORT_META,
  normalizePaymentMethod,
};

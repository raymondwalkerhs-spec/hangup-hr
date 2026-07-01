const CASH_ROUND_TO = 5;

function ceilToStep(amount, step = CASH_ROUND_TO) {
  if (!amount || amount <= 0) return 0;
  return Math.ceil(amount / step) * step;
}

function normalizePaymentMethod(method) {
  const m = String(method || "").toLowerCase();
  if (m.includes("cash")) return "cash";
  if (m.includes("bank")) return "bank";
  if (m.includes("insta") || m.includes("wallet")) return "insta";
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

module.exports = {
  CASH_ROUND_TO,
  ceilToStep,
  buildPaymentExports,
  toCsv,
  normalizePaymentMethod,
};

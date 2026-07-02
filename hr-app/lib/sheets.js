const { getSheetsAuth, getSheetsClient } = require("./google-auth");

const SHEET_ID =
  process.env.SHEET_ID || "17z8JrLV0_4fSXzsiZRpCZWFJk5FTit3IUkw0c3NOkvU";

const TABS = {
  EMPLOYEES: "Employee_Database",
  ATTENDANCE: "Attendance_Events",
  USERS: "App_Users",
  CONFIG: "App_Config",
  POSITION_RATES: "Position_Rates",
  BONUSES: "Bonus_Events",
  DEDUCTIONS: "Deduction_Events",
  PAYROLL_ADJUSTMENTS: "Payroll_Adjustments",
  COMMISSION_TYPES: "Commission_Types",
  EMPLOYEE_DOCUMENTS: "Employee_Documents",
  EMPLOYEE_WARNINGS: "Employee_Warnings",
  COMMISSION_TIERS: "Commission_Tiers",
  EMPLOYEE_LOANS: "Employee_Loans",
  LOAN_PAYMENTS: "Loan_Payments",
  PAYROLL_SPLITS: "Payroll_Splits",
};

const EMPLOYEE_HEADERS = [
  "ID",
  "American Name",
  "Arabic Name",
  "Phone",
  "Email",
  "Employment Date",
  "Status",
  "Position",
  "Department",
  "Unit",
  "Team",
  "Payment Method",
  "Alternative payment",
  "Allowance",
  "Payment Details\n( INSTA _ WALLET)",
  "Identification",
  "Nationality",
  "Bank Refrence Number",
  "Bank Name (AS BANK SHEET)",
  "Profile Photo File ID",
  "Profile Photo Link",
  "Profile Photo Updated",
  "Former IDs",
  "Promoted To ID",
  "Promoted From ID",
  "Lead Role",
  "Effective From Month",
];

const ATTENDANCE_HEADERS = [
  "employee_id",
  "date",
  "status",
  "fp_lateness",
  "weekend_default",
  "transport_override",
  "updated_by",
  "updated_at",
];

const USER_HEADERS = ["email", "role", "unit", "employee_id"];
const CONFIG_HEADERS = ["key", "value"];
const POSITION_HEADERS = ["Position", "Monthly Salary (EGP)"];
const BONUS_HEADERS = [
  "employee_id",
  "date",
  "amount",
  "reason",
  "type",
  "unit",
  "updated_by",
  "updated_at",
];
const DEDUCTION_HEADERS = [...BONUS_HEADERS];

const PAYROLL_ADJ_HEADERS = [
  "employee_id",
  "year_month",
  "extra_days",
  "two_week_hold",
  "commission_type",
  "commission_amount",
  "commission_comments",
  "position",
  "salary_raise",
  "monthly_salary_override",
  "payment_method",
  "bank_refrence_number",
  "bank_name",
  "payroll_status",
  "transport_eligible",
  "month_notes",
  "sales_count",
  "updated_by",
  "updated_at",
];

const COMMISSION_TIER_HEADERS = ["year_month", "min_sales", "bonus_amount", "label"];

const LOAN_HEADERS = [
  "id",
  "employee_id",
  "total_amount",
  "installment_amount",
  "installments_count",
  "installments_paid",
  "start_year_month",
  "skip_current_month",
  "created_year_month",
  "notes",
  "status",
  "created_by",
  "created_at",
];

const LOAN_PAYMENT_HEADERS = [
  "loan_id",
  "employee_id",
  "year_month",
  "amount",
  "installment_number",
  "recorded_by",
  "recorded_at",
];

const PAYROLL_SPLIT_HEADERS = [
  "id",
  "employee_id",
  "year_month",
  "amount",
  "split_kind",
  "status",
  "defer_to_month",
  "notes",
  "created_by",
  "created_at",
];

const WARNING_HEADERS = [
  "id",
  "employee_id",
  "date",
  "type",
  "title",
  "content",
  "severity",
  "created_by",
  "created_at",
];

const COMMISSION_TYPE_HEADERS = ["name", "rate_egp", "description", "active"];

const DOCUMENT_HEADERS = [
  "employee_id",
  "doc_type",
  "file_name",
  "drive_file_id",
  "drive_link",
  "uploaded_at",
  "expiry",
  "notes",
  "updated_by",
];

const EMPLOYEE_STATUSES = [
  "Active",
  "Paused",
  "Paused still get paid",
  "OUT BUT STILL GET PAID",
  "Promoted",
  "Out",
  "",
];

async function auth() {
  return getSheetsAuth();
}

async function getSpreadsheet() {
  const a = await auth();
  const sheets = getSheetsClient(a);
  return sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
}

async function ensureTab(title, headers) {
  const a = await auth();
  const sheets = getSheetsClient(a);
  const meta = await getSpreadsheet();
  const exists = meta.data.sheets.some((s) => s.properties.title === title);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
    if (headers?.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${title}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [headers] },
      });
    }
  }
}

async function readTab(title) {
  const a = await auth();
  const sheets = getSheetsClient(a);
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${title}!A:Z`,
    });
    const rows = res.data.values || [];
    if (rows.length < 2) return [];
    const headers = rows[0].map((h) => String(h).trim());
    return rows.slice(1).map((row) => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] !== undefined && row[i] !== "" ? row[i] : null;
      });
      return obj;
    });
  } catch (err) {
    if (err.code === 404 || err.message?.includes("Unable to parse range")) return [];
    throw err;
  }
}

function mapEmployeeRow(r) {
  return {
    id: String(r.ID || r.id || "").trim(),
    american_name: r["American Name"] || r.american_name || null,
    arabic_name: r["Arabic Name"] || r.arabic_name || null,
    phone: r.Phone || r.phone || null,
    email: r.Email || r.email || null,
    employment_date: r["Employment Date"] || r.employment_date || null,
    status: r.Status || r.status || null,
    position: r.Position || r.position || null,
    department: r.Department || r.department || null,
    unit: r.Unit || r.unit || null,
    team: r.Team || r.team || null,
    payment_method: r["Payment Method"] || r.payment_method || null,
    alternative_payment: r["Alternative payment"] || r.alternative_payment || null,
    allowance: r.Allowance || r.allowance || null,
    payment_details_insta_wallet:
      r["Payment Details\n( INSTA _ WALLET)"] || r.payment_details_insta_wallet || null,
    identification: r.Identification || r.identification || null,
    nationality: r.Nationality || r.nationality || null,
    work_permit: r.work_permit || r["Work Permit"] || null,
    insurance_status: r.insurance_status || r["Insurance Status"] || null,
    insurance_type: r.insurance_type || r["Insurance Type"] || null,
    insurance_amount:
      r.insurance_amount != null && r.insurance_amount !== ""
        ? Number(r.insurance_amount)
        : r["Insurance Amount"] != null && r["Insurance Amount"] !== ""
          ? Number(r["Insurance Amount"])
          : null,
    insurance_employee_deduction:
      r.insurance_employee_deduction != null && r.insurance_employee_deduction !== ""
        ? Number(r.insurance_employee_deduction)
        : r["Insurance Employee Deduction"] != null && r["Insurance Employee Deduction"] !== ""
          ? Number(r["Insurance Employee Deduction"])
          : null,
    depart_date: r.depart_date || r["Depart Date"] || null,
    notice_type: r.notice_type || r["Notice Type"] || null,
    bank_refrence_number: r["Bank Refrence Number"] || r.bank_refrence_number || null,
    bank_name_as_bank_sheet: r["Bank Name (AS BANK SHEET)"] || r.bank_name_as_bank_sheet || null,
    profile_photo_file_id: String(r["Profile Photo File ID"] || r.profile_photo_file_id || "").trim(),
    profile_photo_link: r["Profile Photo Link"] || r.profile_photo_link || null,
    profile_photo_updated: r["Profile Photo Updated"] || r.profile_photo_updated || null,
    former_ids: r["Former IDs"] || r.former_ids || null,
    promoted_to_id: String(r["Promoted To ID"] || r.promoted_to_id || "").trim() || null,
    promoted_from_id: String(r["Promoted From ID"] || r.promoted_from_id || "").trim() || null,
    lead_role: String(r["Lead Role"] || r.lead_role || "").trim() || null,
    effective_from_month: String(r["Effective From Month"] || r.effective_from_month || "").trim() || null,
  };
}

function employeeToRow(emp) {
  return [
    emp.id || "",
    emp.american_name || "",
    emp.arabic_name || "",
    emp.phone || "",
    emp.email || "",
    emp.employment_date || "",
    emp.status || "",
    emp.position || "",
    emp.department || "",
    emp.unit || "",
    emp.team || "",
    emp.payment_method || "",
    emp.alternative_payment || "",
    emp.allowance || "",
    emp.payment_details_insta_wallet || "",
    emp.identification || "",
    emp.nationality || "",
    emp.bank_refrence_number || "",
    emp.bank_name_as_bank_sheet || "",
    emp.profile_photo_file_id || "",
    emp.profile_photo_link || "",
    emp.profile_photo_updated || "",
    emp.former_ids || "",
    emp.promoted_to_id || "",
    emp.promoted_from_id || "",
    emp.lead_role || "",
    emp.effective_from_month || "",
  ];
}

function columnLetter(index) {
  let n = index;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const EMPLOYEE_LAST_COL = columnLetter(EMPLOYEE_HEADERS.length);
const EMPLOYEE_ROW_RANGE = `A:${EMPLOYEE_LAST_COL}`;

async function ensureEmployeeSheetHeaders() {
  await ensureTab(TABS.EMPLOYEES, EMPLOYEE_HEADERS);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TABS.EMPLOYEES}!1:1`,
  });
  const row = res.data.values?.[0] || [];
  if (row.length >= EMPLOYEE_HEADERS.length) return;
  const padded = [...row];
  while (padded.length < EMPLOYEE_HEADERS.length) {
    padded.push(EMPLOYEE_HEADERS[padded.length] || "");
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TABS.EMPLOYEES}!A1:${EMPLOYEE_LAST_COL}1`,
    valueInputOption: "RAW",
    requestBody: { values: [padded.slice(0, EMPLOYEE_HEADERS.length)] },
  });
}

async function readEmployees() {
  await ensureEmployeeSheetHeaders();
  const rows = await readTab(TABS.EMPLOYEES);
  return rows.filter((r) => r.ID || r.id).map(mapEmployeeRow);
}

async function getEmployeeById(id) {
  const employees = await readEmployees();
  return employees.find((e) => e.id === id) || null;
}

async function findEmployeeSheetRow(id) {
  const a = await auth();
  const sheets = getSheetsClient(a);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TABS.EMPLOYEES}!A:A`,
  });
  const rows = res.data.values || [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || "").trim() === id) return i + 1;
  }
  return -1;
}

async function createEmployee(emp, updatedBy = "system") {
  await ensureTab(TABS.EMPLOYEES, EMPLOYEE_HEADERS);
  if (!emp.id) throw new Error("Employee ID is required");
  const existing = await getEmployeeById(emp.id);
  if (existing) throw new Error(`Employee ID ${emp.id} already exists`);

  const a = await auth();
  const sheets = getSheetsClient(a);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${TABS.EMPLOYEES}!${EMPLOYEE_ROW_RANGE}`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [employeeToRow(emp)] },
  });
  return mapEmployeeRow(emp);
}

async function updateEmployee(id, updates, updatedBy = "system") {
  await ensureTab(TABS.EMPLOYEES, EMPLOYEE_HEADERS);
  const rowNum = await findEmployeeSheetRow(id);
  if (rowNum < 0) throw new Error("Employee not found");

  const current = await getEmployeeById(id);
  const merged = { ...current, ...updates, id };
  const a = await auth();
  const sheets = getSheetsClient(a);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TABS.EMPLOYEES}!A${rowNum}:${EMPLOYEE_LAST_COL}${rowNum}`,
    valueInputOption: "RAW",
    requestBody: { values: [employeeToRow(merged)] },
  });
  return merged;
}

async function writeEmployeeDatabase(employees) {
  await ensureTab(TABS.EMPLOYEES, EMPLOYEE_HEADERS);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const values = [EMPLOYEE_HEADERS, ...employees.map((e) => employeeToRow(mapEmployeeRow(e)))];
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${TABS.EMPLOYEES}!A:Z`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TABS.EMPLOYEES}!A1`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
  return employees.length;
}

async function writePositionRates(rates) {
  await ensureTab(TABS.POSITION_RATES, POSITION_HEADERS);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const values = [
    POSITION_HEADERS,
    ...rates.map((r) => [r.position, r.monthlySalary]),
  ];
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${TABS.POSITION_RATES}!A:Z`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TABS.POSITION_RATES}!A1`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
  return rates.length;
}

function attendanceRowValues(record, updatedBy, now = new Date().toISOString()) {
  return [
    record.employeeId,
    record.date,
    record.status || "",
    record.fpLateness || "",
    record.isWeekendDefault ? "TRUE" : "FALSE",
    record.transportOverride || "",
    updatedBy,
    now,
  ];
}

function mapAttendanceRow(r) {
  return {
    employeeId: String(r.employee_id || "").trim(),
    date: String(r.date).slice(0, 10),
    status: r.status || "",
    fpLateness: r.fp_lateness || null,
    isWeekendDefault: r.weekend_default === "TRUE",
    transportOverride: r.transport_override || "",
  };
}

async function readAttendanceEvents(yearMonth) {
  await ensureTab(TABS.ATTENDANCE, ATTENDANCE_HEADERS);
  const rows = await readTab(TABS.ATTENDANCE);
  const prefix = yearMonth + "-";
  return rows
    .filter((r) => r.date && String(r.date).startsWith(prefix))
    .map(mapAttendanceRow);
}

async function clearAttendanceMonth(yearMonth) {
  await ensureTab(TABS.ATTENDANCE, ATTENDANCE_HEADERS);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TABS.ATTENDANCE}!A:H`,
  });
  const rows = res.data.values || [];
  const keep = [rows[0] || ATTENDANCE_HEADERS];
  const prefix = yearMonth + "-";
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i][1];
    if (!d || !String(d).startsWith(prefix)) keep.push(rows[i]);
  }
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${TABS.ATTENDANCE}!A:Z`,
  });
  if (keep.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${TABS.ATTENDANCE}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: keep },
    });
  }
}

async function batchWriteAttendance(records, updatedBy = "import") {
  await ensureTab(TABS.ATTENDANCE, ATTENDANCE_HEADERS);
  if (!records.length) return 0;
  const now = new Date().toISOString();
  const values = records.map((r) => attendanceRowValues(r, updatedBy, now));
  const a = await auth();
  const sheets = getSheetsClient(a);
  const CHUNK = 500;
  for (let i = 0; i < values.length; i += CHUNK) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${TABS.ATTENDANCE}!A:H`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: values.slice(i, i + CHUNK) },
    });
  }
  return records.length;
}

async function readUsers() {
  await ensureTab(TABS.USERS, USER_HEADERS);
  return readTab(TABS.USERS);
}

async function readConfig() {
  await ensureTab(TABS.CONFIG, CONFIG_HEADERS);
  const rows = await readTab(TABS.CONFIG);
  const out = {
    defaultWeekendDays: [6, 0],
    weekendDayNames: ["Saturday", "Sunday"],
    latenessRules: {
      tierA: { label: "Lateness A", beforeHour: 15, amount: 25 },
      tierB: { label: "Lateness B", afterHour: 15, amount: 50 },
    },
    workingDaysByMonth: {},
    hideOutEmployees: true,
    transportAllowanceMonthly: 3000,
  };
  for (const row of rows) {
    if (!row.key) continue;
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      out[row.key] = row.value;
    }
  }
  return {
    defaultWeekendDays: out.defaultWeekendDays || [6, 0],
    weekendDayNames: out.weekendDayNames || ["Saturday", "Sunday"],
    latenessRules: out.latenessRules,
    workingDaysByMonth: out.workingDaysByMonth || {},
    hideOutEmployees: out.hideOutEmployees !== false,
    transportAllowanceMonthly: Number(out.transportAllowanceMonthly) || 3000,
  };
}

async function saveConfigKey(key, value) {
  await ensureTab(TABS.CONFIG, CONFIG_HEADERS);
  const rows = await readTab(TABS.CONFIG);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const val = typeof value === "string" ? value : JSON.stringify(value);
  const idx = rows.findIndex((r) => r.key === key);
  if (idx >= 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${TABS.CONFIG}!B${idx + 2}`,
      valueInputOption: "RAW",
      requestBody: { values: [[val]] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${TABS.CONFIG}!A:B`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [[key, val]] },
    });
  }
}

async function writeFullConfig(config) {
  await ensureTab(TABS.CONFIG, CONFIG_HEADERS);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const entries = Object.entries(config).map(([key, value]) => [
    key,
    typeof value === "string" ? value : JSON.stringify(value),
  ]);
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${TABS.CONFIG}!A:Z`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TABS.CONFIG}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [[...CONFIG_HEADERS], ...entries] },
  });
}

async function readPositionRates() {
  const rows = await readTab(TABS.POSITION_RATES);
  return rows
    .filter((r) => r.Position || r.position)
    .map((r) => ({
      position: String(r.Position || r.position).trim(),
      monthlySalary: parseFloat(r["Monthly Salary (EGP)"] || r.monthly_salary || 0) || 0,
    }));
}

async function readBonusEvents(yearMonth) {
  await ensureTab(TABS.BONUSES, BONUS_HEADERS);
  const rows = await readTab(TABS.BONUSES);
  const prefix = yearMonth + "-";
  return rows
    .filter((r) => r.date && String(r.date).startsWith(prefix))
    .map((r) => ({
      employeeId: String(r.employee_id || "").trim(),
      date: String(r.date).slice(0, 10),
      amount: parseFloat(r.amount) || 0,
      reason: r.reason || "",
      type: r.type || "Other Bonus",
      unit: r.unit || "",
    }));
}

async function readDeductionEvents(yearMonth) {
  await ensureTab(TABS.DEDUCTIONS, DEDUCTION_HEADERS);
  const rows = await readTab(TABS.DEDUCTIONS);
  const prefix = yearMonth + "-";
  return rows
    .filter((r) => r.date && String(r.date).startsWith(prefix))
    .map((r) => ({
      employeeId: String(r.employee_id || "").trim(),
      date: String(r.date).slice(0, 10),
      amount: parseFloat(r.amount) || 0,
      reason: r.reason || "",
      type: r.type || "Other Deductions",
      unit: r.unit || "",
    }));
}

async function upsertBonusEvent(record, updatedBy) {
  await ensureTab(TABS.BONUSES, BONUS_HEADERS);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TABS.BONUSES}!A:H`,
  });
  const rows = res.data.values || [];
  const now = new Date().toISOString();
  const rowValues = [
    record.employeeId,
    record.date,
    record.amount,
    record.reason || "",
    record.type || "Other Bonus",
    record.unit || "",
    updatedBy,
    now,
  ];
  let found = -1;
  for (let i = 1; i < rows.length; i++) {
    if (
      rows[i][0] === record.employeeId &&
      rows[i][1] === record.date &&
      rows[i][4] === (record.type || "Other Bonus")
    ) {
      found = i + 1;
      break;
    }
  }
  if (found > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${TABS.BONUSES}!A${found}:H${found}`,
      valueInputOption: "RAW",
      requestBody: { values: [rowValues] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${TABS.BONUSES}!A:H`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [rowValues] },
    });
  }
}

async function upsertDeductionEvent(record, updatedBy) {
  await ensureTab(TABS.DEDUCTIONS, DEDUCTION_HEADERS);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TABS.DEDUCTIONS}!A:H`,
  });
  const rows = res.data.values || [];
  const now = new Date().toISOString();
  const rowValues = [
    record.employeeId,
    record.date,
    record.amount,
    record.reason || "",
    record.type || "Other Deductions",
    record.unit || "",
    updatedBy,
    now,
  ];
  let found = -1;
  for (let i = 1; i < rows.length; i++) {
    if (
      rows[i][0] === record.employeeId &&
      rows[i][1] === record.date &&
      rows[i][4] === (record.type || "Other Deductions")
    ) {
      found = i + 1;
      break;
    }
  }
  if (found > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${TABS.DEDUCTIONS}!A${found}:H${found}`,
      valueInputOption: "RAW",
      requestBody: { values: [rowValues] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${TABS.DEDUCTIONS}!A:H`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [rowValues] },
    });
  }
}

async function batchWriteBonuses(records, updatedBy = "import") {
  await ensureTab(TABS.BONUSES, BONUS_HEADERS);
  if (!records.length) return 0;
  const now = new Date().toISOString();
  const values = records.map((r) => [
    r.employeeId,
    r.date,
    r.amount,
    r.reason || "",
    r.type || "Other Bonus",
    r.unit || "",
    updatedBy,
    now,
  ]);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const CHUNK = 500;
  for (let i = 0; i < values.length; i += CHUNK) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${TABS.BONUSES}!A:H`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: values.slice(i, i + CHUNK) },
    });
  }
  return records.length;
}

async function batchWriteDeductions(records, updatedBy = "import") {
  await ensureTab(TABS.DEDUCTIONS, DEDUCTION_HEADERS);
  if (!records.length) return 0;
  const now = new Date().toISOString();
  const values = records.map((r) => [
    r.employeeId,
    r.date,
    r.amount,
    r.reason || "",
    r.type || "Other Deductions",
    r.unit || "",
    updatedBy,
    now,
  ]);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const CHUNK = 500;
  for (let i = 0; i < values.length; i += CHUNK) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${TABS.DEDUCTIONS}!A:H`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: values.slice(i, i + CHUNK) },
    });
  }
  return records.length;
}

async function upsertAttendanceRow(record, updatedBy) {
  await ensureTab(TABS.ATTENDANCE, ATTENDANCE_HEADERS);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TABS.ATTENDANCE}!A:H`,
  });
  const rows = res.data.values || [];
  const now = new Date().toISOString();
  const rowValues = attendanceRowValues(record, updatedBy, now);

  let foundRow = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === record.employeeId && rows[i][1] === record.date) {
      foundRow = i + 1;
      break;
    }
  }

  if (foundRow > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${TABS.ATTENDANCE}!A${foundRow}:H${foundRow}`,
      valueInputOption: "RAW",
      requestBody: { values: [rowValues] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${TABS.ATTENDANCE}!A:H`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [rowValues] },
    });
  }
}

async function batchUpsertAttendance(records, updatedBy) {
  if (!records.length) return 0;
  await ensureTab(TABS.ATTENDANCE, ATTENDANCE_HEADERS);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TABS.ATTENDANCE}!A:H`,
  });
  const rows = res.data.values || [];
  const index = new Map();
  for (let i = 1; i < rows.length; i++) {
    index.set(`${rows[i][0]}|${rows[i][1]}`, i + 1);
  }
  const now = new Date().toISOString();
  const updates = [];
  const appends = [];
  for (const record of records) {
    const rowValues = attendanceRowValues(record, updatedBy, now);
    const key = `${record.employeeId}|${record.date}`;
    const rowNum = index.get(key);
    if (rowNum) {
      updates.push({
        range: `${TABS.ATTENDANCE}!A${rowNum}:H${rowNum}`,
        values: [rowValues],
      });
    } else {
      appends.push(rowValues);
    }
  }
  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: "RAW",
        data: updates.map((u) => ({
          range: u.range,
          values: u.values,
        })),
      },
    });
  }
  if (appends.length) {
    const CHUNK = 500;
    for (let i = 0; i < appends.length; i += CHUNK) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${TABS.ATTENDANCE}!A:H`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: appends.slice(i, i + CHUNK) },
      });
    }
  }
  return records.length;
}

async function deleteBonusEvent(employeeId, date, type) {
  await ensureTab(TABS.BONUSES, BONUS_HEADERS);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TABS.BONUSES}!A:H`,
  });
  const rows = res.data.values || [];
  const keep = [rows[0] || BONUS_HEADERS];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r[0] === employeeId && r[1] === date && r[4] === type) continue;
    keep.push(r);
  }
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${TABS.BONUSES}!A:Z`,
  });
  if (keep.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${TABS.BONUSES}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: keep },
    });
  }
}

async function deleteDeductionEvent(employeeId, date, type) {
  await ensureTab(TABS.DEDUCTIONS, DEDUCTION_HEADERS);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TABS.DEDUCTIONS}!A:H`,
  });
  const rows = res.data.values || [];
  const keep = [rows[0] || DEDUCTION_HEADERS];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r[0] === employeeId && r[1] === date && r[4] === type) continue;
    keep.push(r);
  }
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${TABS.DEDUCTIONS}!A:Z`,
  });
  if (keep.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${TABS.DEDUCTIONS}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: keep },
    });
  }
}

async function readAllAttendanceEvents() {
  await ensureTab(TABS.ATTENDANCE, ATTENDANCE_HEADERS);
  const rows = await readTab(TABS.ATTENDANCE);
  return rows.map(mapAttendanceRow);
}

async function readAllBonusEvents() {
  await ensureTab(TABS.BONUSES, BONUS_HEADERS);
  const rows = await readTab(TABS.BONUSES);
  return rows
    .filter((r) => r.employee_id && r.date)
    .map((r) => ({
      employeeId: String(r.employee_id || "").trim(),
      date: String(r.date).slice(0, 10),
      amount: parseFloat(r.amount) || 0,
      reason: r.reason || "",
      type: r.type || "Other Bonus",
      unit: r.unit || "",
    }));
}

async function readAllDeductionEvents() {
  await ensureTab(TABS.DEDUCTIONS, DEDUCTION_HEADERS);
  const rows = await readTab(TABS.DEDUCTIONS);
  return rows
    .filter((r) => r.employee_id && r.date)
    .map((r) => ({
      employeeId: String(r.employee_id || "").trim(),
      date: String(r.date).slice(0, 10),
      amount: parseFloat(r.amount) || 0,
      reason: r.reason || "",
      type: r.type || "Other Deductions",
      unit: r.unit || "",
    }));
}

async function verifySheetAccess() {
  await getSpreadsheet();
  return true;
}

function mapPayrollAdjustmentRow(r) {
  const { resolveTransportEligible } = require("./month-profile");
  const yearMonth = String(r.year_month || "").trim();
  return {
    employeeId: String(r.employee_id || "").trim(),
    yearMonth,
    extraDays: parseFloat(r.extra_days) || 0,
    twoWeekHold:
      r.two_week_hold === true ||
      r.two_week_hold === "TRUE" ||
      String(r.two_week_hold || "").toLowerCase() === "yes",
    commissionType: r.commission_type || "",
    commissionAmount: parseFloat(r.commission_amount) || 0,
    commissionComments: r.commission_comments || "",
    position: r.position || "",
    salaryRaise: parseFloat(r.salary_raise) || 0,
    monthlySalaryOverride:
      r.monthly_salary_override != null && r.monthly_salary_override !== ""
        ? parseFloat(r.monthly_salary_override)
        : null,
    paymentMethod: r.payment_method || "",
    bankReference: r.bank_refrence_number || "",
    bankName: r.bank_name || "",
    payrollStatus: r.payroll_status || "pending",
    transportEligible: resolveTransportEligible(yearMonth, r.transport_eligible),
    monthNotes: r.month_notes || "",
    salesCount: parseInt(r.sales_count, 10) || 0,
  };
}

function payrollAdjArrayToRow(arr) {
  const obj = {};
  PAYROLL_ADJ_HEADERS.forEach((key, i) => {
    obj[key] = arr[i];
  });
  return mapPayrollAdjustmentRow(obj);
}

function profileToRowValues(record, updatedBy) {
  const now = new Date().toISOString();
  return [
    record.employeeId,
    record.yearMonth,
    record.extraDays ?? 0,
    record.twoWeekHold ? "TRUE" : "FALSE",
    record.commissionType || "",
    record.commissionAmount ?? 0,
    record.commissionComments || "",
    record.position || "",
    record.salaryRaise ?? 0,
    record.monthlySalaryOverride ?? "",
    record.paymentMethod || "",
    record.bankReference || "",
    record.bankName || "",
    record.payrollStatus || "pending",
    record.transportEligible !== false ? "TRUE" : "FALSE",
    record.monthNotes || "",
    record.salesCount ?? 0,
    updatedBy,
    now,
  ];
}

const PAYROLL_ADJ_RANGE = "A:S";

async function readAllPayrollAdjustments() {
  await ensureTab(TABS.PAYROLL_ADJUSTMENTS, PAYROLL_ADJ_HEADERS);
  const rows = await readTab(TABS.PAYROLL_ADJUSTMENTS);
  return rows.filter((r) => r.employee_id && r.year_month).map(mapPayrollAdjustmentRow);
}

async function readPayrollAdjustments(yearMonth) {
  const all = await readAllPayrollAdjustments();
  return all.filter((r) => r.yearMonth === yearMonth);
}

async function upsertPayrollAdjustment(record, updatedBy = "system") {
  await ensureTab(TABS.PAYROLL_ADJUSTMENTS, PAYROLL_ADJ_HEADERS);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TABS.PAYROLL_ADJUSTMENTS}!${PAYROLL_ADJ_RANGE}`,
  });
  const rows = res.data.values || [];
  const existing = rows.find(
    (row, i) => i > 0 && row[0] === record.employeeId && row[1] === record.yearMonth
  );
  const prior = existing ? payrollAdjArrayToRow(existing) : {};
  const merged = mapPayrollAdjustmentRow({
    employee_id: record.employeeId,
    year_month: record.yearMonth,
    extra_days: record.extraDays ?? prior.extraDays,
    two_week_hold:
      record.twoWeekHold !== undefined ? (record.twoWeekHold ? "TRUE" : "FALSE") : prior.twoWeekHold ? "TRUE" : "FALSE",
    commission_type: record.commissionType ?? prior.commissionType,
    commission_amount: record.commissionAmount ?? prior.commissionAmount,
    commission_comments: record.commissionComments ?? prior.commissionComments,
    position: record.position ?? prior.position,
    salary_raise: record.salaryRaise ?? prior.salaryRaise,
    monthly_salary_override: record.monthlySalaryOverride ?? prior.monthlySalaryOverride ?? "",
    payment_method: record.paymentMethod ?? prior.paymentMethod,
    bank_refrence_number: record.bankReference ?? prior.bankReference,
    bank_name: record.bankName ?? prior.bankName,
    payroll_status: record.payrollStatus ?? prior.payrollStatus,
    transport_eligible:
      record.transportEligible !== undefined
        ? record.transportEligible
          ? "TRUE"
          : "FALSE"
        : prior.transportEligible !== false
          ? "TRUE"
          : "FALSE",
    month_notes: record.monthNotes ?? prior.monthNotes,
    sales_count: record.salesCount ?? prior.salesCount ?? 0,
  });

  const rowValues = profileToRowValues(merged, updatedBy);
  let found = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === record.employeeId && rows[i][1] === record.yearMonth) {
      found = i + 1;
      break;
    }
  }
  if (found > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${TABS.PAYROLL_ADJUSTMENTS}!A${found}:S${found}`,
      valueInputOption: "RAW",
      requestBody: { values: [rowValues] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${TABS.PAYROLL_ADJUSTMENTS}!${PAYROLL_ADJ_RANGE}`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [rowValues] },
    });
  }
  return merged;
}

async function clearPayrollAdjustmentsMonth(yearMonth) {
  await ensureTab(TABS.PAYROLL_ADJUSTMENTS, PAYROLL_ADJ_HEADERS);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TABS.PAYROLL_ADJUSTMENTS}!${PAYROLL_ADJ_RANGE}`,
  });
  const rows = res.data.values || [];
  const keep = [rows[0] || PAYROLL_ADJ_HEADERS];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] !== yearMonth) keep.push(rows[i]);
  }
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${TABS.PAYROLL_ADJUSTMENTS}!A:Z`,
  });
  if (keep.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${TABS.PAYROLL_ADJUSTMENTS}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: keep },
    });
  }
}

async function batchWritePayrollAdjustments(records, updatedBy = "import") {
  await ensureTab(TABS.PAYROLL_ADJUSTMENTS, PAYROLL_ADJ_HEADERS);
  if (!records.length) return 0;
  const values = records.map((r) => profileToRowValues(mapPayrollAdjustmentRow({
    employee_id: r.employeeId,
    year_month: r.yearMonth,
    extra_days: r.extraDays,
    two_week_hold: r.twoWeekHold ? "TRUE" : "FALSE",
    commission_type: r.commissionType,
    commission_amount: r.commissionAmount,
    commission_comments: r.commissionComments,
    position: r.position,
    salary_raise: r.salaryRaise,
    monthly_salary_override: r.monthlySalaryOverride,
    payment_method: r.paymentMethod,
    bank_refrence_number: r.bankReference,
    bank_name: r.bankName,
    payroll_status: r.payrollStatus,
    transport_eligible: r.transportEligible !== false ? "TRUE" : "FALSE",
    month_notes: r.monthNotes,
    sales_count: r.salesCount ?? 0,
  }), updatedBy));
  const a = await auth();
  const sheets = getSheetsClient(a);
  const CHUNK = 500;
  for (let i = 0; i < values.length; i += CHUNK) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${TABS.PAYROLL_ADJUSTMENTS}!${PAYROLL_ADJ_RANGE}`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: values.slice(i, i + CHUNK) },
    });
  }
  return records.length;
}

async function readCommissionTypes() {
  await ensureTab(TABS.COMMISSION_TYPES, COMMISSION_TYPE_HEADERS);
  const rows = await readTab(TABS.COMMISSION_TYPES);
  return rows
    .filter((r) => r.name)
    .map((r) => ({
      name: String(r.name).trim(),
      rateEgp: parseFloat(r.rate_egp) || 0,
      description: r.description || "",
      active: r.active === true || String(r.active || "").toLowerCase() === "yes",
    }));
}

async function writeCommissionTypes(types) {
  await ensureTab(TABS.COMMISSION_TYPES, COMMISSION_TYPE_HEADERS);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const values = [
    COMMISSION_TYPE_HEADERS,
    ...types.map((t) => [t.name, t.rateEgp, t.description || "", t.active ? "Yes" : "No"]),
  ];
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${TABS.COMMISSION_TYPES}!A:Z`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TABS.COMMISSION_TYPES}!A1`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
  return types.length;
}

async function readEmployeeDocuments(employeeId) {
  await ensureTab(TABS.EMPLOYEE_DOCUMENTS, DOCUMENT_HEADERS);
  const rows = await readTab(TABS.EMPLOYEE_DOCUMENTS);
  return rows
    .filter((r) => r.employee_id && (!employeeId || r.employee_id === employeeId))
    .map((r) => ({
      employeeId: String(r.employee_id).trim(),
      docType: r.doc_type || "",
      fileName: r.file_name || "",
      driveFileId: r.drive_file_id || "",
      driveLink: r.drive_link || "",
      uploadedAt: r.uploaded_at || "",
      expiry: r.expiry || "",
      notes: r.notes || "",
    }));
}

async function appendEmployeeDocument(doc, updatedBy = "system") {
  await ensureTab(TABS.EMPLOYEE_DOCUMENTS, DOCUMENT_HEADERS);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const now = new Date().toISOString();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${TABS.EMPLOYEE_DOCUMENTS}!A:I`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [
        [
          doc.employeeId,
          doc.docType || "",
          doc.fileName || "",
          doc.driveFileId || "",
          doc.driveLink || "",
          doc.uploadedAt || now,
          doc.expiry || "",
          doc.notes || "",
          updatedBy,
        ],
      ],
    },
  });
  return { ...doc, uploadedAt: doc.uploadedAt || now };
}

async function readAllEmployeeDocuments() {
  return readEmployeeDocuments();
}

function mapWarningRow(r) {
  return {
    id: String(r.id || "").trim(),
    employeeId: String(r.employee_id || "").trim(),
    date: String(r.date || "").slice(0, 10),
    type: r.type || "Note",
    title: r.title || "",
    content: r.content || "",
    severity: r.severity || "normal",
    createdBy: r.created_by || "",
    createdAt: r.created_at || "",
  };
}

async function readEmployeeWarnings(employeeId) {
  await ensureTab(TABS.EMPLOYEE_WARNINGS, WARNING_HEADERS);
  const rows = await readTab(TABS.EMPLOYEE_WARNINGS);
  return rows
    .filter((r) => r.employee_id && (!employeeId || r.employee_id === employeeId))
    .map(mapWarningRow)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

async function readAllEmployeeWarnings() {
  return readEmployeeWarnings();
}

async function appendEmployeeWarning(warning, createdBy = "system") {
  await ensureTab(TABS.EMPLOYEE_WARNINGS, WARNING_HEADERS);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const id = warning.id || `W-${Date.now()}`;
  const now = new Date().toISOString();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${TABS.EMPLOYEE_WARNINGS}!A:I`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [
        [
          id,
          warning.employeeId,
          warning.date || now.slice(0, 10),
          warning.type || "Note",
          warning.title || "",
          warning.content || "",
          warning.severity || "normal",
          createdBy,
          now,
        ],
      ],
    },
  });
  return mapWarningRow({
    id,
    employee_id: warning.employeeId,
    date: warning.date,
    type: warning.type,
    title: warning.title,
    content: warning.content,
    severity: warning.severity,
    created_by: createdBy,
    created_at: now,
  });
}

async function upsertPositionRate(position, monthlySalary) {
  await ensureTab(TABS.POSITION_RATES, POSITION_HEADERS);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TABS.POSITION_RATES}!A:B`,
  });
  const rows = res.data.values || [];
  let found = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || "").trim() === position) {
      found = i + 1;
      break;
    }
  }
  if (found > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${TABS.POSITION_RATES}!B${found}`,
      valueInputOption: "RAW",
      requestBody: { values: [[monthlySalary]] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${TABS.POSITION_RATES}!A:B`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [[position, monthlySalary]] },
    });
  }
  return { position, monthlySalary: Number(monthlySalary) };
}

async function deletePositionRate(position) {
  await ensureTab(TABS.POSITION_RATES, POSITION_HEADERS);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TABS.POSITION_RATES}!A:B`,
  });
  const rows = res.data.values || [];
  let found = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || "").trim() === position) {
      found = i + 1;
      break;
    }
  }
  if (found < 0) return;
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const tab = meta.data.sheets.find((s) => s.properties.title === TABS.POSITION_RATES);
  const sheetId = tab.properties.sheetId;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: found - 1, endIndex: found } } }],
    },
  });
}

function mapCommissionTierRow(r) {
  return {
    yearMonth: r.year_month,
    minSales: parseInt(r.min_sales, 10) || 0,
    bonusAmount: parseFloat(r.bonus_amount) || 0,
    label: r.label || "",
  };
}

async function readCommissionTiers(yearMonth) {
  await ensureTab(TABS.COMMISSION_TIERS, COMMISSION_TIER_HEADERS);
  const rows = await readTab(TABS.COMMISSION_TIERS);
  return rows
    .filter((r) => r.year_month === yearMonth && r.min_sales != null && r.min_sales !== "")
    .map(mapCommissionTierRow)
    .sort((a, b) => a.minSales - b.minSales);
}

async function readAllCommissionTiers() {
  await ensureTab(TABS.COMMISSION_TIERS, COMMISSION_TIER_HEADERS);
  const rows = await readTab(TABS.COMMISSION_TIERS);
  return rows
    .filter((r) => r.year_month && r.min_sales != null && r.min_sales !== "")
    .map(mapCommissionTierRow);
}

async function writeCommissionTiersForMonth(yearMonth, tiers) {
  await ensureTab(TABS.COMMISSION_TIERS, COMMISSION_TIER_HEADERS);
  const rows = await readTab(TABS.COMMISSION_TIERS);
  const header = rows[0] || COMMISSION_TIER_HEADERS;
  const keep = [header];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    if (row[0] !== yearMonth) keep.push(row);
  }
  for (const t of tiers) {
    keep.push([
      yearMonth,
      t.minSales,
      t.bonusAmount,
      t.label || `${t.minSales}+ sales`,
    ]);
  }
  const a = await auth();
  const sheets = getSheetsClient(a);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TABS.COMMISSION_TIERS}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: keep },
  });
  return tiers.map((t) => ({ ...t, yearMonth }));
}

function mapLoanRow(r) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    totalAmount: parseFloat(r.total_amount) || 0,
    installmentAmount: parseFloat(r.installment_amount) || 0,
    installmentsCount: parseInt(r.installments_count, 10) || 0,
    installmentsPaid: parseInt(r.installments_paid, 10) || 0,
    startYearMonth: r.start_year_month || "",
    skipCurrentMonth:
      r.skip_current_month === true || String(r.skip_current_month || "").toUpperCase() === "TRUE",
    createdYearMonth: r.created_year_month || "",
    notes: r.notes || "",
    status: r.status || "active",
    createdBy: r.created_by || "",
    createdAt: r.created_at || "",
  };
}

async function readAllEmployeeLoans() {
  await ensureTab(TABS.EMPLOYEE_LOANS, LOAN_HEADERS);
  const rows = await readTab(TABS.EMPLOYEE_LOANS);
  return rows.filter((r) => r.id).map(mapLoanRow);
}

async function readEmployeeLoans(employeeId) {
  const all = await readAllEmployeeLoans();
  if (!employeeId) return all;
  return all.filter((l) => l.employeeId === employeeId);
}

async function appendEmployeeLoan(loan, createdBy = "system") {
  const { computeStartYearMonth } = require("./loans");
  await ensureTab(TABS.EMPLOYEE_LOANS, LOAN_HEADERS);
  const now = new Date().toISOString();
  const id = loan.id || `L-${Date.now()}`;
  const createdYearMonth = loan.createdYearMonth || new Date().toISOString().slice(0, 7);
  const skipCurrentMonth = loan.skipCurrentMonth === true;
  const startYearMonth =
    loan.startYearMonth || computeStartYearMonth(createdYearMonth, skipCurrentMonth);
  const row = {
    id,
    employeeId: loan.employeeId,
    totalAmount: Number(loan.totalAmount) || 0,
    installmentAmount: Number(loan.installmentAmount) || 0,
    installmentsCount: parseInt(loan.installmentsCount, 10) || 1,
    installmentsPaid: 0,
    startYearMonth,
    skipCurrentMonth,
    createdYearMonth,
    notes: loan.notes || "",
    status: "active",
    createdBy,
    createdAt: now,
  };
  const a = await auth();
  const sheets = getSheetsClient(a);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${TABS.EMPLOYEE_LOANS}!A:M`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [
        [
          row.id,
          row.employeeId,
          row.totalAmount,
          row.installmentAmount,
          row.installmentsCount,
          0,
          row.startYearMonth,
          skipCurrentMonth ? "TRUE" : "FALSE",
          row.createdYearMonth,
          row.notes,
          row.status,
          createdBy,
          now,
        ],
      ],
    },
  });
  return row;
}

async function updateEmployeeLoan(loan) {
  await ensureTab(TABS.EMPLOYEE_LOANS, LOAN_HEADERS);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TABS.EMPLOYEE_LOANS}!A:M`,
  });
  const rows = res.data.values || [];
  let found = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || "").trim() === loan.id) {
      found = i + 1;
      break;
    }
  }
  if (found < 0) throw new Error(`Loan ${loan.id} not found`);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TABS.EMPLOYEE_LOANS}!A${found}:M${found}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [
        [
          loan.id,
          loan.employeeId,
          loan.totalAmount,
          loan.installmentAmount,
          loan.installmentsCount,
          loan.installmentsPaid ?? 0,
          loan.startYearMonth,
          loan.skipCurrentMonth ? "TRUE" : "FALSE",
          loan.createdYearMonth,
          loan.notes || "",
          loan.status || "active",
          loan.createdBy || "",
          loan.createdAt || "",
        ],
      ],
    },
  });
  return loan;
}

async function deleteEmployeeLoan(id) {
  const payments = await readAllLoanPayments();
  if (payments.some((p) => p.loanId === id)) {
    throw new Error("Cannot delete a loan with recorded payroll payments. Cancel it instead.");
  }
  await ensureTab(TABS.EMPLOYEE_LOANS, LOAN_HEADERS);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TABS.EMPLOYEE_LOANS}!A:M`,
  });
  const rows = res.data.values || [];
  const keep = [rows[0] || LOAN_HEADERS];
  let removed = false;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (String(row[0] || "").trim() === id) {
      removed = true;
      continue;
    }
    keep.push(row);
  }
  if (!removed) throw new Error(`Loan ${id} not found`);
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${TABS.EMPLOYEE_LOANS}!A:Z`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TABS.EMPLOYEE_LOANS}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: keep },
  });
  return true;
}

function mapLoanPaymentRow(r) {
  return {
    loanId: r.loan_id,
    employeeId: r.employee_id,
    yearMonth: r.year_month,
    amount: parseFloat(r.amount) || 0,
    installmentNumber: parseInt(r.installment_number, 10) || 0,
    recordedBy: r.recorded_by || "",
    recordedAt: r.recorded_at || "",
  };
}

async function readAllLoanPayments() {
  await ensureTab(TABS.LOAN_PAYMENTS, LOAN_PAYMENT_HEADERS);
  const rows = await readTab(TABS.LOAN_PAYMENTS);
  return rows.filter((r) => r.loan_id).map(mapLoanPaymentRow);
}

async function readLoanPayments(yearMonth) {
  const all = await readAllLoanPayments();
  if (!yearMonth) return all;
  return all.filter((p) => p.yearMonth === yearMonth);
}

async function appendLoanPayment(payment, recordedBy = "system") {
  await ensureTab(TABS.LOAN_PAYMENTS, LOAN_PAYMENT_HEADERS);
  const now = new Date().toISOString();
  const row = {
    loanId: payment.loanId,
    employeeId: payment.employeeId,
    yearMonth: payment.yearMonth,
    amount: Number(payment.amount) || 0,
    installmentNumber: payment.installmentNumber || 0,
    recordedBy,
    recordedAt: now,
  };
  const a = await auth();
  const sheets = getSheetsClient(a);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${TABS.LOAN_PAYMENTS}!A:G`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [
        [
          row.loanId,
          row.employeeId,
          row.yearMonth,
          row.amount,
          row.installmentNumber,
          recordedBy,
          now,
        ],
      ],
    },
  });
  return row;
}

function mapPayrollSplitRow(r) {
  return {
    id: String(r.id || "").trim(),
    employeeId: String(r.employee_id || "").trim(),
    yearMonth: String(r.year_month || "").trim(),
    amount: parseFloat(r.amount) || 0,
    splitKind: r.split_kind || "payment",
    status: r.status || "pending",
    deferToMonth: r.defer_to_month || "",
    notes: r.notes || "",
    createdBy: r.created_by || "",
    createdAt: r.created_at || "",
  };
}

function splitToRowValues(split, createdBy) {
  const now = new Date().toISOString();
  return [
    split.id,
    split.employeeId,
    split.yearMonth,
    split.amount,
    split.splitKind || "payment",
    split.status || "pending",
    split.deferToMonth || "",
    split.notes || "",
    createdBy || split.createdBy || "system",
    split.createdAt || now,
  ];
}

async function readAllPayrollSplits() {
  await ensureTab(TABS.PAYROLL_SPLITS, PAYROLL_SPLIT_HEADERS);
  const rows = await readTab(TABS.PAYROLL_SPLITS);
  return rows.filter((r) => r.id).map(mapPayrollSplitRow);
}

async function readPayrollSplits({ employeeId, yearMonth } = {}) {
  let all = await readAllPayrollSplits();
  if (employeeId) all = all.filter((s) => s.employeeId === employeeId);
  if (yearMonth) all = all.filter((s) => s.yearMonth === yearMonth);
  return all;
}

async function appendPayrollSplit(split, createdBy = "system") {
  const { nextSplitId } = require("./payroll-splits");
  await ensureTab(TABS.PAYROLL_SPLITS, PAYROLL_SPLIT_HEADERS);
  const row = {
    id: split.id || nextSplitId(),
    employeeId: split.employeeId,
    yearMonth: split.yearMonth,
    amount: Number(split.amount) || 0,
    splitKind: split.splitKind || "payment",
    status: split.status || "pending",
    deferToMonth: split.deferToMonth || "",
    notes: split.notes || "",
    createdBy,
    createdAt: new Date().toISOString(),
  };
  const a = await auth();
  const sheets = getSheetsClient(a);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${TABS.PAYROLL_SPLITS}!A:J`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [splitToRowValues(row, createdBy)] },
  });
  return row;
}

async function updatePayrollSplit(split, updatedBy = "system") {
  const existing = (await readAllPayrollSplits()).find((s) => s.id === split.id);
  if (!existing) throw new Error(`Payroll split ${split.id} not found`);
  const merged = {
    ...existing,
    ...split,
    id: existing.id,
    employeeId: existing.employeeId,
    yearMonth: existing.yearMonth,
    createdBy: existing.createdBy,
    createdAt: existing.createdAt,
  };
  await ensureTab(TABS.PAYROLL_SPLITS, PAYROLL_SPLIT_HEADERS);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TABS.PAYROLL_SPLITS}!A:J`,
  });
  const rows = res.data.values || [];
  let found = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || "").trim() === split.id) {
      found = i + 1;
      break;
    }
  }
  if (found < 0) throw new Error(`Payroll split ${split.id} not found in sheet`);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TABS.PAYROLL_SPLITS}!A${found}:J${found}`,
    valueInputOption: "RAW",
    requestBody: { values: [splitToRowValues(merged, updatedBy)] },
  });
  return merged;
}

async function deletePayrollSplit(id) {
  await ensureTab(TABS.PAYROLL_SPLITS, PAYROLL_SPLIT_HEADERS);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TABS.PAYROLL_SPLITS}!A:J`,
  });
  const rows = res.data.values || [];
  const keep = [rows[0] || PAYROLL_SPLIT_HEADERS];
  let removed = false;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (String(row[0] || "").trim() === id) {
      removed = true;
      continue;
    }
    keep.push(row);
  }
  if (!removed) throw new Error(`Payroll split ${id} not found`);
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${TABS.PAYROLL_SPLITS}!A:Z`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TABS.PAYROLL_SPLITS}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: keep },
  });
  return true;
}

async function bulkSetTransportEligibleForMonth(yearMonth, eligible, updatedBy = "script") {
  const { isPayrollEligible } = require("./attendance");
  const { buildDefaultProfile } = require("./month-profile");
  const employees = (await readEmployees()).filter(isPayrollEligible);
  const employeeIds = new Set(employees.map((e) => e.id));
  const flag = eligible ? "TRUE" : "FALSE";
  const now = new Date().toISOString();

  await ensureTab(TABS.PAYROLL_ADJUSTMENTS, PAYROLL_ADJ_HEADERS);
  const a = await auth();
  const sheets = getSheetsClient(a);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TABS.PAYROLL_ADJUSTMENTS}!${PAYROLL_ADJ_RANGE}`,
  });
  const rows = res.data.values || [];
  const seen = new Set();
  const batchData = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[1] === yearMonth && employeeIds.has(String(row[0] || "").trim())) {
      const rowNum = i + 1;
      batchData.push({ range: `${TABS.PAYROLL_ADJUSTMENTS}!O${rowNum}`, values: [[flag]] });
      batchData.push({ range: `${TABS.PAYROLL_ADJUSTMENTS}!R${rowNum}:S${rowNum}`, values: [[updatedBy, now]] });
      seen.add(String(row[0]).trim());
    }
  }

  if (batchData.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { valueInputOption: "RAW", data: batchData },
    });
  }

  const newRows = [];
  for (const emp of employees) {
    if (seen.has(emp.id)) continue;
    const profile = buildDefaultProfile(emp, yearMonth);
    newRows.push(
      profileToRowValues({ ...profile, transportEligible: eligible }, updatedBy)
    );
  }

  if (newRows.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${TABS.PAYROLL_ADJUSTMENTS}!${PAYROLL_ADJ_RANGE}`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: newRows },
    });
  }

  return seen.size + newRows.length;
}

module.exports = {
  SHEET_ID,
  TABS,
  EMPLOYEE_HEADERS,
  EMPLOYEE_STATUSES,
  readEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  writeEmployeeDatabase,
  writePositionRates,
  readAttendanceEvents,
  readAllAttendanceEvents,
  clearAttendanceMonth,
  batchWriteAttendance,
  readUsers,
  readConfig,
  saveConfigKey,
  writeFullConfig,
  readPositionRates,
  readBonusEvents,
  readAllBonusEvents,
  readDeductionEvents,
  readAllDeductionEvents,
  upsertBonusEvent,
  upsertDeductionEvent,
  deleteBonusEvent,
  deleteDeductionEvent,
  batchWriteBonuses,
  batchWriteDeductions,
  upsertAttendanceRow,
  batchUpsertAttendance,
  verifySheetAccess,
  readAllPayrollAdjustments,
  readPayrollAdjustments,
  upsertPayrollAdjustment,
  bulkSetTransportEligibleForMonth,
  readAllPayrollSplits,
  readPayrollSplits,
  appendPayrollSplit,
  updatePayrollSplit,
  deletePayrollSplit,
  batchWritePayrollAdjustments,
  clearPayrollAdjustmentsMonth,
  readCommissionTypes,
  writeCommissionTypes,
  readEmployeeDocuments,
  readAllEmployeeDocuments,
  appendEmployeeDocument,
  readEmployeeWarnings,
  readAllEmployeeWarnings,
  appendEmployeeWarning,
  upsertPositionRate,
  deletePositionRate,
  readCommissionTiers,
  readAllCommissionTiers,
  writeCommissionTiersForMonth,
  readEmployeeLoans,
  readAllEmployeeLoans,
  appendEmployeeLoan,
  updateEmployeeLoan,
  deleteEmployeeLoan,
  readLoanPayments,
  readAllLoanPayments,
  appendLoanPayment,
  WARNING_HEADERS,
  PAYROLL_ADJ_HEADERS,
  COMMISSION_TYPE_HEADERS,
  COMMISSION_TIER_HEADERS,
  LOAN_HEADERS,
  LOAN_PAYMENT_HEADERS,
  DOCUMENT_HEADERS,
  mapEmployeeRow,
  ensureTab: ensureTab,
  ensureTabPublic: ensureTab,
  readTabPublic: readTab,
  getAuthClient: auth,
  getSheetsApi: getSheetsClient,
};

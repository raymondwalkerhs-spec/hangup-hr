/**
 * Custom saved reports (RPT-03).
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");
const { summarizeEmployeeMonth } = require("./attendance");
const { buildPayroll } = require("./payroll");

function db() {
  return getSupabaseAdmin();
}

function requireSupabase() {
  if (!useSupabase()) throw new Error("Feature requires DATA_BACKEND=supabase");
}

const COLUMN_SETS = {
  employees: [
    { id: "id", label: "ID" },
    { id: "american_name", label: "Name" },
    { id: "unit", label: "Unit" },
    { id: "team", label: "Team" },
    { id: "status", label: "Status" },
    { id: "employment_date", label: "Employment date" },
    { id: "probation_end_date", label: "Probation end" },
    { id: "contract_end_date", label: "Contract end" },
    { id: "fp_number", label: "FP number" },
  ],
  attendance: [
    { id: "employeeId", label: "Employee ID" },
    { id: "name", label: "Name" },
    { id: "unit", label: "Unit" },
    { id: "workingDays", label: "Working days" },
    { id: "lateness", label: "Lateness" },
    { id: "halfDays", label: "Half days" },
    { id: "nsnc", label: "NSNC" },
  ],
  payroll: [
    { id: "employeeId", label: "Employee ID" },
    { id: "name", label: "Name" },
    { id: "unit", label: "Unit" },
    { id: "basicSalary", label: "Basic" },
    { id: "netSalary", label: "Net" },
    { id: "latenessDeductions", label: "Lateness ded." },
  ],
};

function mapSavedReport(r) {
  return {
    id: r.id,
    name: r.name,
    reportType: r.report_type,
    filters: r.filters || {},
    columns: r.columns || [],
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function readSavedReports(createdBy) {
  requireSupabase();
  let q = db().from("saved_reports").select("*").order("updated_at", { ascending: false });
  if (createdBy) q = q.eq("created_by", createdBy);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map(mapSavedReport);
}

async function getSavedReport(id) {
  requireSupabase();
  const { data, error } = await db().from("saved_reports").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapSavedReport(data) : null;
}

async function upsertSavedReport(payload, actor) {
  requireSupabase();
  const row = {
    name: payload.name,
    report_type: payload.reportType,
    filters: payload.filters || {},
    columns: payload.columns || [],
    created_by: actor,
    updated_at: new Date().toISOString(),
  };
  if (payload.id) {
    const { data, error } = await db().from("saved_reports").update(row).eq("id", payload.id).select().single();
    if (error) throw new Error(error.message);
    return mapSavedReport(data);
  }
  const { data, error } = await db().from("saved_reports").insert(row).select().single();
  if (error) throw new Error(error.message);
  return mapSavedReport(data);
}

async function deleteSavedReport(id) {
  requireSupabase();
  const { error } = await db().from("saved_reports").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

function applyEmployeeFilters(employees, filters = {}) {
  let rows = employees;
  if (filters.unit) rows = rows.filter((e) => e.unit === filters.unit);
  if (filters.team) rows = rows.filter((e) => e.team === filters.team);
  if (filters.status) rows = rows.filter((e) => e.status === filters.status);
  if (filters.employeeIds?.length) {
    const set = new Set(filters.employeeIds);
    rows = rows.filter((e) => set.has(e.id));
  }
  return rows;
}

function escapeCsv(v) {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(columns, rows) {
  const header = columns.map((c) => escapeCsv(c.label || c.id)).join(",");
  const body = rows.map((r) => columns.map((c) => escapeCsv(r[c.id])).join(",")).join("\n");
  return `${header}\n${body}`;
}

async function runReport(report, store, month) {
  const filters = report.filters || {};
  const cols = report.columns?.length
    ? report.columns
    : COLUMN_SETS[report.reportType] || [];

  if (report.reportType === "employees") {
    const employees = applyEmployeeFilters(store.getEmployees(), filters);
    const rows = employees.map((e) => {
      const row = {};
      for (const c of cols) row[c.id] = e[c.id] ?? "";
      return row;
    });
    return rowsToCsv(cols, rows);
  }

  const ym = month || filters.month || new Date().toISOString().slice(0, 7);
  const config = store.getConfig();
  let employees = store.getEmployeesForMonth(ym, { hideOut: filters.hideOut !== false });
  employees = applyEmployeeFilters(employees, filters);

  if (report.reportType === "attendance") {
    const rows = employees.map((emp) => {
      const recs = store.getAttendanceEvents(ym).filter((r) => r.employeeId === emp.id);
      const s = summarizeEmployeeMonth(emp, recs, config);
      return {
        employeeId: emp.id,
        name: s.name,
        unit: emp.unit,
        workingDays: s.workingDays,
        lateness: s.lateness,
        halfDays: s.halfDays,
        nsnc: s.nsnc,
      };
    });
    return rowsToCsv(cols, rows);
  }

  if (report.reportType === "payroll") {
    const summaries = employees.map((emp) => {
      const recs = store.getAttendanceEvents(ym).filter((r) => r.employeeId === emp.id);
      return summarizeEmployeeMonth(emp, recs, config);
    });
    const payroll = buildPayroll(
      employees,
      summaries,
      ym,
      config,
      store.getPositionRates(),
      store.getBonusEvents(ym),
      store.getDeductionEvents(ym),
      store.getPayrollAdjustments(ym),
      new Map(),
      store.getCommissionTiers(ym),
      store.getEmployeeLoans(),
      store.getLoanPayments()
    );
    const rows = payroll.map((p) => ({
      employeeId: p.employeeId,
      name: p.name,
      unit: p.unit,
      basicSalary: p.basicSalary,
      netSalary: p.netSalary,
      latenessDeductions: p.latenessDeductions,
    }));
    return rowsToCsv(cols, rows);
  }

  throw new Error(`Unknown report type: ${report.reportType}`);
}

module.exports = {
  COLUMN_SETS,
  readSavedReports,
  getSavedReport,
  upsertSavedReport,
  deleteSavedReport,
  runReport,
};

#!/usr/bin/env node
/**
 * One-time import: Google Sheets → Supabase Postgres.
 * Run BEFORE setting DATA_BACKEND=supabase (reads sheets directly).
 *
 * Usage: node scripts/migrate-sheets-to-supabase.js
 */
require("dotenv").config();
process.env.DATA_BACKEND = "sheets";

const bcrypt = require("bcrypt");
const sheets = require("./lib/sheets");
const { fetchAuthUsers } = require("./lib/auth-sheet");
const { fetchVersionPolicy } = require("../lib/version-sheet");
const { getSupabaseAdmin } = require("../lib/supabase-client");
const m = require("../lib/supabase/mappers");

const CHUNK = 400;

function db() {
  return getSupabaseAdmin();
}

async function clearTable(name) {
  const { error } = await db().from(name).delete().neq("id", "___none___").or(
    name === "employees"
      ? "id.neq.___none___"
      : name === "app_config"
        ? "key.neq.___none___"
        : "id.neq.00000000-0000-0000-0000-000000000000"
  );
  // Simpler: use truncate via delete all — for tables with text PK use different approach
}

async function deleteAll(table, idCol = "id") {
  const { data } = await db().from(table).select(idCol).limit(10000);
  if (!data?.length) return;
  const ids = data.map((r) => r[idCol]);
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { error } = await db().from(table).delete().in(idCol, slice);
    if (error) throw new Error(`clear ${table}: ${error.message}`);
  }
}

async function insertChunk(table, rows) {
  if (!rows.length) return 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await db().from(table).upsert(slice, { onConflict: getConflict(table) });
    if (error) throw new Error(`${table} insert: ${error.message}`);
  }
  return rows.length;
}

function getConflict(table) {
  const map = {
    employees: "id",
    position_rates: "position",
    app_config: "key",
    attendance_events: "employee_id,date",
    bonus_events: "employee_id,date,type",
    deduction_events: "employee_id,date,type",
    payroll_adjustments: "employee_id,year_month",
    commission_types: "name",
    commission_tiers: "year_month,min_sales",
    employee_loans: "id",
    payroll_splits: "id",
    employee_warnings: "id",
    app_users: "username",
    app_versions: "version",
  };
  return map[table];
}

async function migrate() {
  console.log("Reading from Google Sheets…\n");

  const [
    employees,
    config,
    rates,
    attendance,
    bonuses,
    deductions,
    adjustments,
    commissionTypes,
    documents,
    warnings,
    tiers,
    loans,
    loanPayments,
    splits,
  ] = await Promise.all([
    sheets.readEmployees(),
    sheets.readConfig(),
    sheets.readPositionRates(),
    sheets.readAllAttendanceEvents(),
    sheets.readAllBonusEvents(),
    sheets.readAllDeductionEvents(),
    sheets.readAllPayrollAdjustments(),
    sheets.readCommissionTypes(),
    sheets.readAllEmployeeDocuments(),
    sheets.readAllEmployeeWarnings(),
    sheets.readAllCommissionTiers(),
    sheets.readAllEmployeeLoans(),
    sheets.readAllLoanPayments(),
    sheets.readAllPayrollSplits(),
  ]);

  const authUsers = await fetchAuthUsers();
  let versionPolicy = null;
  try {
    versionPolicy = await fetchVersionPolicy();
  } catch (_) {}

  const empIds = new Set(employees.map((e) => e.id));
  console.log(`Employees: ${employees.length}`);
  console.log(`Attendance: ${attendance.length}`);
  console.log(`Auth users: ${authUsers.length}`);

  const configRows = Object.entries({
    defaultWeekendDays: config.defaultWeekendDays,
    weekendDayNames: config.weekendDayNames,
    latenessRules: config.latenessRules,
    workingDaysByMonth: config.workingDaysByMonth,
    hideOutEmployees: config.hideOutEmployees,
    transportAllowanceMonthly: config.transportAllowanceMonthly,
  }).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
    updated_at: new Date().toISOString(),
  }));

  const filterEmp = (id) => empIds.has(id);

  await insertChunk(
    "employees",
    employees.map((e) => m.employeeToDb(e))
  );
  console.log("✓ employees");

  await insertChunk(
    "position_rates",
    rates.map((r) => ({
      position: r.position,
      monthly_salary: r.monthlySalary,
      updated_at: new Date().toISOString(),
    }))
  );
  console.log("✓ position_rates");

  await insertChunk("app_config", configRows);
  console.log("✓ app_config");

  await insertChunk(
    "commission_types",
    commissionTypes.map((t) => ({
      name: t.name,
      rate_egp: t.rateEgp,
      description: t.description,
      active: t.active !== false,
    }))
  );
  console.log("✓ commission_types");

  await insertChunk(
    "attendance_events",
    attendance
      .filter((r) => filterEmp(r.employeeId))
      .map((r) => m.attendanceToDb(r, r.updatedBy || "migration"))
  );
  console.log("✓ attendance_events");

  await insertChunk(
    "bonus_events",
    bonuses.filter((r) => filterEmp(r.employeeId)).map((r) => m.bonusToDb(r, "migration"))
  );
  console.log("✓ bonus_events");

  await insertChunk(
    "deduction_events",
    deductions.filter((r) => filterEmp(r.employeeId)).map((r) => m.deductionToDb(r, "migration"))
  );
  console.log("✓ deduction_events");

  await insertChunk(
    "payroll_adjustments",
    adjustments
      .filter((r) => filterEmp(r.employeeId))
      .map((r) => m.payrollAdjustmentToDb(r, "migration"))
  );
  console.log("✓ payroll_adjustments");

  await insertChunk(
    "commission_tiers",
    tiers.map((t) => ({
      year_month: t.yearMonth,
      min_sales: t.minSales,
      bonus_amount: t.bonusAmount,
      label: t.label || "",
    }))
  );
  console.log("✓ commission_tiers");

  await insertChunk(
    "employee_loans",
    loans.filter((l) => filterEmp(l.employeeId)).map((l) => ({
      id: l.id,
      employee_id: l.employeeId,
      total_amount: l.totalAmount,
      installment_amount: l.installmentAmount,
      installments_count: l.installmentsCount,
      installments_paid: l.installmentsPaid,
      start_year_month: l.startYearMonth,
      skip_current_month: m.boolToDb(l.skipCurrentMonth),
      created_year_month: l.createdYearMonth,
      notes: l.notes,
      status: l.status,
      created_by: l.createdBy,
      created_at: l.createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }))
  );
  console.log("✓ employee_loans");

  const loanIds = new Set(loans.map((l) => l.id));
  await insertChunk(
    "loan_payments",
    loanPayments
      .filter((p) => filterEmp(p.employeeId) && loanIds.has(p.loanId))
      .map((p) => ({
        loan_id: p.loanId,
        employee_id: p.employeeId,
        year_month: p.yearMonth,
        amount: p.amount,
        installment_number: p.installmentNumber,
        recorded_by: p.recordedBy,
        recorded_at: p.recordedAt || new Date().toISOString(),
      }))
  );
  console.log("✓ loan_payments");

  await insertChunk(
    "payroll_splits",
    splits.filter((s) => filterEmp(s.employeeId)).map((s) => ({
      id: s.id,
      employee_id: s.employeeId,
      year_month: s.yearMonth,
      amount: s.amount,
      split_kind: s.splitKind,
      status: s.status,
      defer_to_month: s.deferToMonth,
      notes: s.notes,
      created_by: s.createdBy,
      created_at: s.createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }))
  );
  console.log("✓ payroll_splits");

  await insertChunk(
    "employee_documents",
    documents.filter((d) => filterEmp(d.employeeId)).map((d) => ({
      employee_id: d.employeeId,
      doc_type: d.docType,
      file_name: d.fileName,
      storage_path: d.driveFileId || "",
      public_url: d.driveLink || "",
      drive_file_id: d.driveFileId || "",
      drive_link: d.driveLink || "",
      uploaded_at: d.uploadedAt || new Date().toISOString(),
      expiry: d.expiry || "",
      notes: d.notes || "",
      updated_by: "migration",
    }))
  );
  console.log("✓ employee_documents (metadata — Drive file IDs preserved)");

  await insertChunk(
    "employee_warnings",
    warnings.filter((w) => filterEmp(w.employeeId)).map((w) => ({
      id: w.id,
      employee_id: w.employeeId,
      date: w.date,
      type: w.type,
      title: w.title,
      content: w.content,
      severity: w.severity,
      created_by: w.createdBy,
      created_at: w.createdAt || new Date().toISOString(),
    }))
  );
  console.log("✓ employee_warnings");

  const userRows = [];
  for (const u of authUsers) {
    if (!u.user) continue;
    const hash = await bcrypt.hash(u.password, 10);
    userRows.push({
      username: u.user,
      password_hash: hash,
      status: (u.status || "active").toLowerCase(),
      role: u.role || "",
      updated_at: new Date().toISOString(),
    });
  }
  await insertChunk("app_users", userRows);
  console.log("✓ app_users (passwords hashed with bcrypt)");

  if (versionPolicy?.entries?.length) {
    await insertChunk(
      "app_versions",
      versionPolicy.entries.map((e) => ({
        version: e.version,
        release_date: e.releaseDate || null,
        release_type: e.releaseType || "minor",
        min_compatible_version: e.minCompatibleVersion || e.version,
        is_current: e.isCurrent === true,
        notes: e.notes || "",
      }))
    );
    console.log("✓ app_versions");
  }

  try {
    const logRows = await sheets.readTabPublic("Change_Log");
    if (logRows?.length) {
      await insertChunk(
        "change_log",
        logRows.slice(-500).map((r) => ({
          timestamp: r.timestamp || new Date().toISOString(),
          username: r.username,
          entity: r.entity,
          entity_id: r.entity_id,
          action: r.action,
          field: r.field,
          old_value: r.old_value,
          new_value: r.new_value,
          summary: r.summary,
        }))
      );
      console.log("✓ change_log (last 500 entries)");
    }
  } catch (_) {
    console.log("— change_log skipped");
  }

  console.log("\nMigration complete.");
  console.log("Set DATA_BACKEND=supabase in .env and restart the app.");
}

migrate().catch((err) => {
  console.error("\nMigration failed:", err.message);
  process.exit(1);
});

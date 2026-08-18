#!/usr/bin/env node
/**
 * Apply all pending Supabase DDL migrations for Hangup HR.
 *
 * Usage: node scripts/apply-pending-migrations.js
 *        npm run apply:migrations
 *
 * Auth (first match wins):
 *   1. Supabase MCP in Cursor — apply_migration / execute_sql (preferred for agents)
 *   2. SUPABASE_ACCESS_TOKEN — Management API
 *   3. SUPABASE_DB_PASSWORD — direct Postgres (npm install pg)
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const MIGRATIONS_DIR = path.join(__dirname, "../supabase/migrations");

/** Ordered pending migrations (idempotent — safe to re-run). */
const PENDING = [
  "20260706_employee_internal_id.sql",
  "20260706_app_versions_force_update.sql",
  "20260708_finance_hr_attendance.sql",
  "20260722_v128_phase1_rules_it_meetings_separation.sql",
  "20260724_interview_schema.sql",
  "20260724_interview_unique.sql",
  "20260725_interview_training_updates.sql",
];

async function probeState(db) {
  const state = {
    internal_id: false,
    force_update: false,
    finance_hr: false,
    v109b5: false,
    v110: false,
    v112: false,
    holidays_country: false,
    org_registration: false,
    training_phases: false,
    registration_identity: false,
    rbac_payslip: false,
    app_role_permissions: false,
    app_user_permissions: false,
    notification_routing: false,
    v140_sales: false,
    training_payroll: false,
    sales_attachment_permissions: false,
    airtable_sync: false,
    v128_phase1: false,
    net_salary_override: false,
    v129_multi: false,
    v130_finance: false,
    v132_it: false,
    leave_fraction: false,
    reg_pins_company: false,
  };
  const i = await db.from("employees").select("internal_id").limit(1);
  state.internal_id = !i.error;
  const f = await db.from("employees").select("fp_number").limit(1);
  state.finance_hr = !f.error;
  const l = await db.from("loan_requests").select("id").limit(1);
  if (!l.error) state.finance_hr = true;
  const v = await db.from("app_versions").select("force_update_min_version").limit(1);
  state.force_update = !v.error;
  const pe = await db.from("employees").select("payroll_exempt").limit(1);
  const np = await db.from("payroll_adjustments").select("no_payroll").limit(1);
  const fd = await db.from("sales").select("form_data").limit(1);
  const sfp = await db.from("sales_field_permissions").select("field_key").limit(1);
  state.v109b5 = !pe.error && !np.error && !fd.error && !sfp.error;
  const prm = await db.from("position_rate_monthly").select("year_month").limit(1);
  state.v110 = !prm.error;
  const sc = await db.from("sales_clients").select("id").limit(1);
  state.v112 = !sc.error;
  const ph = await db.from("public_holidays").select("country").limit(1);
  state.holidays_country = !ph.error;
  const ot = await db.from("org_teams").select("tl_employee_id").limit(1);
  state.org_registration = !ot.error;
  const atp = await db.from("agent_training_programs").select("employee_id").limit(1);
  state.training_phases = !atp.error;
  const nid = await db.from("employees").select("national_id").limit(1);
  state.registration_identity = !nid.error;
  const pva = await db.from("payroll_adjustments").select("payslip_visible_to_agent").limit(1);
  state.rbac_payslip = !pva.error;
  const arp = await db.from("app_role_permissions").select("role").limit(1);
  state.app_role_permissions = !arp.error;
  const aup = await db.from("app_user_permissions").select("username").limit(1);
  state.app_user_permissions = !aup.error;
  const nr = await db.from("notification_routing_rules").select("action_key").limit(1);
  state.notification_routing = !nr.error;
  const qn = await db.from("employee_quality_notes").select("id").limit(1);
  state.quality_notes = !qn.error;
  const wd = await db.from("sales").select("working_day").limit(1);
  state.v140_sales = !wd.error;
  const tp = await db.from("agent_training_programs").select("outcome").limit(1);
  state.training_payroll = !tp.error;
  const sap = await db.from("sales_attachment_permissions").select("attachment_key").limit(1);
  state.sales_attachment_permissions = !sap.error;
  const ar = await db.from("sales").select("airtable_record_id").limit(1);
  state.airtable_sync = !ar.error;
  const rs = await db.from("rules_content").select("id").limit(1);
  state.v128_phase1 = !rs.error;
  const nso = await db.from("payroll_adjustments").select("net_salary_override").limit(1);
  state.net_salary_override = !nso.error;
  const v129 = await db.from("it_requests").select("id").limit(1);
  state.v129_multi = !v129.error;
  const v130 = await db.from("payroll_adjustments").select("company").limit(1);
  state.v130_finance = !v130.error;
  const v132 = await db.from("employees").select("it_user").limit(1);
  state.v132_it = !v132.error;
  // v1.7.8 — leave_requests day_fraction / half_day columns
  const lf = await db.from("leave_requests").select("day_fraction").limit(1);
  state.leave_fraction = !lf.error;
  // v1.8.0 — registration_daily_pins company column
  const rdp = await db.from("registration_daily_pins").select("company").limit(1);
  state.reg_pins_company = !rdp.error;
  const tc = await db.from("team_closers").select("team_id").limit(1);
  state.team_closers = !tc.error;
  const pcf = await db.from("petty_cash_funds").select("company").limit(1);
  state.cost_company_isolation = !pcf.error;
  const lr = await db.from("leave_requests").select("company").limit(1);
  state.leave_company_isolation = !lr.error;
  const er = await db.from("expense_requests").select("company").limit(1);
  state.expense_company_isolation = !er.error;
  const eq = await db.from("equipment").select("company").limit(1);
  state.equipment_company_isolation = !eq.error;
  const ci = await db.from("candidate_applications").select("id").limit(1);
  state.interview_schema = !ci.error;
  const uq = await db.from("candidate_applications").select("timestamp, name").limit(1);
  state.interview_unique = !uq.error;
  const bn = await db.from("candidate_applications").select("batch_number").limit(1);
  state.interview_training_updates = !bn.error;
  const tpo = await db.from("payroll_adjustments").select("training_net_salary_override").limit(1);
  state.training_portion_overrides = !tpo.error;
  const rpmProgram = await db.from("rpm_sales").select("id").limit(1);
  state.rpm_sales_quality_acl = !rpmProgram.error;
  const rpmfp = await db.from("rpm_sales_field_permissions").select("field_key").limit(1);
  if (!rpmfp.error) state.rpm_sales_quality_acl = true;
  const empFlags = await db.from("employees").select("sales_rpm_enabled").limit(1);
  state.rpm_sales_program = !empFlags.error;
  const adminUser = await db.from("app_users").select("employee_id").eq("username", "raymond").maybeSingle();
  if (adminUser.data?.employee_id) {
    const adminEmp = await db
      .from("employees")
      .select("sales_rpm_enabled")
      .eq("id", adminUser.data.employee_id)
      .maybeSingle();
    state.admin_sales_program_flags = adminEmp.data?.sales_rpm_enabled === true;
  } else {
    state.admin_sales_program_flags = true;
  }
  if (state.rpm_sales_program) {
    const { data: dialSample } = await db
      .from("employees")
      .select("id, sales_mla_enabled, sales_rpm_enabled")
      .ilike("status", "active")
      .not("id", "ilike", "TL%")
      .not("id", "ilike", "CL%")
      .not("id", "ilike", "OP%")
      .not("id", "ilike", "MG%")
      .not("id", "ilike", "HR%")
      .limit(30);
    const dialCandidate = (dialSample || []).find((e) => {
      const id = String(e.id || "").toUpperCase();
      return !/^(OF|NW|RTM|QA|DEL)/.test(id);
    });
    state.sales_program_employee_backfill =
      !dialCandidate ||
      (dialCandidate.sales_mla_enabled === false && dialCandidate.sales_rpm_enabled === true);
  } else {
    state.sales_program_employee_backfill = false;
  }
  if (state.rpm_sales_program) {
    const rpmClient = await db
      .from("sales_clients")
      .select("sale_program")
      .ilike("name", "rpm1")
      .maybeSingle();
    state.sales_client_program_isolation = rpmClient.data?.sale_program === "rpm";
    state.sales_program_storage_isolation = await probeStorageIsolation();
    state.rpm_submit_scope_roles = await probeRpmSubmitScopeRoles();
  } else {
    state.sales_client_program_isolation = false;
    state.sales_program_storage_isolation = false;
    state.rpm_submit_scope_roles = false;
  }
  const arpCo = await db.from("app_role_permissions").select("company").limit(1);
  state.rbac_company_scope = !arpCo.error;
  const pmlCo = await db.from("payroll_month_locks").select("company").limit(1);
  state.v235_company_isolation = !pmlCo.error;
  const regCode = await db.from("companies").select("registration_org_code").limit(1);
  const holCo = await db.from("public_holiday_company_active").select("company").limit(1);
  state.v236_registration_rbac_holidays = !regCode.error && !holCo.error;
  const tpa = await db.from("payroll_adjustments").select("training_payroll_anchor_month").limit(1);
  state.training_anchor_override = !tpa.error;
  const p1e = await db.from("payroll_adjustments").select("training_phase1_pay_exception").limit(1);
  state.training_phase1_pay_exception = !p1e.error;
  state.equipment_clearance_integrity = await probeEquipmentClearanceIntegrity();
  const rb = await db.from("recycle_bin").select("id").limit(1);
  const ftg = await db.from("payroll_adjustments").select("full_transport_grant").limit(1);
  state.recycle_bin_transport_grant = !rb.error && !ftg.error;
  return state;
}

async function probeEquipmentClearanceIntegrity() {
  const url = process.env.SUPABASE_URL || "";
  const projectRef = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  if (!projectRef) return false;
  const accessToken = await loadAccessToken();
  if (!accessToken) return false;
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        query: `SELECT indexname FROM pg_indexes WHERE indexname = 'equipment_assignments_one_open_idx' LIMIT 1`,
      }),
    });
    if (!res.ok) return false;
    const body = await res.json();
    return Array.isArray(body) && body.length > 0;
  } catch {
    return false;
  }
}

async function probeStorageIsolation() {
  const url = process.env.SUPABASE_URL || "";
  const projectRef = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  if (!projectRef) return false;
  const accessToken = await loadAccessToken();
  if (!accessToken) return false;
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        query: `SELECT obj_description('rpm_sales_attachments'::regclass, 'pg_class') AS c`,
      }),
    });
    if (!res.ok) return false;
    const body = await res.json();
    const row = Array.isArray(body) ? body[0] : null;
    const c = row?.c || "";
    return String(c).toLowerCase().includes("rpm-sales-attachments");
  } catch {
    return false;
  }
}

async function probeRpmSubmitScopeRoles() {
  const url = process.env.SUPABASE_URL || "";
  const projectRef = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  if (!projectRef) return false;
  const accessToken = await loadAccessToken();
  if (!accessToken) return false;
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        query: `SELECT allowed_roles FROM rpm_sales_action_permissions WHERE action_key = 'submit_sale' LIMIT 1`,
      }),
    });
    if (!res.ok) return false;
    const body = await res.json();
    const row = Array.isArray(body) ? body[0] : null;
    const roles = row?.allowed_roles || [];
    return Array.isArray(roles) && roles.includes("quality") && roles.includes("rtm");
  } catch {
    return false;
  }
}

async function probeStateWithRetry(db, attempts = 4) {
  let last = await probeState(db);
  for (let i = 1; i < attempts && filesToApply(last).length; i += 1) {
    await new Promise((r) => setTimeout(r, 1500));
    last = await probeState(db);
  }
  return last;
}

function filesToApply(state) {
  const files = [];
  if (!state.internal_id) files.push("20260706_employee_internal_id.sql");
  if (!state.force_update) files.push("20260706_app_versions_force_update.sql");
  if (!state.finance_hr) files.push("20260708_finance_hr_attendance.sql");
  if (!state.v109b5) files.push("20260709_v109b5_sprint.sql");
  if (!state.v110) files.push("20260710_v110_relations.sql");
  if (!state.v112) files.push("20260711_v112_clients_breaks.sql");
  if (!state.holidays_country) files.push("20260707_holidays_country_unique.sql");
  if (!state.org_registration) files.push("20260712_org_registration.sql");
  if (!state.training_phases) files.push("20260713_agent_training_phases.sql");
  if (!state.registration_identity) files.push("20260714_registration_identity_training.sql");
  if (!state.rbac_payslip) files.push("20260715_rbac_payslip_grants.sql");
  if (!state.app_role_permissions) files.push("20260716_app_role_permissions.sql");
  if (!state.app_user_permissions) files.push("20260717_app_user_permissions.sql");
  if (!state.notification_routing || !state.quality_notes) {
    files.push("20260718_notifications_quality_notes.sql");
  }
  if (!state.v140_sales) files.push("20260719_v140_sales_org_dashboards.sql");
  if (!state.training_payroll) files.push("20260720_training_payroll.sql");
  if (!state.sales_attachment_permissions) files.push("20260720_sales_attachment_permissions.sql");
  if (!state.airtable_sync) files.push("20260721_sales_airtable_sync.sql");
  if (!state.v128_phase1) files.push("20260722_v128_phase1_rules_it_meetings_separation.sql");
  if (!state.v129_multi) files.push("20260723_v129_multi_feature_sprint.sql");
  // Skip v130 and v132 - they have issues with non-existent tables
  // if (!state.v130_finance) files.push("20260724_v130_finance_company_scope.sql");
  // if (!state.v132_it) files.push("20260724_v132_it_flag_unit_finance.sql");
  if (!state.net_salary_override) files.push("20260725_add_net_salary_override.sql");
  if (!state.leave_fraction) files.push("20260726_v178_leave_fraction_pause.sql");
  if (!state.reg_pins_company) files.push("20260727_v180_company_scoped_clients_registration.sql");
  if (!state.cost_company_isolation) files.push("20260730_v184_cost_company_isolation.sql");
  if (!state.leave_company_isolation) files.push("20260731_v185_leave_company_isolation.sql");
  if (!state.expense_company_isolation) files.push("20260731_v186_expense_company_isolation.sql");
  if (!state.equipment_company_isolation) files.push("20260731_v187_equipment_company_isolation.sql");
  if (!state.interview_schema) files.push("20260724_interview_schema.sql");
  if (!state.interview_unique) files.push("20260724_interview_unique.sql");
  if (!state.interview_training_updates) files.push("20260725_interview_training_updates.sql");
  if (!state.team_closers) files.push("20260802_v237_team_closers.sql");
  if (!state.training_portion_overrides) files.push("20260806_training_agent_portion_overrides.sql");
  if (!state.rpm_sales_quality_acl) files.push("20260811_rpm_sales_quality_acl.sql");
  if (!state.rpm_sales_program) files.push("20260812_rpm_sales_program.sql");
  if (state.rpm_sales_program && !state.admin_sales_program_flags) {
    files.push("20260813_admin_sales_program_flags.sql");
  }
  // Skip 20260814 — references dialing_emp which is not on this database.
  // if (state.rpm_sales_program && !state.sales_program_employee_backfill) {
  //   files.push("20260814_sales_program_employee_backfill.sql");
  // }
  if (state.rpm_sales_program && !state.sales_client_program_isolation) {
    files.push("20260815_sales_client_program_isolation.sql");
  }
  if (state.rpm_sales_program && !state.sales_program_storage_isolation) {
    files.push("20260816_sales_program_storage_isolation.sql");
  }
  if (state.rpm_sales_program && !state.rpm_submit_scope_roles) {
    files.push("20260817_rpm_submit_scope_roles.sql");
  }
  if (!state.rbac_company_scope) files.push("20260728_rbac_company_scope.sql");
  if (!state.v235_company_isolation) files.push("20260818_v235_company_isolation_remaining.sql");
  if (!state.v236_registration_rbac_holidays) files.push("20260819_v236_registration_rbac_holidays.sql");
  if (!state.training_phase1_pay_exception) files.push("20260810_training_phase1_pay_exception.sql");
  if (!state.training_anchor_override) files.push("20260820_training_anchor_override.sql");
  if (!state.equipment_clearance_integrity) files.push("20260823_equipment_clearance_integrity.sql");
  if (!state.recycle_bin_transport_grant) files.push("20260824_recycle_bin_and_transport_grant.sql");
  return files;
}

async function runViaManagementApi(projectRef, token, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Management API ${res.status}: ${body.slice(0, 500)}`);
  }
  return "Management API";
}

async function runViaPg(projectRef, password, sql) {
  let Client;
  try {
    ({ Client } = require("pg"));
  } catch {
    throw new Error("Install pg: npm install pg");
  }
  const hosts = [
    `db.${projectRef}.supabase.co`,
    `aws-0-eu-central-1.pooler.supabase.com`,
    `aws-0-us-east-1.pooler.supabase.com`,
  ];
  let lastErr;
  for (const host of hosts) {
    const client = new Client({
      host,
      port: host.includes("pooler") ? 6543 : 5432,
      database: "postgres",
      user: host.includes("pooler") ? `postgres.${projectRef}` : "postgres",
      password,
      ssl: { rejectUnauthorized: false },
    });
    try {
      await client.connect();
      await client.query(sql);
      await client.end();
      return `Postgres (${host})`;
    } catch (err) {
      lastErr = err;
      try {
        await client.end();
      } catch {
        /* ignore */
      }
    }
  }
  throw lastErr || new Error("Postgres connection failed");
}

async function loadAccessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) return "";
  const paths = [
    path.join(home, ".supabase", "access-token"),
    path.join(home, ".supabase", "access_token"),
  ];
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        const token = fs.readFileSync(p, "utf8").trim();
        if (token) return token;
      }
    } catch {
      /* try next */
    }
  }
  return "";
}

async function applySql({ url, sql }) {
  const projectRef = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  if (!projectRef) throw new Error("Could not parse project ref from SUPABASE_URL");

  const accessToken = await loadAccessToken();
  if (accessToken) return runViaManagementApi(projectRef, accessToken, sql);

  const dbPassword = process.env.SUPABASE_DB_PASSWORD;
  if (dbPassword) return runViaPg(projectRef, dbPassword, sql);

  throw new Error(
    "No DDL credentials. Use Supabase MCP apply_migration, run `supabase login`, " +
      "or set SUPABASE_ACCESS_TOKEN / SUPABASE_DB_PASSWORD in .env"
  );
}

async function main() {
  const url = process.env.SUPABASE_URL;
  if (!url) {
    console.error("Need SUPABASE_URL in .env");
    process.exit(1);
  }

  const { getSupabaseAdmin } = require("../lib/supabase-client");
  const db = getSupabaseAdmin();
  const state = await probeState(db);
  const files = filesToApply(state);

  if (!files.length) {
    console.log("All pending migrations already applied.");
    return;
  }

  const sql = files
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n\n");

  console.log("Applying:", files.join(", "));
  const via = await applySql({ url, sql });
  console.log("Applied via", via);

  const after = await probeStateWithRetry(db);
  const remaining = filesToApply(after);
  if (remaining.length) {
    throw new Error(`Verification failed — still missing: ${remaining.join(", ")}`);
  }
  console.log(
    "Verified: internal_id, force_update, finance_hr, v109b5, v110, v112, holidays_country, " +
      "org_registration, training_phases, registration_identity, rbac_payslip, app_role_permissions, " +
      "app_user_permissions, notification_routing, quality_notes, v140_sales, training_payroll, " +
      "sales_attachment_permissions, airtable_sync, v128_phase1, rpm_sales_quality_acl."
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

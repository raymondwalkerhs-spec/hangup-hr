# Hangup HR — Database Schema (Supabase)

> **Canonical schema reference.** Historical Google Sheets layout: [`LEGACY_GOOGLE_SHEETS.md`](LEGACY_GOOGLE_SHEETS.md).  
> **Apply DDL:** `npm run apply:migrations` or Supabase MCP `apply_migration`.

## Overview

- **Backend:** Supabase Postgres (`DATA_BACKEND=supabase`)
- **App access:** Express uses the **service role** key → bypasses RLS
- **Direct client access:** RLS denies all `anon` / `authenticated` roles on every table
- **Empty `app_role_permissions`:** app uses hardcoded defaults in [`lib/roles.js`](lib/roles.js)

## Migration timeline

Apply in filename order:

| # | File | Summary |
|---|------|---------|
| 1 | `20260702_initial_hr_schema.sql` | Stub (core HR applied via MCP) |
| 2 | `20260702_hrms_advanced_schema.sql` | HRMS tables |
| 3 | `20260702_rls_deny_all.sql` | Global RLS deny-all |
| 4 | `20260702_employee_compliance.sql` | Compliance columns |
| 5 | `20260702_sales_bonus_costs.sql` | Sales, expenses, notifications |
| 6 | `20260702_app_users_email.sql` | `app_users.email` |
| 7 | `20260702_public_holidays_active.sql` | `public_holidays.active` |
| 8 | `20260703_v107_schema.sql` | Equipment, leave extensions |
| 9 | `20260704_org_teams.sql` | `org_teams` |
| 10 | `20260705_hs2_mgmt_roster.sql` | Seed data |
| 11 | `20260706_employee_internal_id.sql` | `employees.internal_id` + FKs |
| 12 | `20260706_app_versions_force_update.sql` | `force_update_min_version` |
| 13 | `20260707_holidays_country_unique.sql` | `(holiday_date, country)` unique |
| 14 | `20260708_finance_hr_attendance.sql` | Loans, reports, imports |
| 15 | `20260709_v109b5_sprint.sql` | Sales form, field permissions |
| 16 | `20260710_v110_relations.sql` | `position_rate_monthly` |
| 17 | `20260711_v112_clients_breaks.sql` | Clients, breaks, settings revision |
| 18 | `20260712_org_registration.sql` | Org managers, agent registration |
| 19 | `20260713_agent_training_phases.sql` | Training program/phases |
| 20 | `20260714_registration_identity_training.sql` | National ID, training flag |
| 21 | `20260715_rbac_payslip_grants.sql` | Payslip visibility, grant expiry |
| 22 | `20260716_app_role_permissions.sql` | Admin RBAC overrides |
| 23 | `20260717_app_user_permissions.sql` | Per-user permission overrides |
| 24 | `20260718_notifications_quality_notes.sql` | Notification routing rules + quality notes |
| 25 | `20260719_v140_sales_org_dashboards.sql` | Working day, list columns, sales access surfaces |
| 26 | `20260720_sales_attachment_permissions.sql` | Attachment kind permissions |
| 27 | `20260720_training_payroll.sql` | Training payroll tables |
| 28 | `20260721_sales_airtable_sync.sql` | Airtable sync columns |
| 29 | `20260722_v128_phase1_rules_it_meetings_separation.sql` | Rules, IT requests, meeting requests, team_tls, unit_ops |
| 30 | `20260723_v129_multi_feature_sprint.sql` | IT routing, half/quarter-day leave, price tier, companies table |
| 31 | `20260724_v130_finance_company_scope.sql` | Finance tables unit/company columns |
| 32 | `20260724_interview_schema.sql` | Interviews/training module tables |
| 33 | `20260725_interview_training_updates.sql` | Interview/training schema updates (status rename, batch_number, company, metrics) |
| 34 | `20260801_v220_password_changed_at.sql` | `app_users.password_changed_at` (NULL default — no backfill) |
| 35 | `20260801_v220_interview_training_status.sql` | Training status v2 (`on hold`, `cancelled`; migrates `no show no call` → `on hold`) |
| 36 | `20260801_v220_expense_category.sql` | `expense_requests.category` with constrained values |
| 37 | `20260801_v220_interview_feedbacks_company_backfill.sql` | One-time `interview_feedbacks.company` alignment (optional) |

## RLS pattern

1. **`20260702_rls_deny_all.sql`** — loops all `public` tables: enable RLS + `deny_anon` / `deny_authenticated` (`USING false`)
2. **Later migrations** — per-table `deny_all_<table>` for new tables

## Core HR tables (MCP / pre-repo DDL)

These tables exist in production; DDL was applied outside early migration stubs. Columns below include repo `ALTER`s.

### `employees`
| Column | Type | Notes |
|--------|------|-------|
| `id` | text | PK — app ID (e.g. HS1-001) |
| `internal_id` | uuid | Stable UUID; FK target for child rows |
| `american_name`, `arabic_name`, `phone`, `email` | text | |
| `employment_date`, `status`, `position`, `department`, `unit`, `team` | text | |
| `payment_method`, `alternative_payment`, `allowance` | text | |
| `nationality`, `national_id`, `passport_number` | text | |
| `fp_number` | text | Attendance fingerprint |
| `payroll_exempt`, `training_passed` | boolean | |
| `depart_date`, `probation_end_date`, `contract_end_date` | date | |
| `archived_app_id`, `deleted_at` | text / timestamptz | Soft archive |

**Company architecture (v1.29):** HS-1 and HS-3 are merged into "Hang-Up" company. HS-2 remains separate as "HS-2 Company". Units are associated with companies via `org_unit_managers.company_slug`.

### `app_users`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `username`, `password_hash`, `role`, `status` | text | Login + RBAC role |
| `email` | text | |
| `employee_id` | text | FK → `employees(id)` |
| `is_it` | boolean | Optional legacy IT access flag; app falls back when absent |
| `last_login_at` | timestamptz | |
| `password_changed_at` | timestamptz | Set on password change; NULL for legacy users (v2.2.0 session invalidation) |

### `attendance_events`
| Column | Type | Notes |
|--------|------|-------|
| `employee_id`, `date` | text, date | PK (composite) |
| `status`, `fp_lateness`, `transport_override` | text | |
| `paid_leave`, `leave_note`, `fp_notes` | bool / text | |
| `employee_internal_id` | uuid | FK → `employees(internal_id)` |

### `payroll_adjustments`
| Column | Type | Notes |
|--------|------|-------|
| `employee_id`, `year_month` | text | PK (composite) |
| `extra_days`, `two_week_hold`, `no_payroll` | numeric / bool | |
| `payslip_visible_to_agent` | boolean | HR releases payslip to agent |
| `commission_*`, `monthly_salary_override`, `net_salary_override`, `sales_count` | various | |
| `employee_internal_id` | uuid | |

### Other core tables
`bonus_events`, `deduction_events`, `position_rates`, `commission_types`, `commission_tiers`, `employee_loans`, `loan_payments`, `payroll_splits`, `employee_documents`, `employee_warnings`, `app_config`, `app_versions`, `change_log` — see [`lib/supabase/mappers.js`](lib/supabase/mappers.js) for field mapping.

**Finance tables with company scope (v1.30):** `employee_loans`, `loan_payments`, `bonus_events`, `deduction_events`, `bonus_requests`, `expense_requests`, `monthly_bills`, `petty_cash_funds`, `petty_cash_ledger` now include `unit` column for per-company separation.

## HRMS & operations

| Table | PK | Purpose |
|-------|-----|---------|
| `employment_periods` | `id` uuid | Hire/re-hire periods |
| `action_improvement_plans` | `id` uuid | AIP weekly plans |
| `onboarding_checklists` | `employee_id` | Onboarding flags |
| `offboarding_checklists` | `employee_id` | Offboarding flags |
| `clearance_items` | `id` uuid | Per-item clearance |
| `equipment` | `id` uuid | Asset catalog |
| `equipment_assignments` | `id` uuid | Assignments |
| `leave_requests` | `id` uuid | Leave workflow |
| `public_holidays` | `id` uuid | USA/Egypt holidays; unique `(holiday_date, country)` |
| `payroll_month_locks` | `year_month` | Month lock |
| `app_sessions` | `id` text | Session audit |

## Sales, finance & notifications

| Table | PK | Purpose |
|-------|-----|---------|
| `sales` | `id` uuid | **MLA** sales log; `form_data` jsonb |
| `rpm_sales` | `id` uuid | **RPM** sales log (separate table from MLA) |
| `sales_field_permissions` | `field_key` | MLA column view/edit roles (`main_view_roles`, `quality_view_roles`, `edit_roles`) |
| `rpm_sales_field_permissions` | `field_key` | RPM field ACL (separate from MLA) |
| `sales_attachment_permissions` | `attachment_key` | MLA attachment kind view/edit roles |
| `rpm_sales_attachment_permissions` | `attachment_key` | RPM attachment kind view/edit roles |
| `sales_action_permissions` | `action_key` | MLA sale action ACL |
| `rpm_sales_action_permissions` | `action_key` | RPM sale action ACL |
| `sales_list_column_config` | `field_key` | MLA log column visibility |
| `rpm_sales_list_column_config` | `field_key` | RPM log column visibility |
| `sales_attachments` | `id` uuid | MLA attachment refs; `dropbox_path` → `mla-sales-attachments/…` or legacy `sales-attachments/…` |
| `rpm_sales_attachments` | `id` uuid | RPM attachment refs; `dropbox_path` → `rpm-sales-attachments/{rpm_sale_id}/quality_record/…` etc. |
| `sales_visibility_grants` | `id` uuid | Temporary wider view; `expires_at` |
| `bonus_requests` | `id` uuid | Bonus approval workflow |
| `expense_requests` | `id` uuid | Petty cash / expenses; `category` (v2.2.0) |
| `petty_cash_funds`, `petty_cash_ledger` | uuid | Petty cash |
| `monthly_bills` | `id` uuid | Recurring bills |
| `app_notifications` | `id` uuid | In-app notifications |
| `notification_routing_rules` | `action_key` | Configurable notification recipients per action |
| `employee_quality_notes` | `id` uuid | Quality-team notes (separate from HR warnings) |

## Org, registration & training

| Table | PK | Purpose |
|-------|-----|---------|
| `org_teams` | `id` uuid | Teams; `tl_employee_id` |
| `org_unit_managers` | `unit` | OP/HR per unit |
| `registration_daily_pins` | `pin_date` | Agent self-reg PIN |
| `agent_registration_requests` | `id` uuid | Pending registrations |
| `agent_training_programs` | `employee_id` | 4-week program |
| `agent_training_phases` | `id` uuid | Phase 1–4 status |
| `candidate_applications` | `id` uuid | Interview candidates and training records |
| `interview_feedbacks` | `id` uuid | Daily training feedback and test-call metrics |

**Company association (v1.29):** `org_unit_managers` includes `company_slug` to link units to companies.

### `candidate_applications`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `created_at`, `updated_at` | timestamptz | Audit |
| `company` | text | `hangup` or `hs2`; defaults to `hangup` |
| `submitted_by` | text | Submitter username |
| `first_interview_status` | text | `pending`, `on hold`, `accepted`, `rejected` |
| `first_interview_feedback` | text | First interview feedback |
| `interview_date` | date | First interview date |
| `interviewer` | text | Interviewer username |
| `second_interview_status` | text | `pending`, `on hold`, `accepted`, `rejected` |
| `second_interview_feedback` | text | Second interview feedback |
| `second_interview_date` | date | Second interview date |
| `second_interviewer` | text | Second interviewer username |
| `training_status` | text | `waiting`, `on hold`, `started`, `dropped`, `postponed`, `cancelled` (v2.2.0: `no show no call` → `on hold`) |
| `training_start_date` | date | Training start date |
| `trainer` | text | Trainer username |
| `batch_number` | text | Auto-assigned batch (`B1`, `B2`, `B3`, ...) for `training_status = started`, grouped by `training_start_date` |
| `timestamp`, `name`, `email`, `phone`, `whatsapp` | text | Form fields |
| `date_of_birth`, `address`, `gender` | text / date | Form fields |
| `graduation_status`, `faculty_name`, `university_name` | text | Form fields |
| `national_id`, `previous_experiences` | text | Form fields |
| `english_speaking`, `english_writing`, `english_listening` | text | Form fields |
| `fast_paced_rating`, `available_days` | text | Form fields |
| `currently_employed`, `preferred_working_mode` | text | Form fields |
| `how_heard`, `company_if_yes` | text | Form fields |

### `interview_feedbacks`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `created_at`, `updated_at` | timestamptz | Audit |
| `candidate_id` | uuid | FK → `candidate_applications(id)` |
| `candidate_name`, `candidate_email` | text | Denormalized for sheet sync |
| `company` | text | `hangup` or `hs2`; defaults to `hangup` |
| `trainer` | text | Trainer username |
| `day` | integer | 1–5 |
| `date` | date | Feedback date |
| `feedback_text` | text | Daily feedback |
| `is_test_call_day` | boolean | Day 5 flag |
| `active_listening_metric` | integer | 1–5 |
| `english_metric` | integer | 1–5 |
| `accent_metric` | integer | 1–5 |
| `product_knowledge_metric` | integer | 1–5 |

**Company isolation (v1.9.8):** `candidate_applications` and `interview_feedbacks` include `company` column. Reads are filtered by company context so HS2 data never leaks into the main Hangup environment.

**Trainee basic pay (app logic, not stored):** one **anchor-month** training payslip per program; all phase attendance summed × **600 EGP/day**. Splits/defer use `training_payroll` on that anchor month (`lib/training-payroll.js`, `lib/training-pay-rules.js`).

## Finance HR extensions

| Table | PK | Purpose |
|-------|-----|---------|
| `loan_requests` | `id` uuid | Executive loan approval |
| `saved_reports` | `id` uuid | Saved report configs |
| `attendance_imports` | `id` uuid | FP import audit |

## Sales catalog & breaks

| Table | PK | Purpose |
|-------|-----|---------|
| `position_rate_monthly` | `(year_month, position)` | Monthly salary overrides |
| `sales_clients` | `id` uuid | Client list |
| `sales_client_products` | `id` uuid | Device types per client |
| `sales_client_product_prices` | `id` uuid | Price tiers |
| `break_schedules` | `id` uuid | Break rules by unit/role |
| `app_settings_revision` | `key` | Settings cache bust |

## RBAC

### `app_role_permissions`
| Column | Type | Notes |
|--------|------|-------|
| `role` | text | agent, tl, op, hr, admin, ceo, … |
| `permission_key` | text | e.g. `viewPayroll`, `manageOrgStructure` |
| `allowed` | boolean | Override allow/deny |
| `updated_at`, `updated_by` | timestamptz, text | Audit |

**PK:** `(role, permission_key)`  
**Catalog:** [`lib/permission-catalog.js`](lib/permission-catalog.js)  
**Resolver:** [`lib/role-permissions.js`](lib/role-permissions.js)  
**Admin UI:** Access Control page (admin/ceo)

### `companies`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `slug` | text | Unique internal key (e.g. 'hangup', 'hs2') |
| `name` | text | Display name |
| `short_name` | text | Optional short label |
| `is_default` | boolean | Exactly one row is default |
| `active` | boolean | Active/inactive status |
| `sort_order` | integer | Display order |
| `color` | text | Optional brand color hex |
| `created_at`, `updated_at` | timestamptz | Audit |
| `created_by` | text | Creator username |

**Purpose:** Dynamic multi-company registry. Replaces hard-coded HS-1/HS-3 → "Hang-Up", HS-2 → "HS-2 Company" distinction.

### `company_role_permissions`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `company_slug` | text | FK → `companies.slug` |
| `role` | text | Role name |
| `permission_key` | text | Permission key |
| `allowed` | boolean | Override allow/deny |
| `updated_at`, `updated_by` | timestamptz, text | Audit |

**PK:** `(company_slug, role, permission_key)`  
**Purpose:** Per-company access control overrides. Extends `app_role_permissions` with company scope.

## Supabase Storage (sale attachments)

Bucket: `hr-documents` (see `lib/storage.js`).

| Program | Path pattern | DB table |
|---------|--------------|----------|
| MLA | `mla-sales-attachments/{saleId}/{kind}/…` | `sales_attachments` |
| MLA (legacy) | `sales-attachments/{saleId}/{kind}/…` | `sales_attachments` |
| RPM | `rpm-sales-attachments/{saleId}/{kind}/…` | `rpm_sales_attachments` |

`kind` includes `quality_record`, `recording`, `raw_call` (RPM); MLA also has `confirmation`, `receipt`. Constants: `lib/sale-program-storage.js`.

Migration `20260816_sales_program_storage_isolation.sql` documents table separation via `COMMENT ON TABLE`.

## Roles convention

App roles (stored in `app_users.role`): `none`, `agent`, `office_assistant`, `quality`, `rtm`, `public_relations`, `tl`, `op`, `finance`, `it`, `hr`, `admin`, `ceo`.

Login requires rank ≥ `agent`. Username-based gates (Users tab, leave/loan approvers) are **not** in `app_role_permissions`.

## `employee_internal_id` hub

Migration `20260706_employee_internal_id.sql` adds `employees.internal_id` (uuid) and links child tables so app ID changes preserve history. See migration file for full FK list.

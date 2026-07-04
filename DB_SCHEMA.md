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

### `app_users`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `username`, `password_hash`, `role`, `status` | text | Login + RBAC role |
| `email` | text | |
| `employee_id` | text | FK → `employees(id)` |
| `last_login_at` | timestamptz | |

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
| `commission_*`, `monthly_salary_override`, `sales_count` | various | |
| `employee_internal_id` | uuid | |

### Other core tables
`bonus_events`, `deduction_events`, `position_rates`, `commission_types`, `commission_tiers`, `employee_loans`, `loan_payments`, `payroll_splits`, `employee_documents`, `employee_warnings`, `app_config`, `app_versions`, `change_log` — see [`lib/supabase/mappers.js`](lib/supabase/mappers.js) for field mapping.

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
| `sales` | `id` uuid | MLA-Ray sales log; `form_data` jsonb |
| `sales_field_permissions` | `field_key` | Column view/edit roles |
| `sales_attachments` | `id` uuid | Dropbox file refs |
| `sales_visibility_grants` | `id` uuid | Temporary wider view; `expires_at` |
| `bonus_requests` | `id` uuid | Bonus approval workflow |
| `expense_requests` | `id` uuid | Petty cash / expenses |
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

## Roles convention

App roles (stored in `app_users.role`): `none`, `agent`, `office_assistant`, `quality`, `rtm`, `tl`, `op`, `finance`, `hr`, `admin`, `ceo`.

Login requires rank ≥ `agent`. Username-based gates (Users tab, leave/loan approvers) are **not** in `app_role_permissions`.

## `employee_internal_id` hub

Migration `20260706_employee_internal_id.sql` adds `employees.internal_id` (uuid) and links child tables so app ID changes preserve history. See migration file for full FK list.

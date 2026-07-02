# HR Data Sheet Schema

This document describes how HR data is stored in the **Google Sheet** that acts as the
single source of truth for the Hangup HR desktop app. On every launch (and after each
write), the app **imports all tabs below into a local SQLite cache** for fast reads.
Edits are pushed back to this sheet, then the cache is refreshed.

| Property | Value |
|----------|-------|
| **Spreadsheet title** | HR System Final |
| **Spreadsheet ID** | `17z8JrLV0_4fSXzsiZRpCZWFJk5FTit3IUkw0c3NOkvU` |
| **Access** | Service account (Editor) — see `credentials/service-account.json` |
| **Code mapping** | `lib/sheets.js` (read/write) → `lib/data-store.js` (sync) → `lib/cache.js` (SQLite) |

---

## Sync flow

```
Google Sheet (this file)
        │  read all tabs on startup / refresh
        ▼
  lib/sheets.js  ──►  lib/data-store.syncFromSheet()
        │
        ▼
  SQLite cache (.cache/hr-cache.db or portable HangupHR-data/hr-cache/)
        │
        ▼
  Express API (/api/employees, /api/payroll, …)
        │
        ▼
  Desktop UI
```

- **First login:** `POST /api/sync/refresh` pulls the full sheet into SQLite.
- **Reads:** served from SQLite (no per-screen sheet round-trip).
- **Writes:** applied to the sheet, then a silent re-sync updates SQLite.

---

## Tabs (worksheets)

### `Employee_Database`

Master list of agents and staff. One row per employee.

| Column | Field in app | Notes |
|--------|--------------|-------|
| ID | `id` | Primary key, e.g. `HS3-23`, `TL03` |
| American Name | `american_name` | Display name |
| Arabic Name | `arabic_name` | |
| Phone | `phone` | |
| Email | `email` | |
| Employment Date | `employment_date` | |
| Status | `status` | Active, Paused, Out, etc. |
| Position | `position` | Links to Position_Rates |
| Department | `department` | |
| Unit | `unit` | HS-1, HS-2, HS-3, HS-Back-End, … |
| Team | `team` | |
| Payment Method | `payment_method` | |
| Alternative payment | `alternative_payment` | |
| Allowance | `allowance` | |
| Payment Details ( INSTA _ WALLET) | `payment_details_insta_wallet` | |
| Identification | `identification` | National ID, etc. |
| Nationality | `nationality` | Egyptian, Sudanese, etc. |
| Work permit | `work_permit` | Non-Egyptian: `have_permit` / `no_permit` |
| Insurance status | `insurance_status` | Egyptian: `insured` / `not_insured` |
| Insurance type | `insurance_type` | Optional when insured |
| Insurance amount | `insurance_amount` | Optional total (EGP) |
| Employee insurance deduction | `insurance_employee_deduction` | Optional amount deducted from employee |
| Bank Refrence Number | `bank_refrence_number` | |
| Bank Name (AS BANK SHEET) | `bank_name_as_bank_sheet` | |
| Profile Photo File ID | `profile_photo_file_id` | Google Drive file ID |
| Profile Photo Link | `profile_photo_link` | |
| Profile Photo Updated | `profile_photo_updated` | ISO timestamp |

---

### `Position_Rates`

Salary table by job title.

| Column | Field | Notes |
|--------|-------|-------|
| Position | `position` | Must match Employee_Database.Position |
| Monthly Salary (EGP) | `monthlySalary` | Base monthly rate |

---

### `App_Config`

Key-value application settings.

| Column | Example | Notes |
|--------|---------|-------|
| key | `defaultWeekendDays` | |
| value | `[6,0]` | JSON or plain string |

Common keys: `defaultWeekendDays`, `weekendDayNames`, `latenessRules`,
`workingDaysByMonth`, `hideOutEmployees`, `transportAllowanceMonthly`.

---

### `Attendance_Events`

One row per employee per day.

| Column | Field | Notes |
|--------|-------|-------|
| employee_id | `employeeId` | FK → Employee_Database.ID |
| date | `date` | `YYYY-MM-DD` |
| status | `status` | Attended, Half Day, NSNC, Lateness A/B, … |
| fp_lateness | `fpLateness` | Fingerprint lateness flag |
| weekend_default | `weekendDefault` | TRUE/FALSE |
| transport_override | `transportOverride` | full / half / none (optional column) |
| updated_by | `updatedBy` | Username |
| updated_at | `updatedAt` | ISO timestamp |

---

### `Bonus_Events`

| Column | Field |
|--------|-------|
| employee_id | `employeeId` |
| date | `date` |
| amount | `amount` |
| reason | `reason` |
| type | `type` |
| unit | `unit` |
| updated_by | `updatedBy` |
| updated_at | `updatedAt` |

---

### `Deduction_Events`

Same columns as Bonus_Events.

---

### `Payroll_Adjustments`

Per-employee monthly payroll profile (commission, holds, transport, etc.).

| Column | Field | Notes |
|--------|-------|-------|
| employee_id | `employeeId` | |
| year_month | `yearMonth` | `YYYY-MM` |
| extra_days | `extraDays` | |
| two_week_hold | `twoWeekHold` | TRUE/FALSE |
| commission_type | `commissionType` | |
| commission_amount | `commissionAmount` | |
| commission_comments | `commissionComments` | |
| position | `position` | Optional override |
| salary_raise | `salaryRaise` | Optional |
| monthly_salary_override | `monthlySalaryOverride` | Optional |
| payment_method | `paymentMethod` | Optional |
| bank_refrence_number | `bankRefrenceNumber` | Optional |
| bank_name | `bankName` | Optional |
| payroll_status | `payrollStatus` | received / deferred / … |
| transport_eligible | `transportEligible` | TRUE/FALSE |
| month_notes | `monthNotes` | |
| sales_count | `salesCount` | For commission tiers |
| updated_by | `updatedBy` | |
| updated_at | `updatedAt` | |

*The live sheet may have a subset of columns; missing columns default to empty/zero in the app.*

---

### `Commission_Types`

| Column | Field |
|--------|-------|
| name | `name` |
| rate_egp | `rateEgp` |
| description | `description` |
| active | `active` |

---

### `Commission_Tiers`

Sales-tier bonus thresholds per month.

| Column | Field |
|--------|-------|
| year_month | `yearMonth` |
| min_sales | `minSales` |
| bonus_amount | `bonusAmount` |
| label | `label` |

---

### `Employee_Loans`

| Column | Field |
|--------|-------|
| id | `id` |
| employee_id | `employeeId` |
| total_amount | `totalAmount` |
| installment_amount | `installmentAmount` |
| installments_count | `installmentsCount` |
| installments_paid | `installmentsPaid` |
| start_year_month | `startYearMonth` |
| skip_current_month | `skipCurrentMonth` |
| created_year_month | `createdYearMonth` |
| notes | `notes` |
| status | `status` |
| created_by | `createdBy` |
| created_at | `createdAt` |

---

### `Loan_Payments`

| Column | Field |
|--------|-------|
| loan_id | `loanId` |
| employee_id | `employeeId` |
| year_month | `yearMonth` |
| amount | `amount` |
| installment_number | `installmentNumber` |
| recorded_by | `recordedBy` |
| recorded_at | `recordedAt` |

---

### `Payroll_Splits`

Split / deferred payroll amounts.

| Column | Field |
|--------|-------|
| id | `id` |
| employee_id | `employeeId` |
| year_month | `yearMonth` |
| amount | `amount` |
| split_kind | `splitKind` |
| status | `status` |
| defer_to_month | `deferToMonth` |
| notes | `notes` |
| created_by | `createdBy` |
| created_at | `createdAt` |

---

### `Employee_Documents`

Metadata for files stored in Google Drive (`GOOGLE_DRIVE_FOLDER_ID`).

| Column | Field |
|--------|-------|
| employee_id | `employeeId` |
| doc_type | `docType` |
| file_name | `fileName` |
| drive_file_id | `driveFileId` |
| drive_link | `driveLink` |
| uploaded_at | `uploadedAt` |
| expiry | `expiry` |
| notes | `notes` |
| updated_by | `updatedBy` |

---

### `Employee_Warnings`

| Column | Field |
|--------|-------|
| id | `id` |
| employee_id | `employeeId` |
| date | `date` |
| type | `type` |
| title | `title` |
| content | `content` |
| severity | `severity` |
| created_by | `createdBy` |
| created_at | `createdAt` |

---

### `Change_Log`

Audit trail (also mirrored to log sheet `14vcc32…` for Raymond/Mark).

| Column | Field |
|--------|-------|
| timestamp | `timestamp` |
| username | `username` |
| entity | `entity` |
| entity_id | `entityId` |
| action | `action` |
| field | `field` |
| old_value | `oldValue` |
| new_value | `newValue` |
| summary | `summary` |

---

## Related sheets (not in this spreadsheet)

| Purpose | Sheet ID |
|---------|----------|
| HR Access (login users + roles + **App_Versions**) | `1i4KR3e_jNtPMTSDFnbpS7kYzExqEyA0CgLlaZg5KoF8` |
| Change Log (admin audit view) | `14vcc32AvyXI6PEUPbCd5IBoTfhEirAorGX1xMI75h9Y` |

---

## HR Access sheet — `App_Versions` tab

Version policy for the desktop app. Lives on the **HR Access** spreadsheet (same file as login users).
The app reads this tab on **login** and on every **session check** (~5 min).

| Column | Required | Example | Notes |
|--------|----------|---------|-------|
| Version | yes | `1.0.2-beta.4` | Must match `package.json` when you ship a build |
| Release Date | no | `2026-07-02` | For your records |
| Type | no | `minor` | `major` = breaking (old apps blocked); `minor` / `patch` = optional update |
| Min Compatible | yes* | `1.0.0` | Lowest app version still allowed. *For `major`, set equal to the new Version |
| Current | yes | `TRUE` | Exactly **one** row must be `TRUE` — that row is the live policy |
| Notes | no | `Roles + Changes view` | Shown in update / block messages |

### How compatibility works

```
App version  vs  Min Compatible  →  blocked if app is older
App version  vs  Current (TRUE row)  →  update warning if app is older but still compatible
```

| Release type | What to do in the sheet |
|--------------|-------------------------|
| **Major** (breaks old apps) | Add a row, set **Current**=`TRUE` on it, set **Min Compatible** = same as **Version**, clear **Current** on older rows |
| **Minor / feature** (old apps still work) | Add a row, set **Current**=`TRUE`, leave **Min Compatible** unchanged (e.g. still `1.0.0`) |
| **Patch / fix only** | Same as minor — bump **Version**, keep **Min Compatible** as-is |

### Example rows

| Version | Release Date | Type | Min Compatible | Current | Notes |
|---------|--------------|------|----------------|---------|-------|
| 1.0.0 | 2026-01-15 | major | 1.0.0 | FALSE | Initial desktop release |
| 1.0.2-beta.4 | 2026-07-02 | minor | 1.0.0 | TRUE | Roles, Changes view, version checks |

Also keep human-readable release notes in [`CHANGELOG.md`](CHANGELOG.md) in the repo.

---

## Row counts (as inspected)

| Tab | Rows (incl. header) |
|-----|----------------------|
| Employee_Database | 128 |
| Position_Rates | 39 |
| Attendance_Events | 568 |
| Bonus_Events | 9 |
| Deduction_Events | 3 |
| Payroll_Adjustments | 48 |
| Commission_Types | 14 |
| Employee_Loans | 3 |
| Change_Log | 11 |

---

## Environment

```env
SHEET_ID=17z8JrLV0_4fSXzsiZRpCZWFJk5FTit3IUkw0c3NOkvU
GOOGLE_SERVICE_ACCOUNT_PATH=./credentials/service-account.json
```

The packaged app bundles `.env` and credentials via `electron-builder` `extraResources`.

---

## Supabase HRMS tables (`DATA_BACKEND=supabase`)

These tables extend the core schema (see `supabase/migrations/20260702_hrms_advanced_schema.sql`):

| Table | Purpose |
|-------|---------|
| `employment_periods` | Re-hire / depart date ranges per employee |
| `action_improvement_plans` | AIP weeks (Mon–Fri) with tripled payroll deductions |
| `onboarding_checklists` | AD user, ID, contract, training phases 1–4 |
| `offboarding_checklists` | Revoke access, final pay |
| `clearance_items` | Handover checklist per offboarding |
| `equipment` / `equipment_assignments` | Asset registry |
| `leave_requests` | Annual/sick/unpaid leave with approval |
| `public_holidays` | Federal holidays (pink attendance columns) |
| `payroll_month_locks` | Month lock for finance sign-off |
| `app_sessions` | DB-backed session registry (AUTH-05) |

Config keys in `app_config`: `taxRules` (rates default 0), `orgStructure`.

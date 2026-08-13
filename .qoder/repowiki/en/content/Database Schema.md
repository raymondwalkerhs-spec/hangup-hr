# Database Schema

<cite>
**Referenced Files in This Document**
- [DB_SCHEMA.md](file://DB_SCHEMA.md)
- [20260702_hrms_advanced_schema.sql](file://supabase/migrations/20260702_hrms_advanced_schema.sql)
- [20260702_rls_deny_all.sql](file://supabase/migrations/20260702_rls_deny_all.sql)
- [20260702_sales_bonus_costs.sql](file://supabase/migrations/20260702_sales_bonus_costs.sql)
- [20260702_app_users_email.sql](file://supabase/migrations/20260702_app_users_email.sql)
- [20260706_employee_internal_id.sql](file://supabase/migrations/20260706_employee_internal_id.sql)
- [20260710_v110_relations.sql](file://supabase/migrations/20260710_v110_relations.sql)
- [20260719_v140_sales_org_dashboards.sql](file://supabase/migrations/20260719_v140_sales_org_dashboards.sql)
- [20260716_app_role_permissions.sql](file://supabase/migrations/20260716_app_role_permissions.sql)
- [20260717_app_user_permissions.sql](file://supabase/migrations/20260717_app_user_permissions.sql)
- [20260724_v130_finance_company_scope.sql](file://supabase/migrations/20260724_v130_finance_company_scope.sql)
- [20260711_v112_clients_breaks.sql](file://supabase/migrations/20260711_v112_clients_breaks.sql)
- [20260723_v129_multi_feature_sprint.sql](file://supabase/migrations/20260723_v129_multi_feature_sprint.sql)
- [backup-tables.js](file://lib/backup-tables.js)
</cite>

## Table of Contents
1. Introduction
2. Project Structure
3. Core Components
4. Architecture Overview
5. Detailed Component Analysis
6. Dependency Analysis
7. Performance Considerations
8. Troubleshooting Guide
9. Conclusion

## Introduction
This document provides comprehensive data model documentation for the Hangup Portal database schema (Supabase Postgres). It covers entity relationships, field definitions, data types, primary and foreign keys, indexes, constraints, Row Level Security (RLS) policies, validation rules, business constraints, migration history, version management, and security/access control mechanisms. The goal is to make the schema accessible to both technical and non-technical readers while remaining fully traceable to source files.

## Project Structure
The database schema is defined and evolved through a series of SQL migrations under supabase/migrations. A canonical reference summary is maintained in DB_SCHEMA.md. Additional tables are enumerated for backup purposes in lib/backup-tables.js.

```mermaid
graph TB
subgraph "Schema Sources"
M1["20260702_hrms_advanced_schema.sql"]
M2["20260702_sales_bonus_costs.sql"]
M3["20260702_rls_deny_all.sql"]
M4["20260702_app_users_email.sql"]
M5["20260706_employee_internal_id.sql"]
M6["20260710_v110_relations.sql"]
M7["20260711_v112_clients_breaks.sql"]
M8["20260716_app_role_permissions.sql"]
M9["20260717_app_user_permissions.sql"]
M10["20260719_v140_sales_org_dashboards.sql"]
M11["20260723_v129_multi_feature_sprint.sql"]
M12["20260724_v130_finance_company_scope.sql"]
Ref["DB_SCHEMA.md"]
Bk["backup-tables.js"]
end
Ref --> M1
Ref --> M2
Ref --> M3
Ref --> M4
Ref --> M5
Ref --> M6
Ref --> M7
Ref --> M8
Ref --> M9
Ref --> M10
Ref --> M11
Ref --> M12
Bk --> Ref
```

**Diagram sources**
- [DB_SCHEMA.md](file://DB_SCHEMA.md)
- [20260702_hrms_advanced_schema.sql](file://supabase/migrations/20260702_hrms_advanced_schema.sql)
- [20260702_sales_bonus_costs.sql](file://supabase/migrations/20260702_sales_bonus_costs.sql)
- [20260702_rls_deny_all.sql](file://supabase/migrations/20260702_rls_deny_all.sql)
- [20260702_app_users_email.sql](file://supabase/migrations/20260702_app_users_email.sql)
- [20260706_employee_internal_id.sql](file://supabase/migrations/20260706_employee_internal_id.sql)
- [20260710_v110_relations.sql](file://supabase/migrations/20260710_v110_relations.sql)
- [20260711_v112_clients_breaks.sql](file://supabase/migrations/20260711_v112_clients_breaks.sql)
- [20260716_app_role_permissions.sql](file://supabase/migrations/20260716_app_role_permissions.sql)
- [20260717_app_user_permissions.sql](file://supabase/migrations/20260717_app_user_permissions.sql)
- [20260719_v140_sales_org_dashboards.sql](file://supabase/migrations/20260719_v140_sales_org_dashboards.sql)
- [20260723_v129_multi_feature_sprint.sql](file://supabase/migrations/20260723_v129_multi_feature_sprint.sql)
- [20260724_v130_finance_company_scope.sql](file://supabase/migrations/20260724_v130_finance_company_scope.sql)
- [backup-tables.js](file://lib/backup-tables.js)

**Section sources**
- [DB_SCHEMA.md](file://DB_SCHEMA.md)
- [backup-tables.js](file://lib/backup-tables.js)

## Core Components
This section summarizes the core entities and their key attributes as documented in the repository’s canonical schema reference and migrations.

- employees
  - Primary key: id (text)
  - Stable identity: internal_id (uuid), archived_app_id (text), deleted_at (timestamptz)
  - HR fields include name variants, contact info, employment dates, status, position, department/unit/team, payment details, national identifiers, fingerprint number, payroll flags, and departure/probation/contract end dates
  - See DB_SCHEMA.md for full column list

- app_users
  - Primary key: id (uuid)
  - Login and RBAC fields: username, password_hash, role, status
  - Optional email (for future reset flows)
  - employee_id (text) with FK to employees(id) added by v1.1.0 migration
  - Legacy IT flag: is_it (boolean)
  - Last login timestamp: last_login_at (timestamptz)

- attendance_events
  - Composite PK: (employee_id, date)
  - Status and lateness fields; paid leave flags; notes
  - employee_internal_id (uuid) FK to employees(internal_id)

- payroll_adjustments
  - Composite PK: (employee_id, year_month)
  - Payroll modifiers, overrides, visibility flags, commission-related fields, sales_count
  - employee_internal_id (uuid) present

- Sales and finance
  - sales: uuid PK; phone_number, full_name, device (enum via CHECK), price, client, agent_id/closer_id (FK to employees), submission/review metadata, team/unit, effective_date, working_day, submission_time
  - bonus_requests, expense_requests, petty_cash_funds, petty_cash_ledger, monthly_bills, app_notifications
  - Sales visibility grants: sales_visibility_grants

- HRMS and operations
  - employment_periods, action_improvement_plans, onboarding_checklists, offboarding_checklists, clearance_items
  - equipment, equipment_assignments
  - leave_requests, public_holidays, payroll_month_locks, app_sessions

- Sales catalog and breaks
  - position_rate_monthly (year_month, position) PK
  - sales_clients, sales_client_products, sales_client_product_prices
  - break_schedules, app_settings_revision

- RBAC and company scope
  - app_role_permissions (role, permission_key) PK
  - app_user_permissions (username, permission_key) PK
  - companies (slug unique), company_role_permissions (company_slug, role, permission_key) PK

- Finance company scope (v1.30)
  - unit column added to multiple finance tables for per-company separation

**Section sources**
- [DB_SCHEMA.md](file://DB_SCHEMA.md)
- [20260702_app_users_email.sql](file://supabase/migrations/20260702_app_users_email.sql)
- [20260706_employee_internal_id.sql](file://supabase/migrations/20260706_employee_internal_id.sql)
- [20260710_v110_relations.sql](file://supabase/migrations/20260710_v110_relations.sql)
- [20260719_v140_sales_org_dashboards.sql](file://supabase/migrations/20260719_v140_sales_org_dashboards.sql)
- [20260716_app_role_permissions.sql](file://supabase/migrations/20260716_app_role_permissions.sql)
- [20260717_app_user_permissions.sql](file://supabase/migrations/20260717_app_user_permissions.sql)
- [20260724_v130_finance_company_scope.sql](file://supabase/migrations/20260724_v130_finance_company_scope.sql)
- [20260711_v112_clients_breaks.sql](file://supabase/migrations/20260711_v112_clients_breaks.sql)
- [20260723_v129_multi_feature_sprint.sql](file://supabase/migrations/20260723_v129_multi_feature_sprint.sql)

## Architecture Overview
The system uses Supabase Postgres with Express acting as the service role backend that bypasses RLS. Direct client access (anon/authenticated) is denied globally via RLS policies. New tables receive deny-all policies at creation time.

```mermaid
graph TB
Client["Client App (anon/authenticated)"]
PolicyDeny["RLS Deny Policies<br/>deny_anon / deny_authenticated"]
Service["Express Backend (service role)"]
DB["Postgres Tables"]
Client --> PolicyDeny
PolicyDeny --> |Access Denied| Client
Service --> DB
```

**Diagram sources**
- [20260702_rls_deny_all.sql](file://supabase/migrations/20260702_rls_deny_all.sql)
- [DB_SCHEMA.md](file://DB_SCHEMA.md)

## Detailed Component Analysis

### Employee Identity Hub and Child Linking
The stable identity hub ensures historical integrity when employee IDs change.

```mermaid
erDiagram
EMPLOYEES {
text id PK
uuid internal_id UK
text archived_app_id
timestamptz deleted_at
}
ATTENDANCE_EVENTS {
text employee_id
date date
uuid employee_internal_id
}
PAYROLL_ADJUSTMENTS {
text employee_id
text year_month
uuid employee_internal_id
}
SALES {
uuid id PK
text agent_id
text closer_id
uuid agent_internal_id
uuid closer_internal_id
}
EMPLOYMENT_PERIODS {
uuid id PK
text employee_id
}
LEAVE_REQUESTS {
uuid id PK
text employee_id
}
ACTION_IMPROVEMENT_PLANS {
uuid id PK
text employee_id
}
ONBOARDING_CHECKLISTS {
text employee_id PK
}
OFFBOARDING_CHECKLISTS {
text employee_id PK
}
CLEARANCE_ITEMS {
uuid id PK
text employee_id
}
EQUIPMENT_ASSIGNMENTS {
uuid id PK
text employee_id
}
BONUS_REQUESTS {
uuid id PK
text employee_id
}
EMPLOYEES ||--o{ ATTENDANCE_EVENTS : "historical link via internal_id"
EMPLOYEES ||--o{ PAYROLL_ADJUSTMENTS : "historical link via internal_id"
EMPLOYEES ||--o{ SALES : "agent/closer links"
EMPLOYEES ||--o{ EMPLOYMENT_PERIODS : "hire periods"
EMPLOYEES ||--o{ LEAVE_REQUESTS : "leave workflow"
EMPLOYEES ||--o{ ACTION_IMPROVEMENT_PLANS : "AIP plans"
EMPLOYEES ||--|| ONBOARDING_CHECKLISTS : "one-to-one"
EMPLOYEES ||--|| OFFBOARDING_CHECKLISTS : "one-to-one"
EMPLOYEES ||--o{ CLEARANCE_ITEMS : "clearance tasks"
EMPLOYEES ||--o{ EQUIPMENT_ASSIGNMENTS : "asset assignments"
EMPLOYEES ||--o{ BONUS_REQUESTS : "bonus approvals"
```

**Diagram sources**
- [20260706_employee_internal_id.sql](file://supabase/migrations/20260706_employee_internal_id.sql)
- [20260702_hrms_advanced_schema.sql](file://supabase/migrations/20260702_hrms_advanced_schema.sql)
- [20260702_sales_bonus_costs.sql](file://supabase/migrations/20260702_sales_bonus_costs.sql)

**Section sources**
- [20260706_employee_internal_id.sql](file://supabase/migrations/20260706_employee_internal_id.sql)
- [20260702_hrms_advanced_schema.sql](file://supabase/migrations/20260702_hrms_advanced_schema.sql)
- [20260702_sales_bonus_costs.sql](file://supabase/migrations/20260702_sales_bonus_costs.sql)

### Sales Data Model and Constraints
Sales records enforce domain-specific constraints and include audit and review metadata.

```mermaid
flowchart TD
Start(["Insert Sale"]) --> ValidateDevice["Validate device enum<br/>(bracelet | necklace | smartwatch)"]
ValidateDevice --> ValidDevice{"Valid?"}
ValidDevice --> |No| Reject["Reject row"]
ValidDevice --> |Yes| ValidateStatus["Validate status enum<br/>(passed | pending | postdated | denied | callback)"]
ValidateStatus --> ValidStatus{"Valid?"}
ValidStatus --> |No| Reject
ValidStatus --> |Yes| CheckDates["Check effective_date and submission_date"]
CheckDates --> DatesOK{"Dates OK?"}
DatesOK --> |No| Reject
DatesOK --> |Yes| InsertSale["Insert into sales"]
InsertSale --> End(["Done"])
Reject --> End
```

**Diagram sources**
- [20260702_sales_bonus_costs.sql](file://supabase/migrations/20260702_sales_bonus_costs.sql)
- [20260719_v140_sales_org_dashboards.sql](file://supabase/migrations/20260719_v140_sales_org_dashboards.sql)

**Section sources**
- [20260702_sales_bonus_costs.sql](file://supabase/migrations/20260702_sales_bonus_costs.sql)
- [20260719_v140_sales_org_dashboards.sql](file://supabase/migrations/20260719_v140_sales_org_dashboards.sql)

### RBAC and Company-Specific Permissions
Role-based permissions can be overridden at app-wide and per-user levels, with additional per-company overrides.

```mermaid
classDiagram
class AppRolePermissions {
+text role
+text permission_key
+boolean allowed
+timestamptz updated_at
+text updated_by
}
class AppUserPermissions {
+text username
+text permission_key
+boolean allowed
+timestamptz updated_at
+text updated_by
}
class Companies {
+uuid id
+text slug UK
+text name
+text short_name
+boolean is_default
+boolean active
+integer sort_order
+text color
+timestamptz created_at
+timestamptz updated_at
+text created_by
}
class CompanyRolePermissions {
+uuid id
+text company_slug
+text role
+text permission_key
+boolean allowed
+timestamptz updated_at
+text updated_by
}
AppRolePermissions <.. AppUserPermissions : "per-user exceptions"
Companies <.. CompanyRolePermissions : "scope"
CompanyRolePermissions <.. AppRolePermissions : "extends"
```

**Diagram sources**
- [20260716_app_role_permissions.sql](file://supabase/migrations/20260716_app_role_permissions.sql)
- [20260717_app_user_permissions.sql](file://supabase/migrations/20260717_app_user_permissions.sql)
- [20260723_v129_multi_feature_sprint.sql](file://supabase/migrations/20260723_v129_multi_feature_sprint.sql)
- [DB_SCHEMA.md](file://DB_SCHEMA.md)

**Section sources**
- [20260716_app_role_permissions.sql](file://supabase/migrations/20260716_app_role_permissions.sql)
- [20260717_app_user_permissions.sql](file://supabase/migrations/20260717_app_user_permissions.sql)
- [20260723_v129_multi_feature_sprint.sql](file://supabase/migrations/20260723_v129_multi_feature_sprint.sql)
- [DB_SCHEMA.md](file://DB_SCHEMA.md)

### Finance Company Scope (v1.30)
Finance tables now include a unit column to separate data per company/unit.

```mermaid
flowchart TD
Start(["Migration v1.30"]) --> AddUnitLoans["Add unit to employee_loans"]
AddUnitLoans --> BackfillLoans["Backfill from employees.unit"]
BackfillLoans --> AddUnitPayments["Add unit to loan_payments"]
AddUnitPayments --> BackfillPayments["Backfill from employees.unit"]
BackfillPayments --> AddUnitBonusEvents["Add unit to bonus_events"]
AddUnitBonusEvents --> BackfillBonusEvents["Backfill from employees.unit"]
BackfillBonusEvents --> AddUnitDeductionEvents["Add unit to deduction_events"]
AddUnitDeductionEvents --> BackfillDeductionEvents["Backfill from employees.unit"]
BackfillDeductionEvents --> AddUnitBonusRequests["Add unit to bonus_requests"]
AddUnitBonusRequests --> BackfillBonusRequests["Backfill from employees.unit"]
BackfillBonusRequests --> AddUnitExpenseRequests["Add unit to expense_requests"]
AddUnitExpenseRequests --> BackfillExpenseRequests["Backfill from employees.unit"]
BackfillExpenseRequests --> AddUnitMonthlyBills["Add unit to monthly_bills"]
AddUnitMonthlyBills --> AddUnitPettyFunds["Add unit to petty_cash_funds"]
AddUnitPettyFunds --> AddUnitPettyLedger["Add unit to petty_cash_ledger"]
AddUnitPettyLedger --> CreateIndexes["Create unit indexes"]
CreateIndexes --> End(["Done"])
```

**Diagram sources**
- [20260724_v130_finance_company_scope.sql](file://supabase/migrations/20260724_v130_finance_company_scope.sql)

**Section sources**
- [20260724_v130_finance_company_scope.sql](file://supabase/migrations/20260724_v130_finance_company_scope.sql)

### HRMS Advanced Features
HRMS tables support lifecycle workflows and operational tracking.

```mermaid
erDiagram
EMPLOYMENT_PERIODS {
uuid id PK
text employee_id
date start_date
date end_date
boolean is_current
text notes
}
ACTION_IMPROVEMENT_PLANS {
uuid id PK
text employee_id
date week_start
date week_end
text status
text notes
}
ONBOARDING_CHECKLISTS {
text employee_id PK
boolean ad_user
boolean id_scanned
boolean contract
boolean training_phase_1
boolean training_phase_2
boolean training_phase_3
boolean training_phase_4
}
OFFBOARDING_CHECKLISTS {
text employee_id PK
boolean revoke_access
boolean final_pay
}
CLEARANCE_ITEMS {
uuid id PK
text employee_id
text item_key
text status
}
EQUIPMENT {
uuid id PK
text asset_tag UK
text unit
text item_type
text description
}
EQUIPMENT_ASSIGNMENTS {
uuid id PK
uuid equipment_id
text employee_id
timestamptz assigned_at
timestamptz returned_at
}
LEAVE_REQUESTS {
uuid id PK
text employee_id
date start_date
date end_date
text leave_type
text status
}
PUBLIC_HOLIDAYS {
uuid id PK
date holiday_date UK
text name
text country
}
PAYROLL_MONTH_LOCKS {
text year_month PK
timestamptz locked_at
text locked_by
text notes
}
APP_SESSIONS {
text id PK
text username
text device_label
text ip
timestamptz created_at
timestamptz last_seen_at
timestamptz revoked_at
}
EMPLOYMENT_PERIODS }o--|| EMPLOYEES : "employee_id -> employees.id"
ACTION_IMPROVEMENT_PLANS }o--|| EMPLOYEES : "employee_id -> employees.id"
ONBOARDING_CHECKLISTS }o--|| EMPLOYEES : "employee_id -> employees.id"
OFFBOARDING_CHECKLISTS }o--|| EMPLOYEES : "employee_id -> employees.id"
CLEARANCE_ITEMS }o--|| EMPLOYEES : "employee_id -> employees.id"
EQUIPMENT_ASSIGNMENTS }o--|| EQUIPMENT : "equipment_id -> equipment.id"
EQUIPMENT_ASSIGNMENTS }o--|| EMPLOYEES : "employee_id -> employees.id"
LEAVE_REQUESTS }o--|| EMPLOYEES : "employee_id -> employees.id"
```

**Diagram sources**
- [20260702_hrms_advanced_schema.sql](file://supabase/migrations/20260702_hrms_advanced_schema.sql)

**Section sources**
- [20260702_hrms_advanced_schema.sql](file://supabase/migrations/20260702_hrms_advanced_schema.sql)

### Sales Catalog, Breaks, and Settings
Supporting tables for sales configuration and break scheduling.

```mermaid
erDiagram
POSITION_RATE_MONTHLY {
text year_month
text position
numeric monthly_salary
timestamptz updated_at
}
SALES_CLIENTS {
uuid id PK
}
SALES_CLIENT_PRODUCTS {
uuid id PK
}
SALES_CLIENT_PRODUCT_PRICES {
uuid id PK
}
BREAK_SCHEDULES {
uuid id PK
}
APP_SETTINGS_REVISION {
text key PK
}
POSITION_RATE_MONTHLY }o--|| POSITIONS : "position -> positions.position"
```

**Diagram sources**
- [20260710_v110_relations.sql](file://supabase/migrations/20260710_v110_relations.sql)
- [20260711_v112_clients_breaks.sql](file://supabase/migrations/20260711_v112_clients_breaks.sql)
- [DB_SCHEMA.md](file://DB_SCHEMA.md)

**Section sources**
- [20260710_v110_relations.sql](file://supabase/migrations/20260710_v110_relations.sql)
- [20260711_v112_clients_breaks.sql](file://supabase/migrations/20260711_v112_clients_breaks.sql)
- [DB_SCHEMA.md](file://DB_SCHEMA.md)

## Dependency Analysis
Key dependencies and relationships across core tables:

```mermaid
graph LR
Employees["employees"]
Attendance["attendance_events"]
PayrollAdj["payroll_adjustments"]
Sales["sales"]
BonusReq["bonus_requests"]
ExpenseReq["expense_requests"]
PettyFunds["petty_cash_funds"]
PettyLedger["petty_cash_ledger"]
MonthlyBills["monthly_bills"]
Notifications["app_notifications"]
PositionRateMonthly["position_rate_monthly"]
AppUsers["app_users"]
RolePerms["app_role_permissions"]
UserPerms["app_user_permissions"]
Companies["companies"]
CompanyRolePerms["company_role_permissions"]
Employees --> Attendance
Employees --> PayrollAdj
Employees --> Sales
Employees --> BonusReq
Employees --> ExpenseReq
PettyFunds --> PettyLedger
AppUsers --> Employees
RolePerms --> AppUsers
UserPerms --> AppUsers
Companies --> CompanyRolePerms
PositionRateMonthly --> PayrollAdj
```

**Diagram sources**
- [20260706_employee_internal_id.sql](file://supabase/migrations/20260706_employee_internal_id.sql)
- [20260710_v110_relations.sql](file://supabase/migrations/20260710_v110_relations.sql)
- [20260702_sales_bonus_costs.sql](file://supabase/migrations/20260702_sales_bonus_costs.sql)
- [20260716_app_role_permissions.sql](file://supabase/migrations/20260716_app_role_permissions.sql)
- [20260717_app_user_permissions.sql](file://supabase/migrations/20260717_app_user_permissions.sql)
- [20260723_v129_multi_feature_sprint.sql](file://supabase/migrations/20260723_v129_multi_feature_sprint.sql)

**Section sources**
- [20260706_employee_internal_id.sql](file://supabase/migrations/20260706_employee_internal_id.sql)
- [20260710_v110_relations.sql](file://supabase/migrations/20260710_v110_relations.sql)
- [20260702_sales_bonus_costs.sql](file://supabase/migrations/20260702_sales_bonus_costs.sql)
- [20260716_app_role_permissions.sql](file://supabase/migrations/20260716_app_role_permissions.sql)
- [20260717_app_user_permissions.sql](file://supabase/migrations/20260717_app_user_permissions.sql)
- [20260723_v129_multi_feature_sprint.sql](file://supabase/migrations/20260723_v129_multi_feature_sprint.sql)

## Performance Considerations
- Indexes
  - attendance_events: composite PK (employee_id, date)
  - payroll_adjustments: composite PK (employee_id, year_month); index on year_month
  - sales: indexes on agent_id, status, effective_date, team, unit
  - bonus_requests: indexes on status, date, employee_id
  - expense_requests: indexes on status, submitted_by, due_date
  - app_notifications: indexes on username, (username, read_at)
  - position_rate_monthly: index on year_month
  - app_sessions: index on username
  - finance tables: indexes on unit columns after v1.30
- Constraints
  - Enumerated domains enforced via CHECK constraints (e.g., sales.device, sales.status, petty_cash_ledger.transaction_type, monthly_bills.bill_type/status)
  - Unique constraints (e.g., public_holidays.holiday_date; sales_visibility_grants composite uniqueness)
- Query patterns
  - Use unit/company scoping filters for finance tables to leverage indexes
  - Prefer queries over employee_internal_id for historical stability

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
- Access denied errors
  - All direct client roles (anon/authenticated) are denied by default via global RLS policies. Ensure requests go through Express using the service role.
- Missing or incorrect enums
  - Verify CHECK constraints on sales.device and sales.status; ensure values match allowed sets.
- Duplicate entries
  - Public holidays require unique holiday_date; verify before insert.
  - Sales visibility grants enforce uniqueness on granter/grantee/scope_type/scope_value.
- Company scope issues
  - After v1.30, finance tables require unit values; backfills populate from employees.unit but new rows must set unit appropriately.

**Section sources**
- [20260702_rls_deny_all.sql](file://supabase/migrations/20260702_rls_deny_all.sql)
- [20260702_sales_bonus_costs.sql](file://supabase/migrations/20260702_sales_bonus_costs.sql)
- [20260702_hrms_advanced_schema.sql](file://supabase/migrations/20260702_hrms_advanced_schema.sql)
- [20260724_v130_finance_company_scope.sql](file://supabase/migrations/20260724_v130_finance_company_scope.sql)

## Conclusion
The Hangup Portal database schema is structured around a stable employee identity hub, robust HRMS workflows, detailed sales and finance tracking, and strong access controls via RLS and RBAC. Migrations provide clear evolution paths, including company-scoped finance data and enhanced sales dashboards. The deny-all RLS pattern ensures secure access through the service role backend, while explicit constraints and indexes maintain data integrity and performance.

[No sources needed since this section summarizes without analyzing specific files]
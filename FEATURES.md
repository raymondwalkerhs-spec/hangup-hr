# Hangup Portal — Feature Overview

> **Data backend:** Supabase only. **Do not use Google Sheets.** See [`LEGACY_GOOGLE_SHEETS.md`](LEGACY_GOOGLE_SHEETS.md).

*Board-ready summary of what the application does today.*

**Version:** 1.6.14 · **Platform:** Windows + macOS desktop (Electron)

---

## Executive summary

**Hangup Portal** is an all-in-one **HR operations desktop application** for a call-center / BPO workforce. It replaces scattered spreadsheets with one system for people, attendance, payroll, sales quality, compliance, and finance handoff.

| | |
|---|---|
| **Users** | HR, leadership, finance, team leads, operations, quality, agents |
| **Data** | Supabase (cloud source of truth) + local SQLite cache on each PC |
| **Delivery** | Signed desktop installer, in-app updates, optional web bootstrap installer |
| **Governance** | Role-based access, field-level sales permissions, full audit trail |

**One-line pitch:** A fast, offline-friendly desktop HR system that keeps workforce, attendance, and payroll in sync with the cloud — built for real operations teams, not generic HR software.

---

## Who uses it

| Role | Typical use |
|------|-------------|
| **CEO / Admin** | Full access, audit log, finance exports, user management, access control |
| **HR** | Employees, attendance, payroll, documents, lifecycle, training program |
| **Finance** | Payroll review, tax config, payment exports, costs, month lock |
| **RTM / Quality** | Sales approval, quality tickets, sales permissions, dashboards |
| **Team Lead (TL) / OP** | Unit attendance, sales submission, quality verification, bonus requests |
| **IT** | Full equipment inventory and assignment |
| **Agent** | Own attendance, payslips, bonuses, equipment, read-only directory |

Every role sees only what **Access Control** and module-specific permissions allow. Overrides are stored in the database and apply without redeploying the app.

---

## Platform & reliability

### Architecture

```
Supabase (Postgres + Storage)
        │  sync on launch & after writes
        ▼
  Local SQLite cache (per PC)
        │
        ▼
  Electron UI + Express API (loopback only)
```

### Why it works in production

- **Cloud source of truth** — one database for all HR PCs
- **Fast local cache** — daily work does not wait on every click
- **Automatic sync** — saves push to cloud, then refresh quietly
- **Offline resilience** — read and draft locally; sync when connected
- **In-app updates** — patch or full builds from GitHub Releases (all users)
- **Version policy** — old builds can be blocked or warned at login (`app_versions`)
- **Desktop UX** — native modals and confirmations (no broken browser dialogs)

### Security

- Passwords hashed with bcrypt
- Server-side API only — secrets never exposed to the UI layer
- Row Level Security on Supabase (public denied; app server authenticated)
- **One active session per user** — new login revokes the previous device
- Session timeout: 10 minutes idle (client), 10 hours idle (server revoke)
- Session ID visible in Settings for support; leadership can revoke sessions
- Full **change log** on important edits

---

## Employee management

### Profiles & directory

- American and Arabic names, employee ID, unit, team, position
- Payment method: cash, bank, Instapay / wallet
- Profile photo
- Promotion history (former IDs, effective month)
- Search and filters (HR/Admin): unit, team, status, nationality, compliance

### Nationality & compliance

- **Nationality** with quick picks (Egyptian, Sudanese, …)
- **Non-Egyptian** → work permit status (have / don't have)
- **Egyptian** → social insurance (insured / not insured) with optional type, amount, deduction
- Filter employee list by nationality, permit, and insurance

### Employment lifecycle

- **Employment periods** — start, depart, re-hire; gap months excluded from attendance
- **Onboarding checklist** — AD user, ID scan, contract, training phases 1–4
- **Offboarding** — revoke access, final pay
- **Clearance** — handover form, equipment return, file checklist
- **Reposition** — move agents between units/teams with correct ID pool rules
- **Agent registration** — 3-step wizard (PIN → details → approval pipeline)

### Notes & discipline

- **HR notes** on employee profile (HR/Admin write; escalation levels)
- **Quality notes** separate from HR notes (Quality / TL / OP write; HR notified)
- **Warnings** — verbal / written with 1st, 2nd, final escalation
- **Action Improvement Plan (AIP)** — discipline week with payroll consequences (see Payroll)

---

## Attendance

- Monthly grid per employee and day
- Statuses: Attended, Half Day, Quarter Day, NSNC, Lateness A/B, Day-OFF, and more
- Unit and team filters; sticky columns for large grids
- Working days per month (auto-calculated or manual override with audit note)
- **Federal holidays** — pink columns, no payroll penalty; bulk day-off for active staff
- **Bulk actions** — init weekends, mark weekdays attended
- Transport allowance override on eligible statuses (HR/Admin only)
- **Guards** — no edits after depart or outside employment period
- **Month lock** — payroll-finalized months cannot be edited
- **Fingerprint import** — upload device export; per-month FP rules
- **Auto-OUT** after depart date when employee worked in month

Agents see their own attendance read-only; HR/Admin edit.

---

## Payroll & compensation

### Monthly payroll engine

- Position-based basic salary (month-scoped rate snapshots on Salaries page)
- Attendance-driven days (NSNC, half days, lateness penalties)
- Bonuses and deductions (many types, including sales commission tiers)
- Transport allowance (from configured month)
- Loan installments
- Extra days, 2-week hold, per-employee adjustments
- Tax lines (structure ready; rates default 0%)
- **No payroll** month toggle for excluded employees
- Hide zero-net rows on payroll grid

### Payslips

- PDF per employee per month
- Bonus and deduction line items
- Action Improvement Plan section when applicable
- Offboarding / clearance banners with links to complete workflows
- **Per-split PDF** export and **splits ZIP** for commission breakdowns
- Sales count auto-recalculated from sales log

### Action Improvement Plan (AIP)

Discipline week (Mon–Fri) with automatic payroll impact:

- Lateness A fixed at **75 EGP**
- Day-OFF → **3 salary days** deducted
- **All other deductions in that week × 3**
- Visible on payslip with week dates and explanations

### Training payroll

- **Three payroll tabs** — Main (agents), Training (trainees), Total (payments due/received)
- **Fixed trainee pay** — 12,000 EGP/mo, 20 days, 600 EGP/day, 3,000 EGP/week
- **4-week program** — Phase 1 unpaid; Phases 2–4 paid when passed
- **12 passed sales** required (4 per evaluation phase) + HR **Promote to Agent**
- **Dual payslip** when promotion mid-month: Training + Main tabs; separate PDFs
- Outcomes: failed, agent left, company terminated — each with defined pay rules
- Resignation: notice-period pay scale (5–10 sales); no-notice 10-day deduction

### Payroll controls

- **Month lock** — finance sign-off; blocks further edits
- **MoM compare** — net pay vs previous month + anomaly flags
- **Finance handoff ZIP** — payroll CSV + all payslip PDFs + change log
- Payment exports: **Cash**, **Bank**, **Instapay** (CSV + PDF)

### Bonuses & deductions

- TL / OP / Quality / RTM **request** bonuses for dialing agents
- HR / Admin **approve** → posts to payroll
- Leadership roles receive bonuses via payslip direct add only
- TL/OP bonus transfers with source visibility (role-gated)
- Loan approvals (Mark, Phoebe, Raymond)

---

## Sales & quality

Full operational reference: [`SALES_LOG.md`](SALES_LOG.md)

### Sales log

- Per-sale records with dynamic MLA-Ray form (all fields in `form_data`)
- Day / week / month dashboards with status filters and stat cards
- **Working day rule** — sales until 1 AM Cairo count on previous day
- Toolbar filters: client, agent, closer, client status, reviewer status
- **Advanced filter** — AND / OR / NOT rules with dropdown values
- **Log columns** — admin enables catalog fields + standard columns; intersected with role view ACL
- Statuses: passed, pending, postdated, denied, callback
- TL/OP submission; Quality / RTM / HR / Admin approval workflow

### Sale forms & tickets

- **Add sale** — dedicated submit surface: full editable form (not Sales permissions ACL); role-scoped unit/team/agent/closer pickers; team auto from agent; no quality section on create; **draft auto-save** and **Clear all**; **Airtable-aligned required validation**; recording upload required on submit; double-submit prevention
- **Edit sale** — field visibility and edit rights from Sales permissions; **Delete sale** (Admin/RTM); **reassign unit/team/agent/closer** (Admin/RTM/CEO)
- **View sale** — read-only detail modal (Access Control **View sale**); fields from Edit sale tab
- **Quality ticket** — separate surface with its own view/edit grants; assigned OP/TL verifiers can update reviewer status when permitted; **reassign unit/team/agent/closer** for Admin/RTM/CEO
- **Sales catalog** — clients, devices, price tiers (Settings); TL/OP must use catalog when configured
- Payment method toggle — card vs bank sub-fields
- **Reviewer status** / **Client status** (verifier feedback / client feedback)
- Cross-unit agent and closer display names on list and forms

### Attachments & export

- Recordings and confirmations in **Supabase Storage** (`hr-documents` / `sales-attachments`)
- **Airtable sync (optional)** — when configured in `.env`, every sale mutation pushes to Airtable **Sales All Data** (all fields + attachments via signed URLs); debounced, non-blocking
- Inline audio playback, download, signed share links
- Attachment view/upload gated per role (Sales permissions **Attachments** tab)
- Export filtered list or single sale: **CSV**, **Excel**, or **PDF**

### Sales permissions (Admin / RTM)

Tabbed configuration stored in database:

| Tab | Controls |
|-----|----------|
| **Edit sale** | Who sees/edits each field on the main sale form |
| **Quality ticket** | Who sees/edits each field on the quality ticket |
| **Attachments** | Who can view/upload each attachment kind |
| **Actions** | Approve, deny, callback, export, and related actions |

Per-user exceptions inherit live role defaults from Access Control.

---

## Time off & calendar

- **Requests** — annual, sick, unpaid, medical, same-day off
- Agents: unpaid, medical, same-day only (annual hidden); TL/OP/HR retain annual
- Approval queue for Mark, Raymond, Phoebe
- Approved leave → automatic Day-OFF rows in attendance
- **Federal holidays** CRUD in Settings (default country USA; 2024–2028 seed data)

---

## Documents & compliance

- Document types: National ID, Contract, Medical, Exam note, Training, Warning letter, …
- **My docs self-upload** — agents upload National ID, Medical Note, Exam Note only; HR/Admin upload all types including Contract
- Stored in **Supabase Storage**
- Expiry tracking + dashboard alerts (30 / 60 days)
- **No expiry** flag per document
- Bulk **ZIP export** per employee
- Dashboard widget for upcoming expiries

---

## Equipment & organization

### Equipment

- Company asset registry (serial, type, status)
- Assign and return devices to any employee (IT / HR / Admin)
- Unit-scoped view for OP; self-only for agents
- Deep links: `#equipment?employee=HS3-08`
- Issue equipment permission in Access Control

### Organization

- Unit → team → agent hierarchy
- Live team rosters; OP/TL assignment per team
- TL/OP scoped to own unit; agents see own team context
- **Dual-role TL** via org `tl_employee_id`
- Agent privacy controls for org visibility
- Registrations pipeline from agent self-signup

---

## Costs & finance

- **Expenses / receipts** — upload, status workflow (paid, pending, on hold, archived)
- **Petty cash** — fund balance + ledger (deposits editable after posting)
- **Monthly bills** — landline, internet, utilities, etc.
- Access: finance role, Mark, Phoebe, Raymond; HR can submit expenses
- Full costs view gated by Access Control

---

## Dashboards & reporting

### Dashboard

- Headcount and turnover widgets
- Payroll totals (finance / HR / leadership)
- Document expiry summary
- Team and company sales dashboards (role-scoped)
- Unit toggles (HS-1 / HS-2 / HS-3) for permitted roles

### Reports

| Report | Output |
|--------|--------|
| Monthly HR report | PDF + Markdown |
| Headcount & turnover | In-app summary |
| Attendance rankings | NSNC / lateness CSV |
| Finance handoff | ZIP (payroll + payslips + changelog) |
| Custom saved reports | User-defined filters and columns |
| Change log | Full audit + CSV export |

---

## Notifications

- **Top-bar bell** — always visible; unread badge; optional sound
- **Full history modal** — mark read / mark all read; click to navigate
- Routes: sale → Sales; leave → Requests; bonus → Bonuses; notes → employee
- **Configurable routing** — Admin/RTM set recipient roles per action in Settings
- Default routes for leave, pending sales, agent sales, bonus requests, HR/quality notes

---

## Administration & configuration

### Access Control

- Admin UI for **50+ permissions** across pages, sales, payroll, costs, settings
- Per-role defaults with database overrides (`app_role_permissions`)
- Per-user exceptions with live inheritance from role defaults

### User management

- **App Users** (Raymond) — create logins, roles, passwords, email, status
- Activate inactive employee accounts
- **Purge user & release ID** — remove login, free employee ID (`DEL-…` placeholder keeps history)
- **Sessions** — view and revoke active logins
- **Change password** — any user in Settings

### Settings

- Seven color themes (saved per device)
- Federal holidays, tax rules, break schedules (timed pop-up reminders)
- Sales catalog (clients, products, prices)
- Notification routing
- Sync controls, hide-out-employees toggle, session ID
- Profile photo upload (linked employee)

### Hangup Backup (companion app)

Separate Electron entry for Admin/RTM:

- Full database + storage backup
- Or sales Excel export + recordings/confirmations archive
- Run via `npm run backup` on authorized machines

---

## Appearance & user experience

- Seven themes: Light, Dark, Grey, Dark wine, Dark grey, Alabaster, Girly pink
- Shared design tokens — badges and statuses render correctly in every theme
- Full button system with hover, focus, disabled, and loading states
- Polished tables: sticky headers, zebra rows, styled empty states
- Modal animations; styled confirm dialogs (no browser popups)
- Redesigned login with animated background and password visibility toggle
- 3-step registration wizard with approval-pipeline explainer
- Honors Windows **reduced motion** preference; keyboard focus rings
- Remember password on login (optional, device-only)

---

## Technical stack (for stakeholders)

| Layer | Technology |
|-------|------------|
| Desktop shell | Electron |
| UI | HTML / CSS / JavaScript |
| Local API | Express (loopback) |
| Local cache | SQLite (`better-sqlite3`) |
| Cloud DB | Supabase (PostgreSQL) |
| File storage | Supabase Storage |
| Auth | Custom `app_users` + bcrypt |
| Builds | electron-builder (NSIS + portable; macOS DMG) |
| Updates | GitHub Releases (patch + full zips, manifests) |

---

## Deployment model

1. Apply pending Supabase migrations (`npm run apply:migrations`)
2. Build installer on dev machine (`npm run dist:all` or `.\scripts\build.ps1 all`)
3. Mark version in Supabase `app_versions`
4. Distribute installer via USB, shared drive, or web bootstrap EXE
5. Users sign in — first run syncs all data
6. Optional: publish GitHub release for in-app updates (see [`UPDATES.md`](UPDATES.md))

*Installers are ~90–130 MB; updates are not pushed through Supabase Storage.*

---

## Module map (sidebar)

| Area | What it covers |
|------|----------------|
| Dashboard | KPIs, expiry alerts, sales summaries |
| Employees | Profiles, compliance, documents, lifecycle |
| Attendance | Monthly grid, FP import, holidays |
| Payroll | Engine, payslips, lock, MoM, training tabs |
| Bonuses / Deductions / Loans / Salaries | Payroll inputs |
| Reports | HR reports, rankings, custom reports |
| Costs | Expenses, petty cash, bills |
| Requests | Leave and time-off approvals |
| Equipment | Asset registry and assignments |
| Organization | Units, teams, rosters, registrations |
| Sales | Log, forms, quality tickets, export |
| Sales permissions | Field-level ACL (Admin / RTM) |
| Log columns | Sales list column visibility |
| Access Control | App-wide role permissions (Admin) |
| Users | App logins (Raymond) |
| Changes | Audit log export (Admin / CEO) |
| Settings | Theme, catalog, holidays, routing, sync |

---

*Last updated for release **1.6.14** · Detail: [`CHANGELOG.md`](CHANGELOG.md) · Updates: [`UPDATES.md`](UPDATES.md) · User guide: [`TUTORIAL.md`](TUTORIAL.md)*

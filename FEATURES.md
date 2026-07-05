# Hangup Portal — Feature Overview

> **Data backend:** Supabase only. **Do not use Google Sheets.** See [`LEGACY_GOOGLE_SHEETS.md`](LEGACY_GOOGLE_SHEETS.md).

*Presentation-style summary of what the app does today.*  
**Version:** 1.6.6 · **Platform:** Windows + macOS desktop (Electron)

---

## What is Hangup Portal?

Hangup Portal is an all-in-one **HR operations desktop app** for a call-center / BPO-style workforce. It replaces scattered spreadsheets with one place to manage:

- Who works here  
- Whether they showed up  
- What they earn each month  
- HR compliance, documents, and discipline  

Data lives in **Supabase** (cloud). Each PC keeps a **local copy** so daily work stays fast even on average internet.

---

## Who uses it?

| Role | Typical user | What they do |
|------|--------------|--------------|
| **HR / Admin** | Aurora, Eva, Phoebe | Employees, attendance, payroll, documents, lifecycle |
| **CEO / Admin** | Mark, Raymond | Full access, audit log, finance exports, user management |
| **Finance** | Finance team | Payroll review, tax config, payment exports |
| **Team leads** | TLs | Attendance for their unit |
| **Agents** | Staff | Read-only view of their data |

---

## Core platform

### Reliable by design

- **Cloud source of truth** — Supabase Postgres; one database for all HR PCs  
- **Fast local cache** — SQLite on each machine; no waiting on every click  
- **Auto sync** — saves push to cloud, then refresh quietly  
- **Audit trail** — every important edit logged (`change_log`)  
- **Version control** — old app builds can be blocked at login (`app_versions`)
- **In-app updates** — GitHub Releases patch/full zips; checked for **all users** (not role-gated)
- **Desktop UX** — in-app modals replace broken Electron `prompt()` / `confirm()` (beta.6)
- **Role-based access** — CEO, admin, HR, finance, TL, agent  

### Security

- Passwords hashed (bcrypt)  
- Server-side API only — secret key never exposed to the browser layer  
- Row Level Security on database (deny public access; app server bypasses)  
- Session timeout after 10 minutes idle (client); server revokes after **10 hours** idle  
- **One active session per user** — signing in elsewhere revokes the old device  
- Session ID shown in Settings (for support)  
- Raymond can revoke active sessions  

---

## Employee management

### Profiles

- American & Arabic names, ID, unit, team, position  
- Payment method (cash, bank, Instapay / wallet)  
- Profile photo  
- Promotion history (former IDs, effective month)  

### Nationality & compliance *(new)*

- **Nationality** with quick picks: Egyptian, Sudanese  
- **Non-Egyptian** → work permit status (have / don't have)  
- **Egyptian** → social insurance (insured / not insured)  
- Optional insurance details: type, amount, employee deduction  
- **Filter** employee list by nationality, permit, and insurance  

### Employment lifecycle

- **Employment periods** — start, depart, re-hire; gap months excluded from attendance  
- **Onboarding checklist** — AD user, ID scan, contract, training phases 1–4  
- **Offboarding** — revoke access, final pay  
- **Clearance** — handover form, equipment, files  
- **Equipment** — asset registry and who has what  

---

## Attendance

- Monthly grid per employee and day  
- Statuses: Attended, Half Day, Quarter Day, NSNC, Lateness A/B, Day-OFF, and more  
- Unit / team filters  
- Working days per month (auto or manual override with audit note)  
- **Federal holidays** — pink columns, no payroll penalty  
- **Bulk actions** — init weekends, mark weekdays attended  
- Transport allowance override on eligible statuses  
- **Guards** — no edits after depart or outside employment period  
- **Month lock** — payroll-finalized months cannot be edited  
- **Access control (1.6.6)** — sales edit/approve/export and dashboard unit toggles respect Access Control; dual-role TL via org `tl_employee_id`; team dashboard role scope + weekend DAY-OFF; org agent privacy; equipment issue to any employee  

---

## Payroll & compensation

### Monthly payroll engine

- Position-based basic salary  
- Attendance-driven days (NSNC, half days, lateness penalties)  
- Bonuses and deductions (many types)  
- Sales commission tiers (stackable)  
- Transport allowance (from configured month)  
- Loan installments  
- Extra days, 2-week hold, per-employee adjustments  
- Tax lines (structure ready; rates default 0%)  

### Payslips

- PDF per employee per month  
- Bonus and deduction line items  
- Action Improvement Plan section when applicable  
- Offboarding / clearance banners when pending — with links to complete workflows
- **No payroll** month toggle for excluded employees
- **Per-split PDF** export and **splits ZIP** for commission breakdowns

### Action Improvement Plan (AIP)

Discipline week (Mon–Fri) with payroll consequences:

- Lateness A fixed at **75 EGP**  
- Day-OFF → **3 salary days** deducted  
- **All other deductions in that week × 3**  
- Visible on payslip with week dates and explanations  

### Payroll controls

- **Month lock** — finance sign-off; blocks further edits  
- **MoM compare** — net pay vs previous month + anomaly flags  
- **Finance handoff ZIP** — payroll CSV + all payslip PDFs + change log  
- Payment exports: **Cash**, **Bank**, **Instapay** (CSV + PDF)  

### Training payroll (1.6.0+)

- **Three payroll tabs** — Main (agents), Training (trainees), Total (payments due/received in month)
- **Fixed trainee pay** — **12,000 EGP/mo**, **20 days**, **600 EGP/day**, **3,000 EGP/week** (not Salaries ÷ working days)
- **Single training payslip (1.6.3)** — one consolidated training payroll per program on the anchor month, even when training spans two calendar months
- **Pay units (1.6.1+)** — trainee basic = eligible phase attendance day-units × 600
- **4-week program** — Phase 1 unpaid; Phase 2–4 trainee rate when phase passed  
- **12 passed sales** (4 per evaluation phase) + HR **Promote to Agent**  
- **Dual payslip** same month when promotion mid-month: Training tab + Main tab; separate PDFs  
- Outcomes: failed (partial phase 2 pay), agent left (zero), company terminated (phase rules)  
- Split kind **training_payroll**; agent payroll due **15th of next month**  
- Resignation: notice-period pay scale (5–10 sales); no-notice 10-day deduction  

### Training payroll (1.5.0 — superseded by 1.6.0 split)

- Original dual payslip + Trainee Salaries rate model replaced by fixed 12k/20/600 in 1.6.0

---

## Time off & calendar

- **Leave requests** — annual, sick, unpaid, other  
- Approval queue for **Mark, Raymond, Phoebe**  
- Approved leave → automatic Day-OFF rows in attendance  
- **Federal holidays** CRUD in Settings (default country USA)  

---

## HR discipline & documents

### Warnings

- Verbal / written warnings and notes on employee profile  
- Escalation levels: **1st**, **2nd**, **final**  
- Link to Warning Letter document type  

### Documents

- Types: National ID, Contract, Medical, Exam note, Training, etc.  
- Stored in **Supabase Storage**  
- Expiry tracking + dashboard alerts (30 / 60 days)  
- **No expiry** flag  
- Bulk **ZIP export** per employee  

---

## 1.3.1 highlights

- **Sale attachments → Supabase** — recordings and confirmations in `hr-documents` / `sales-attachments/`; signed share links (no Dropbox in app)
- **Legacy migration** — `npm run migrate:sale-attachments` (one-time; needs valid `DROPBOX_ACCESS_TOKEN`)
- **Multi-version patch updates** — GitHub releases ship patch zips from several prior versions (not only N−1)

## 1.3.0 highlights

- **Sales export** — CSV, Excel, or PDF for filtered sales or a single sale
- **Quality ticket audio** — reliable inline playback, download, signed share links
- **Sales catalog** — RTM/Admin edit clients, devices, price tiers; TL/OP must use catalog when configured
- **App users search** — filter by username, name, employee ID, email, team
- **Equipment** — agent picker toolbar + deep links (`#equipment?employee=HS3-08`)
- **UX** — sticky table headers, zebra rows, clearer toolbars

## 1.2.0 highlights

- **Sales catalog in Settings** — clients, products, device types, and prices (replaces hard-coded lists)
- **Break schedules** — timed break reminders with dismissible popup
- **Session ID + single-device login** — one active session; 10h server idle revoke
- **Remember password** on login (optional, device-only)
- **Sale attachments** (legacy) — were on Dropbox until 1.3.1 migration
- **GitHub updater** — patch/full zips for Windows and macOS

## 1.1.0 highlights

- Full sales import from `Asset/Sales All Data.csv` (`node scripts/import-sales-all-data.js`)
- Month-scoped position rates on Salaries (per-month snapshots)
- Sale reviewer/verifier/agent assignment notifications
- Payslip sales count recalc from sales; OUT clearance warning on open

## 1.0.9-beta.7 highlights

- **Supabase-only runtime** — Google Sheets code removed from app startup
- **Session fix** — no more false “access changed” kick every 5 minutes
- **Sales:** Employee dropdowns for reviewer/verifier; agent/closer locked on edit; month filters
- **Payroll splits:** Training bonus type; defer with custom amount (max = gross payable)
- **Federal OFF:** Batch day-off without Sheets API calls

## 1.0.9-beta.5–6 highlights

- **OUT / depart:** worked-in-month payroll eligibility, auto-OUT after depart date
- **Federal holidays:** bulk day-off for active employees on configured holidays
- **Release app ID:** rewrites foreign keys with confirm modal + loading state
- **HS-2 scope:** bonuses, deductions, org filtered by company context toggle
- **Users:** activate inactive employee logins; owner accounts protected
- **GitHub updates:** universal check on boot, login, session poll, visibility change
- **UI polish:** theme-safe animations, modal/button feedback

## v1.0.6 highlights

- **Sales edit** + day/week/month dashboard with status filters  
- **Costs** receipts upload, petty cash deposit/pay modals, ledger  
- **Attendance** sticky columns, per-agent month Attended, holiday prefill on init  
- **Federal holidays** USA 2024–2028 import, year accordion, active toggles  
- **Reposition** agents (replaces Promote + Promoted status)  
- **Organization** live team rosters · **Equipment** add/assign/return  
- **Action Plan Week** (formerly AIP) · lifecycle modals  
- **Payroll** hide zero net · **Nationality** dropdown + aliases  

## RBAC & privacy (1.4.3+)

- **IT role** — full equipment inventory (with HR/Admin); assign on **Users** page and tune in **Access Control** (1.4.4 syncs assignable roles with catalog)
- **Reposition / app ID (1.4.5)** — HR/IT/RTM moves set correct backend ID pool; optional **Enforce unit / role ID prefix** on Reposition and Change app ID
- **Sales log (1.4.6)** — fixed blank/error opening Sales log (`PERIOD_LABELS` ReferenceError since 1.4.3); empty advanced filter rules no longer hide all rows
- **Attendance** — agents read-only; transport allowance controls HR/Admin only
- **Bonuses / deductions** — TL bonus source and TL/OP transfer sections restricted by role
- **Employees** — nationality & compliance fields/filters HR/Admin only (self-view for own record)
- **Organization** — TL/OP scoped to own unit; no unassigned bucket
- **Equipment** — full (IT/HR/Admin), unit (OP), or self-only
- **Sales UI** — Reviewer + Client status only; workflow status hidden; stat cards gated by column view
- **Reports / App Users** — permission-gated nav

## Sales (1.4.1–1.4.3)

Full reference: [`SALES_LOG.md`](SALES_LOG.md)

- Per-sale records with **dynamic MLA-Ray form** (all fields in `form_data`)
- **Edit prefill (1.4.2)** — Client/Device/Price preselected on edit; catalog IDs persist through saves; legacy sales matched by name/device/price (backfill script included)
- **Log columns** — admin enables any catalog field + Day/Time/Agent/Closer/Customer columns; intersected with role view ACL
- **Advanced filter** — AND/OR/NOT rules; dropdown values for IDs, clients, teams, statuses; logic shown only with 2+ rules
- **Toolbar filters** — Client, Agent (dialing only), Closer, Client status, Reviewer status on day/week/month views
- **Stat cards** — client status counts when user can view Client status column
- **Working day** — sales until 1 AM Cairo → previous day; Day + Time columns; payroll `sales_count` auto-recalc
- **Bank payment fields** — routing, bank name, account number, address, who chose bank account
- **Verifier feedback** / **Client feedback** — labeled **Reviewer status** / **Client status** in UI
- **Sales permissions** page (role-first) — RTM / Admin only
- **Log columns** page — enable/disable list columns (separate from Access Control)
- **Field-level permissions** — main view, quality ticket, edit surfaces
- **Supabase attachments** — recordings and confirmations; signed share links
- **Export** — CSV, Excel, or PDF for filtered list or single sale
- Statuses: **passed**, **pending**, **postdated**, **denied**, **callback**
- TL/OP submissions; quality/RTM/HR/admin approval workflow
- Role-scoped visibility + optional cross-team grants

## Sales (legacy 1.0.5–1.4.0 notes)

## Bonus approval (1.0.5)

- TL/OP/quality/RTM **request** bonuses for agents  
- HR/admin **approve** → posts to `bonus_events`  
- Leadership roles receive bonuses via **payslip only**  

## Costs & petty cash (1.0.5+)

- Receipts/invoices with status workflow (paid, pending, on hold, archived)  
- Petty cash fund + ledger (deposits editable after posting as of `1.0.9-beta.3`)  
- Monthly bills (landline, internet, utilities, etc.)  
- Access: Mark, Phoebe, Raymond, finance role; HR can submit  

---

## Reporting & admin

| Report / tool | Output |
|---------------|--------|
| Monthly HR report | PDF + Markdown |
| Headcount & turnover | In-app summary |
| Attendance rankings | NSNC / lateness CSV |
| Finance handoff | ZIP (payroll + payslips + changelog) |
| Change log | Full audit + CSV export |
| Notifications | Bell — leave pending, doc expiry, system |

### Notification center (1.3.13)

- **Top-bar bell** — always visible; unread badge count; optional sound on new unread items  
- **Full modal** — scrollable history (nothing deleted); mark read / mark all read  
- **Click to navigate** — sale → Sales; leave → Requests; bonus → Bonuses; HR/quality notes → employee modals  
- **Configurable routing** — Admin/RTM set recipient roles per action in Settings → Notification routing  
- **Default routes:** leave → HR/Admin; agent sale → RTM/Quality; sale pending → HR/Admin/Quality/RTM; bonus request → HR/Admin/OP; notes → HR  

### HR notes vs quality notes (1.3.13)

- **HR notes** (`employee_warnings`) — HR/Admin add/edit/delete; TL/OP/Quality use quality notes instead  
- **Quality notes** (`employee_quality_notes`) — Quality/TL/OP add; Quality edits own; HR/Admin full control; HR notified on create  

### User administration

- **Raymond** — Users tab: create users, roles, passwords, email, status  
- **Purge user & release ID** *(Raymond/Mark)* — remove login and free employee ID (`DEL-…` placeholder keeps history)  
- **Sessions** — view and revoke active logins  
- **Change password** — any logged-in user in Settings  

---

## Appearance & UX

Seven color themes (saved per device):

Light · Dark · Grey · Dark wine · Dark grey · Alabaster · Girly pink

Same layout everywhere — only colors change.

**1.4.2 design overhaul:**

- Shared design tokens (spacing, radii, theme-aware surfaces and badge tints) — every theme renders badges and statuses correctly
- Full button system: primary, secondary, outline, success, danger, ghost, icon — with hover, active, focus, disabled, and loading states
- Polished tables: refined headers, styled empty states, smooth content fade-in
- Modal enter **and exit** animations; styled confirm dialogs replace browser popups in key flows
- Redesigned **login page** with animated background, password visibility toggle, and inline error feedback
- **3-step registration wizard** (PIN → details → success) with an approval-pipeline explainer
- Honors Windows **reduced motion** preference; consistent keyboard focus rings

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
| Builds | electron-builder (NSIS installer + portable) |

---

## Deployment model

1. **Apply pending Supabase migrations** (agent: MCP `apply_migration` or `npm run apply:migrations`)
2. Build EXE on a dev machine (`.\scripts\build.ps1 all`, or `SKIP_NATIVE_REBUILD=1` when prebuilt natives exist) — **primary distribution**
3. Mark version in Supabase `app_versions`
4. Copy installer or portable to HR PCs (USB, shared drive)
5. Users sign in — first run syncs all data
6. *(Optional)* Publish GitHub patch release — **always run `npm run verify:update`** on zips first; see [`UPDATES.md`](UPDATES.md)

*App updates are not pushed through Supabase Storage (installers are ~90 MB each).*

---

## Roadmap already delivered (1.0.4–1.0.5)

✅ Employment lifecycle & re-hire  
✅ Action Improvement Plans  
✅ Leave & federal holidays  
✅ Payroll month lock & compare  
✅ Onboarding / offboarding / clearance / equipment  
✅ Nationality & compliance fields  
✅ Document expiry & ZIP export  
✅ Notifications & audit export  
✅ Change password & session registry  
✅ Commission types UI  
✅ **Bonus approval workflow** (1.0.5)  
✅ **Sales tracking & dashboard** (1.0.5)  
✅ **Costs, petty cash, monthly bills** (1.0.5)  

---

## One-line pitch

> **Hangup Portal** is a fast, offline-friendly desktop HR system that keeps your workforce, attendance, and payroll in sync with the cloud — built for real operations teams, not generic HR software.

---

*Last updated for release **1.2.0** · See [`CHANGELOG.md`](CHANGELOG.md) and [`UPDATES.md`](UPDATES.md).*

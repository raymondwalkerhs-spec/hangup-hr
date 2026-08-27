# Hangup Portal — Feature Overview

> **Data backend:** Supabase only. **Do not use Google Sheets.** See [`LEGACY_GOOGLE_SHEETS.md`](LEGACY_GOOGLE_SHEETS.md).

*Board-ready summary of what the application does today.*

**Version:** 2.4.9 · **Platform:** Windows + macOS desktop (Electron)

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

### New in 2.4.9
- **Turtle Grove** premium theme — moss/earth art; spinning turtle loader; slow turtles on `/cats`.
- **Unlock tiers** — Gotham / Hello Kitty / Spiderman at 10 RPM sent or 10 closed; Turtle Grove at 15 sent or 15 closed (Admin/CEO/HR always unlocked).

### New in 2.4.8
- **Checks:** one live MCN per company + working day (any agent) — duplicate same-day submit blocked (**409**); re-status via edit.
- **Forms:** **Wrong MCN**; digits-only phones; letters-only names (Checks, Q Feedback edit, RPM + emergency name).
- **RPM Add sale:** red glow on empty requireds after submit; soft ConfirmDialog on prior MCN/phone (Quality/RTM/Admin notify).
- **Sale ↔ Q:** same working day only; disposed Q may become Sale; Q closer copied from sale.
- **Airtable RPM:** live sync via Supabase Edge Function (not the desktop app).

### New in 2.4.7
- Dead form fields / Electron `confirm` residue fixed; Employee Out lag + depart date wiring; deductions/bonuses Edit+Delete; Select search lag in dialogs; RPM Airtable Client RPM3; Import from open Q closer scope.

### New in 2.4.1
- Coaching page loads on the production bundle (TDZ fix). Org can edit a pending agent’s unit then approve (`HS1-…` from HS-1). Agent/Closer search works under 10 people. **Other (unassigned)** sales glow on the Sales log. Cloud patches after this GitHub baseline — see [`PUSH_UPDATE.md`](PUSH_UPDATE.md).

### New in 2.4.0
- Dropdowns (including RPM Add sale agent/closer/client lists) click, search, and scroll inside dialogs.

### New in 2.3.29
- Hotfix over 2.3.28: app starts, DNA login renders, workspace shell loads (missing `CatsPage` / `PageLoadingOverlay` imports, IT PATCH `await`).

### New in 2.3.28
- Shared **Select** (search at 10+ options), sidebar label fade, dialog 250/150ms motion
- **Cats** playground (`/cats`) — no HR data
- **Recycle bin** (20 days) for announcements, coaching, IT, pending leave, and attachments
- Drag-and-drop **uploads** with progress; confirm + 6s undo on deletes
- RPM **Member ID** pattern `NLAN-LAN-LLNN` (display `XXXX-XXX-XXXX`)
- Attendance **drag-select**; sales **period picker** (Quality/HR/RTM/Admin/OP/CEO)
- Agent **Payroll** tab for released payslips; dashboard Net payroll blur-until-double-click
- Full **transport grant** on payslip; bonus/deduction notices to the employee
- **Reconnect** banner (Live / Reconnecting / Offline); agent first-login guide

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
- Payment method: **cash**, **instapay**, **bank** (canonical keys; synced to payroll profiles)
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
- **Offboarding** — interactive table of leavers; click Revoke access / Final pay in the row. Final pay stays locked until clearance is complete.
- **Clearance** — separate table of Out / departed staff: click Form / Files in the row; devices follow live assignments. Payslip banners link here.
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
- **OUT depart prompt** — marking OUT asks leaving type (with notice / without notice / company decision) and depart date; **Clear depart date** undoes a mistaken depart
- **Legacy OUT visibility** — leavers 2+ months ago with no pay hidden by default; **Show legacy employees** in Settings
- **Hide OUT** tab toggle — reveals previous-month leavers only (not legacy)
- **Pause** — grid `paused` fills Mon–Fri; approved pause requests write `paused` (counts as day off)
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
- **Payroll grid (unified list)** — One screen for agents, trainees, and dual (Training + Agent) rows; columns: working days, sales, commission, basic salary, loans, transportation, bonus (excl. commission & transport), deductions, net salary — each row matches the payslip breakdown; stat tiles and footer totals sum the **filtered** visible rows
- **Net salary column** shows remaining unpaid net (0 when paid/Done); earned amount still visible as subtitle on settled rows
- Bonuses and deductions (many types, including sales commission tiers)
- Transport allowance (from configured month)
- Loan installments
- Extra days, 2-week hold, per-employee adjustments
- Tax lines (structure ready; rates default 0%)
- **No payroll** month toggle for excluded employees
- **Hide zero net pay** — hides rows with current display net = 0 (paid remaining, deferred, or truly zero)

### Payslips

- PDF per employee per month
- Bonus and deduction line items
- Action Improvement Plan section when applicable
- Offboarding / clearance banners with links to complete workflows
- **Per-split PDF** export and **splits ZIP** for commission breakdowns
- Sales count auto-recalculated from sales log
- **Extra payroll entries** — manual additions with custom label, working days, and daily rate; net amount auto-calculates or can be overridden; each entry exportable as a standalone PDF

### Action Improvement Plan (AIP)

Discipline week (Mon–Fri) with automatic payroll impact:

- Lateness A fixed at **75 EGP**
- Day-OFF → **3 salary days** deducted
- **All other deductions in that week × 3**
- Visible on payslip with week dates and explanations

### Training payroll

- **Unified payroll list** (since 2.3.8) — agents, trainees, and dual promotion months on **one** payroll screen (not separate Main/Training tabs in the React UI)
- **Fixed trainee pay** — 12,000 EGP/mo, 20 days, 600 EGP/day, 3,000 EGP/week
- **4-week program** — Phase 1 unpaid; Phases 2–4 paid when passed
- **12 passed sales** required (4 per evaluation phase) + HR **Promote to Agent**
- **Dual payslip** when promotion mid-month: Combined / Training / Agent tabs in payslip dialog; separate PDFs
- Outcomes: failed, agent left, company terminated — each with defined pay rules
- Resignation: notice-period pay scale (5–10 passed sales → 50–100% basic); no-notice 10 working days + transport deduction; company decision full pay
- **Training phase 1 pay exception** — optional HR override on payslip
- Cross-month training: monthly breakdown lines + week-1 withheld when sales target not met
- **HR anchor month override** (v2.3.15) — on training/deferred payslips, set which month training net pays out; pre-anchor accrual months show zero net until anchor
- **Training enrich warnings** (v2.3.15) — payroll page banner when training rows need HR review

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

### Sales programs (MLA & RPM)
- **MLA** — legacy MLA-Ray sales in `sales` + `sales_attachments`; storage `mla-sales-attachments/{saleId}/…` (legacy `sales-attachments/…` still supported)
- **RPM** — separate program in `rpm_sales` + `rpm_sales_attachments`; storage `rpm-sales-attachments/{saleId}/…`
- **Quality records** — each program uses its own root + `quality_record/` subfolder (never shared)
- Employee flags `sales_mla_enabled` / `sales_rpm_enabled` (unset = both allowed; closers/TLs bypass); client catalog filtered by `sale_program`; payroll counts split (`sales_count_mla` / `sales_count_rpm`)
- **+ Add sale** shows MLA/RPM picker when the user can submit both

### Sales log
- **Default program** — Opens on **RPM** (MLA tab still available)
- **Search** — Customer name or phone (primary / alternative), digit-normalized
- **RPM filters & sort** — Sort for all RPM viewers. Team / agent / closer / day / client / reviewer / client-feedback filters are **Quality, HR, RTM, Admin, OP, CEO only** (not Agent or TL). Team list is company-scoped **dialing** teams (no HS-2 on Hangup, no HR/Quality). Agent and closer lists are people already on the loaded sales; HR/Quality staff (e.g. Phoebe) are not closer options.
- **Edit history** — Quality / RTM / Admin / CEO History panel on View / Edit / Quality (portal-owned, not Airtable)
- **Submission correction** — Admin / RTM / CEO can correct MLA and RPM Cairo date+time (working day uses 3 AM grace)
- **Roster freshness** — Submit-scope / auth refresh employee teams so dialing pickers stay current
- Sorted by **submission date + time** (newest first)

- **RPM quality ticket** — Editable quality workflow for Quality, RTM, Admin only; agents/TL/OP use View sale (field visibility via Sales permissions). Reviewer accepts live Quality role (including HR-2 after HR→Quality). **Internal feedback** is not on Add sale; Quality / RTM / Admin see it on View, Edit, and Quality ticket; Admin / RTM edit by default (Sales permissions).
- Per-sale records with dynamic MLA-Ray form (all fields in `form_data`) for MLA; RPM has its own form and field catalog
- Day / week / month dashboards with status filters and stat cards
- **Working day rule** — sales until 3 AM Cairo count on previous day
- **RPM Checks + Q Feedback** — `/checks`, `/q-feedback`, Duplicate separated list; Team Dashboard checks KPIs + notes; Day-OFF excluded from target N; main Dashboard cards; auto-link Sale ↔ Q **same working day** (disposed Q may become Sale); **one live MCN per company+day** (409 if duplicate); **Admin/OP can edit** Q Feedback rows with same MCN/phone/name rules; **TL** sees own/team Q Feedback only; closer-target editor OP/RTM/Admin only; Checks: **Q** needs name+DOB, other statuses agent+member+phone only; RPM create: red glow on empty requireds + soft warn on duplicate MCN/phone (Quality/RTM/Admin notify); optional Airtable **Q Feedback** (completed) + **NQ Checks** (NQ / Age limit / Duplicate / Under Age)
- **Hide all OUT** — Employees / Payroll / Attendance toggle for TL/HR/RTM/Quality/Admin/OP (includes outs who worked this month)
- **Bonuses / deductions** — Add bonus & Add deduction are HR/Admin only; others use Request bonus
- Toolbar filters: client, agent, closer, client status, reviewer status
- **Advanced filter** — AND / OR / NOT rules with dropdown values
- **Log columns** — admin enables catalog fields + standard columns; intersected with role view ACL
- Statuses: passed, pending, postdated, denied, callback
- TL/OP submission; Quality / RTM / HR / Admin approval workflow

### Organization & registration

- **Organization** — unit → team → agent; **Edit teams, TLs & closers** dialog (HR/Admin); separate **TL** (leave + IT on behalf) and **Closer** (sales + IT on behalf, team dashboard) assignments; inline TL/OP/closer/team pickers; `canManageOrg` permission wired from API
- **Released IDs** — deleting/releasing an employee frees the app ID (e.g. **TL08**) for reuse
- **Registration approve** — optional team picker from active org teams per unit; default unassigned

### Sale forms & tickets

- **Add sale** — dedicated submit surface: full editable form (not Sales permissions ACL); role-scoped unit/team/**agent**/**closer** pickers (agents: self + team TLs; org closers: pick closer teams then agents, self default closer; TL: lead + closer teams; OP: any). Non-dialing home teams (e.g. Management) are not locked; sale unit/team follows the selected agent. No quality section on create; **no attachments section** on create; **draft auto-save** (MLA and RPM) and **Clear all** (MLA); **Airtable-aligned required validation**; double-submit prevention
- **Edit sale** — field visibility and edit rights from Sales permissions; **Delete sale** (Admin/RTM); **reassign unit/team/agent/closer** (Admin/RTM/CEO)
- **View sale** — read-only detail modal (Access Control **View sale**); fields from Edit sale tab
- **Quality ticket** — separate surface with its own view/edit grants; assigned OP/TL verifiers can update reviewer status when permitted; **reassign unit/team/agent/closer** for Admin/RTM/CEO. Access follows the **current** login role in Users (not a stale session role from before a transfer).
- **Sales catalog** — clients, devices, price tiers (Settings); TL/OP must use catalog when configured
- Payment method toggle — card vs bank sub-fields
- **Reviewer status** / **Client status** (verifier feedback / client feedback)
- Cross-unit agent and closer display names on list and forms

### Attachments & export

- Attachments in **Supabase Storage** (`hr-documents` bucket): MLA → `mla-sales-attachments/…`, RPM → `rpm-sales-attachments/…`; quality recordings under `{root}/{saleId}/quality_record/`
- **Airtable sync (optional)** — MLA: existing base / `AIRTABLE_TABLE_NAME`; upsert by **Portal Sale ID**. RPM: **Hangup RPM base** (`AIRTABLE_RPM_BASE_ID`) with **RPM Sales**, **Q Feedback** (completed), **NQ Checks** (form phone only). Live sync is **Supabase → Airtable** (DB trigger + Edge Function `airtable-rpm-sync`); deploy `npm run deploy:airtable:rpm-sync`. Manual backfill: `npm run sync:airtable:rpm`.
- Inline audio/video playback (recording, raw call, quality record), download, signed share links
- Attachment view/upload gated per role (Sales permissions **Attachments** tab)
- **Recordings** hidden from Agent and TL (no UI, list, or upload); Quality/RTM/admin manage recordings
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

## Announcements & coaching

### Announcements
- Sidebar **Announcements** (Overview) — posts for the **current company only** (Hangup vs HS-2); RBAC: `viewAnnouncements` all roles, `editAnnouncements` HR/RTM/Admin/CEO
- Audience: **whole company**, or targeted by **multiple units**, **multiple teams**, and/or **multiple roles** (AND across filters; editors still see all posts)
- Picture placement: **above**, **middle of**, or **below** the text
- New posts also go to the **notification bell** for matching users; sidebar **Announcements** shows an unread count that clears when you open a post
- Everyone with app access can read matching posts; **HR / RTM / Admin / CEO** create, edit, and delete
- Title list → open full post: formatted body, picture, optional audio player
- Access Control: `viewAnnouncements` (all roles) / `editAnnouncements` (HR, RTM, Admin, CEO)
- Storage: `hr-documents` → `announcements/{company}/{id}/…`

### Coaching
- Sidebar **Coaching** (People) — tickets with **coach**, **submitted by**, **outcome**, date/time, general notes, and secret notes
- **Agent (coachee):** active agents only (not Out). Nobody can coach HR / Quality / Admin.
  - TL → own team agents (not other coaches)
  - Closer → closer-team agents (not other coaches)
  - OP → unit agents **and** unit TL / Closers
  - Quality / HR / Admin → company agents
- **Coach:** TL / Closer default to themselves (cannot reassign). Quality defaults to self / quality team and may pick **OP**. OP defaults to self and may pick unit TL / Closer / OP / agents. HR defaults to self, may pick TL / Closer / OP / Quality. Admin defaults to self, may pick any coach or agent (including OP).
- **Outcome:** pending / positive / negative / normal. Coach can update outcome after the session and add extra notes; cannot edit original notes or delete.
- **Secret notes:** HR / Quality / Admin (plus coach/submitter on their ticket). Agents never see secrets.
- **Date/time + delete:** Admin / CEO only (HR cannot delete)
- Filters: date, agent, coach, outcome, agent active/out, team
- Access Control: `viewCoaching` / `submitCoaching` / `viewCoachingSecret`

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

- Company asset registry (`asset_tag` + type: Mouse / Keyboard / Laptop / Workstation / Headset / Phone / Mini router)
- Assign and return devices (IT / HR / Admin / CEO); OP sees own unit inventory
- Agents and other non-inventory roles see the tab **only while they have an unreturned device**
- Search by name or ID; payslip / clearance deep link `?employee=`
- Issue picker: searchable **active** employees; unit taken from the employee
- Company isolation (Hangup vs HS-2) on the `equipment.company` column
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
- Units count for HR / Admin / CEO / Quality / OP; TLs and closers see **Teams you close** instead
- Document expiry summary
- Team and company sales dashboards (role-scoped)
- **Sales this month** — Sales per calendar day for the selected month, scoped by role (agent = own; TL = team; closer = closed; OP = unit; RTM / Admin / Quality / HR = company)
- **Team dashboards** — daily/weekly RPM sales + Checks KPIs (Q/NQ/Age/Under Age/Duplicate); notes; Day-OFF out of target N; TL extra-team grants; agents own team only
- **RPM weekly performance** — on main Dashboard (default Admin / RTM / Quality / OP / TL): Mon–Fri week cards ranking closers, agents, and clients by american name; count mode Passed / Passed+Pending / All; per-team weekly targets with overachieve % colors. TL / dual-role TL: own led team(s) only, view-only targets. OP: unit scope (may edit targets). Access Control: `viewRpmWeeklyDashboard`, `editRpmWeeklyTargets`.
- **Attendance tiles** — Day off, NSNC, Half day, and WFH counts for the same employee scope
- **HS-2 company isolation** — Binary company model (`hangup` vs `hs2`). **Managing** toggle (top-left sidebar) for admin/ceo/hr only (`manageHs2Company` is hard-denied for OP / TL / agent). Native HS-2 staff stay on their unit with no switcher. `?company=hs2` denied unless the user can access HS-2. HS-2 sales/data visible **only** in HS-2 company context (strict — not on Main Hangup tab).

### Reports

| Report | Output |
|--------|--------|
| **Analytics** | Leave, costs, sales, and training widgets with company scope (v2.2.0) |
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

- Free themes plus premiums: **Gotham Night**, **Hello Kitty**, **Spiderman** (10 RPM sent or 10 closed), **Turtle Grove** (15 sent or 15 closed); includes **Emerald** (jade on mint)
- **Page loading overlay** — cat orbit by default; **spinning turtle** under Turtle Grove. `/cats` playground shows cats, or slow turtles on Turtle Grove
- Federal holidays, tax rules, break schedules (timed pop-up reminders)
- Sales catalog (clients, products, prices)
- Notification routing (includes **new agent registration** and **RPM duplicate phone / Member ID**)
- Live 5s refresh on Dashboard, Payroll, Attendance, Sales log, and the notification bell (only the page you are on; unchanged data does not re-render)
- RPM Sales: **Show duplicates** checkbox; Admin/RTM can **delete** RPM sales; phones digits-only on submit
- Sync controls, hide-out-employees toggle, session ID
- Profile photo upload (linked employee)

### Hangup Backup (companion app)

Separate Electron entry for Admin/RTM:

- Full database + storage backup
- Or sales Excel export + recordings/confirmations archive
- Run via `npm run backup` on authorized machines

---

## Appearance & user experience

- Themes: Hangup Light, Hangup Dark, Violet, Pink, Red Wine, Diamond, **Emerald**
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

1. Apply pending Supabase migrations (`npm run apply:migrations`) — v2.2.0: `password_changed_at`, training status v2, expense `category`
2. Set strong `SESSION_SECRET` in `.env`; copy to `userData/HangupHR-data/.env` on each PC after install
3. Build installer on dev machine (`npm run dist:all` or `.\scripts\build.ps1 all`; use `HR_RELEASE_BUILD=1` to enforce secret)
4. Mark version in Supabase `app_versions`
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
| Interviews | Candidate interview workflow (1st/2nd interview, training handoff) |
| Training | Active training candidates, feedback, test-call metrics |
| Attendance | Monthly grid, FP import, holidays |
| Payroll | Engine, payslips, lock, MoM, training tabs |
| Bonuses / Deductions / Loans / Salaries | Payroll inputs |
| Reports | HR reports, rankings, custom reports, **Analytics** |
| Costs | Expenses, petty cash, bills |
| Requests | Leave and time-off approvals |
| Equipment | Asset registry and assignments |
| Offboarding | Leaver table — revoke access, final pay |
| Clearance | Leaver table — form, devices, files |
| Organization | Units, teams, rosters, registrations |
| Sales | Log, forms, quality tickets, export |
| Sales permissions | Field-level ACL (Admin / RTM) |
| Log columns | Sales list column visibility |
| Access Control | App-wide role permissions (Admin) |
| Users | App logins (Raymond) |
| Changes | Audit log export (Admin / CEO) |
| Settings | Theme, catalog, holidays, routing, sync |

---

*Last updated for release **2.3.25** · Detail: [`CHANGELOG.md`](CHANGELOG.md) · Updates: [`UPDATES.md`](UPDATES.md) · User guide: [`TUTORIAL.md`](TUTORIAL.md)*

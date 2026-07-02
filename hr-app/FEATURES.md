# Hangup HR — Feature Overview

*Presentation-style summary of what the app does today.*  
**Product:** Hangup HR Beta · **Version:** 1.0.9-beta.1 · **Platform:** Windows desktop (Electron)

---

## What is Hangup HR?

Hangup HR is an all-in-one **HR operations desktop app** for a call-center / BPO-style workforce. It replaces scattered spreadsheets with one place to manage:

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
- **Version control** — old app builds can be blocked at login; optional **in-app patch updates** via GitHub Releases  
- **Role-based access** — CEO, admin, HR, finance, TL, agent  

### Security

- Passwords hashed (bcrypt)  
- Server-side API only — secret key never exposed to the browser layer  
- Row Level Security on database (deny public access; app server bypasses)  
- Session timeout after 10 minutes idle  
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
- Offboarding / clearance banners when pending  

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

## v1.0.6 highlights

- **Sales edit** + day/week/month dashboard with status filters  
- **Costs** receipts upload, petty cash deposit/pay modals, ledger  
- **Attendance** sticky columns, per-agent month Attended, holiday prefill on init  
- **Federal holidays** USA 2024–2028 import, year accordion, active toggles  
- **Reposition** agents (replaces Promote + Promoted status)  
- **Organization** live team rosters · **Equipment** add/assign/return  
- **Action Plan Week** (formerly AIP) · lifecycle modals  
- **Payroll** hide zero net · **Nationality** dropdown + aliases  

## Sales (1.0.5+)

- Per-sale records: phone, customer name, device (bracelet/necklace/smartwatch), agent, closer  
- Statuses: **passed**, **pending**, **postdated**, **denied**, **callback**  
- TL/OP submissions require RTM/HR/quality/admin approval  
- Weekly dashboard on **Sales** page and dashboard widget  
- Role-scoped visibility + optional cross-team grants from OP/RTM  

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

### User administration

- **Raymond** — Users tab: create users, roles, passwords, email, status  
- **Sessions** — view and revoke active logins  
- **Change password** — any logged-in user in Settings  

---

## Appearance & UX

Six color themes (saved per device):

Light · Dark · Grey · Dark wine · Dark grey · Alabaster

Same layout everywhere — only colors change.

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
6. *(Optional)* Publish GitHub patch release so installed PCs can **Update now** without a new installer — see [`UPDATES.md`](UPDATES.md)

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

> **Hangup HR** is a fast, offline-friendly desktop HR system that keeps your workforce, attendance, and payroll in sync with the cloud — built for real operations teams, not generic HR software.

---

*Last updated for release **1.0.8-beta.1** · See [`CHANGELOG.md`](CHANGELOG.md) and [`UPDATES.md`](UPDATES.md).*

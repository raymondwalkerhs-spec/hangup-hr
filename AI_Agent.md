# AI Agent — Hangup Portal project context

> **Data backend:** Supabase only. **Do not use Google Sheets.** Historical sheet layout: [`LEGACY_GOOGLE_SHEETS.md`](LEGACY_GOOGLE_SHEETS.md).

Internal reference for Cursor / coding agents. **Read this at the start of a session** when working on
Hangup Portal. Keep it updated when architecture, release process, or key decisions change.

---

## What this app is

- **Hangup Portal** — Windows **Electron + Express** desktop HR app (installer + portable EXE only).
- **Workspace:** repo root (e.g. `F:\download app hr`) — **single codebase**; no `hr-app/` mirror
- **Product name in builds:** `Hangup Portal` (`package.json` → `build.productName`)
- **Current version:** `1.3.10` (`package.json` → `version`)

---

## Live backend (Supabase only)

| Item | Value |
|------|--------|
| Active backend | `DATA_BACKEND=supabase` in `.env` (**required** — `sheets` throws at startup) |
| Supabase project | `https://ugntjwqimgosuiodsnnk.supabase.co` |
| Auth users | `app_users` (bcrypt passwords, optional `email` column) |
| Version policy | `app_versions` table (`lib/version-sheet.js`) |
| Documents | Supabase Storage bucket `hr-documents` |
| Sale recordings / confirmations | Supabase Storage `hr-documents` → `sales-attachments/{saleId}/…` (signed share URLs, ~7 days) |
| Local cache | SQLite per PC (`better-sqlite3`) — **keep this**; do not read Postgres on every UI click |
| Legacy Sheets | **Removed from runtime** — see [`LEGACY_GOOGLE_SHEETS.md`](LEGACY_GOOGLE_SHEETS.md) |

**Data flow:** Supabase (source of truth) → sync → SQLite on each machine → fast UI reads. Writes go
to Supabase via Express, then re-sync.

---

## Key people & access

| User | Role | Special powers |
|------|------|----------------|
| Mark | `ceo` | Full access + **Changes** audit tab; **may activate** employee logins |
| Raymond | `admin` | Full access + **Changes** + **system admin** (`canManageAppUsers`) + **may activate** logins |
| Aurora, Eva, Phoebe | `hr` | Full HR work, no Changes tab; Phoebe = **HS-Back-End HR manager** (`HR-Phoebe`) |
| *(others)* | per `app_users.role` | See `lib/roles.js` |

- **Users admin** (`/api/admin/users`, **Users** sidebar tab): **Mark and Raymond** — activate inactive employee logins; Raymond manages all users.
- **Changes tab:** `admin` + `ceo` only (`canViewLogs`).
- **Forgot password:** not implemented; Raymond resets via **Users → Edit**. `app_users.email` is for
  future email reset.

---

## Important files

| Area | Paths |
|------|--------|
| UI | `public/index.html`, `public/login.html`, `public/js/app.js`, `public/js/theme.js`, `public/css/app.css` |
| API | `routes/api.js`, `routes/admin-users.js`, `app.js` (Express entry) |
| Data layer | `lib/data-store.js`, `lib/backend.js`, `lib/supabase-repo.js`, `lib/cache.js` |
| Auth | `lib/auth.js`, `lib/auth-supabase.js`, `lib/session-store.js` |
| Users CRUD | `lib/users-admin.js`, `lib/roles.js` |
| Version check | `lib/app-version.js`, `lib/version-sheet.js` |
| GitHub in-app updates | `lib/github-updater.js`, `lib/zip-extract.js`, `lib/update-integrity.js`, `UPDATES.md`, `.github/workflows/release.yml` |
| Org & registration | `lib/org-hierarchy.js`, `lib/registration.js`, `lib/training-phases.js`, `public/js/hrms-features.js` |
| Electron | `electron/main.js`, `electron/preload.js` |
| Build | `scripts/build.ps1`, `package.json` → `build` section |
| Migrations | `supabase/migrations/`, Supabase MCP `apply_migration` / `execute_sql` |
| Env template | `.env.example` (never commit real `.env` or secret keys) |

**Naming trap:** `lib/supabase-client.js` is the client module — not `lib/supabase.js` (folder conflict).

---

## UI themes

- `public/js/theme.js` — persists `hr_ui_theme` in `localStorage`
- Themes: `light` (default), `dark`, `grey`, `dark-wine`, `dark-grey`, `alabaster`
- CSS variables on `[data-theme="…"]` in `public/css/app.css`
- Picker: Settings → Appearance

---

## UI conventions

- **Employee pickers:** Any field representing a person (agent, closer, reviewer, verifier, approver) must use a **dropdown** from `employees` — never free-text names in UI.
- **Sales edit:** Agent and closer are **read-only** after creation; reviewer and verifier use employee dropdowns.
- **Sales month view:** Filter by agent and/or closer via toolbar dropdowns.

---

## Supabase MCP & migrations

- Server in Cursor: `supabase` (`.cursor/mcp.json` → `project_ref=ugntjwqimgosuiodsnnk`)
- **Agents must apply migrations themselves** — never ask the user to paste SQL into the Dashboard unless **both** MCP and `npm run apply:migrations` fail with a credentials error.

### Migration order (apply when missing)

Apply all files in `supabase/migrations/` in filename order. Key recent files:

1. `20260706_employee_internal_id.sql`
2. `20260706_app_versions_force_update.sql`
3. `20260708_finance_hr_attendance.sql`
4. `20260709_v109b5_sprint.sql` — payroll_exempt, sales form_data, field permissions, attachments
5. `20260710_v110_relations.sql` — unified employee relations
6. `20260711_v112_clients_breaks.sql` — sales clients/products/prices, break schedules, settings revision
7. `20260712_org_registration.sql` — agent self-registration, daily PIN, org unit managers
8. `20260713_agent_training_phases.sql` — 4-week agent training program
9. `20260714_registration_identity_training.sql` — national ID, passport, training_passed
10. `20260715_rbac_payslip_grants.sql` — payslip_visible_to_agent, sales grant expires_at
11. `20260716_app_role_permissions.sql` — admin Access Control overrides

See [`DB_SCHEMA.md`](DB_SCHEMA.md) for full table reference.

---

## Organization & company structure (user-defined rules)

| Rule | Implementation |
|------|----------------|
| **Unit → Team → Agent** | Organization page; OP per unit, TL per team |
| **HS-1, HS-3** | Main Hangup; OP manages each unit |
| **HS-2** | **Separate company**; sidebar toggle; one unit HS-2 for now |
| **HS-Back-End** | No OP — reports to CEO; teams: HR, Quality, RTM, Finance, Admins |
| **HR manager** | Phoebe (`HR-Phoebe`) — `node scripts/link-phoebe-hr-manager.js` |
| **Team names** | `node scripts/normalize-team-names.js` — strip `"Team "`, dedupe per unit |

### Role access (v1.3.4+ defaults, v1.3.6+ overrides)

Central helpers in `lib/roles.js`; flags on `GET /status` → `applyChangesButtonVisibility()` in `app.js`.

**v1.3.6:** Admin/CEO **Access Control** page writes overrides to `app_role_permissions`. Resolver: `lib/role-permissions.js` + catalog `lib/permission-catalog.js`. **Empty table = v1.3.4 hardcoded matrix.** Login (`hasAppAccess`) is never overridden. Username gates (Users tab, leave/loan approvers) stay in code.

API: `GET /rbac/catalog`, `GET /rbac/overrides`, `PUT /rbac/overrides`, `POST /rbac/reset` (admin/ceo only).

Sales column permissions remain in `sales_field_permissions` (linked from Access Control page).

| Role | Employees | Org edit | Sales | Payslip | Equipment |
|------|-----------|----------|-------|---------|-----------|
| **Agent** | Self row, docs upload, no card/filters | Own team + OP view | Status, device, customer only; no export | My payslip when HR releases | Hidden |
| **TL** | Team roster read-only; no edit others | View | Team scope; OP can grant 24h wider view | — | View |
| **OP** | Unit roster | View | Unit scope; grant temp visibility | — | View |
| **Quality/RTM** | Self (scoped) | View + PIN | Company/team per rules; write notes | — | View |
| **HR/Admin** | Full CRUD | Team structure (admin/ceo/hr) | Full + column permissions (RTM/admin) | Full + release to agent | Full |

**Notes:** HR/admin read employee warnings; TL/OP/quality/RTM can add notes without reading list.

---

## Agent self-registration & training

- **Register:** login screen + daily 4-digit PIN (OP/RTM/HR/Admin/Quality see PIN on Org page)
- **Approve:** OP/Admin/HR on Organization → pending list
- **Activate:** **Mark or Raymond only** (inactive → active on Users page)
- **Training:** 4 Mon–Fri phases; statuses passed/rejected/passed_exception; sales count per phase; wizard checkbox on add agent

---

## Sales log rules

- Month view: **submission date only** (`dateBasis=submission`)
- Quality/RTM: unit toggles HS-1/2/3 (default all on)
- **Sales catalog (Settings):** RTM + Admin only — clients, devices, price tiers, break schedules
- **TL/OP submit:** When catalog has active clients, must select client + device + price (UI + server `validateAndResolveCatalogSale`)
- **Sale attachments (1.3.1+):** Upload/play/download via **Supabase Storage** only — no Dropbox in the app. **Share link** = signed URL (regenerate anytime; ~7 days validity).
- **Legacy Dropbox files:** One-time migration before wide rollout:

```powershell
# Needs fresh DROPBOX_ACCESS_TOKEN (files.content.read) in .env — token expires quickly
npm run migrate:sale-attachments
```

Script: `scripts/migrate-sale-attachments-to-supabase.js` — downloads from Dropbox paths in DB, uploads to `sales-attachments/…`, updates `sales_attachments` rows.
- **Sales export (1.3.0+):** CSV / Excel / PDF from Sales log (filtered list or single sale).
- Device fix from `Asset/Sales All Data.csv`: `node scripts/fix-sale-devices-from-csv.js`

---

## Privacy

- Hide `internal_id` (database UUID) from **agent** role — `lib/employee-privacy.js`

---

## In-app updater — permanent rules (CRITICAL)

1. **In-app updates use full installs only** — no patch zip overlays in the app
2. **Windows NSIS:** download `Setup.exe` from GitHub → silent `/S` → app quits
3. **Windows portable / macOS:** download full zip → stage → atomic swap on restart
4. **Never** PowerShell `Expand-Archive` for update zips (manual scripts use `lib/zip-extract.js`)
5. **Always** validate `app.asar` with `lib/update-integrity.js` before swap
6. **Publish:** `publish-github-release.ps1` must upload `Setup.exe` every release
7. **Emergency manual patch:** `node scripts/apply-github-patch-standalone.js` (app closed)

Full detail: [`UPDATES.md`](UPDATES.md)

### How to apply (try in order)

| Method | When |
|--------|------|
| **MCP `apply_migration`** | Preferred — `name` + full SQL from `supabase/migrations/*.sql` |
| **MCP `execute_sql`** | Idempotent one-offs; verify with `list_tables` |
| **`npm run apply:migrations`** | Shell fallback — needs `SUPABASE_ACCESS_TOKEN` or `SUPABASE_DB_PASSWORD` in `.env` |
| **Dashboard SQL Editor** | Last resort only if MCP + script fail |

### Verify after apply

```text
employees.internal_id, employees.fp_number, app_versions.force_update_min_version, loan_requests table
```

Probe: `node -e "require('dotenv').config(); const {getSupabaseAdmin}=require('./lib/supabase-client'); ..."`

### When to apply

1. Before using new tables/API routes — `list_tables` / probe columns first
2. After adding a file under `supabase/migrations/`
3. On user request (“apply migrations”) or “table/column not found” errors
4. Re-run is safe (`IF NOT EXISTS`, idempotent DDL)

### Do not

- Ask the user to run SQL if MCP is configured and working
- Ask for `SUPABASE_SECRET_KEY` — it cannot run DDL (Management API or MCP required)
- Skip migration verify step before shipping a field-breaking release

---

## Supabase MCP (tools reference)

- **DDL:** `apply_migration` with `name` + `query`
- **DML / version updates:** `execute_sql`
- **Inspect:** `list_tables`, `list_migrations`
- Migration files: `supabase/migrations/` — read `.sql`, then apply via MCP
- **Do not** hardcode secrets in docs; keys live in `.env` only

### Data import scripts

| Script | Purpose |
|--------|---------|
| `scripts/migrate-sheets-to-supabase.js` | One-time Sheets → Postgres |
| `scripts/migrate-sale-attachments-to-supabase.js` | Legacy Dropbox sale files → Supabase (`npm run migrate:sale-attachments`) |
| `scripts/import-june-sales.js` | June MLA-Ray CSV → `sales` + employee teams |
| `scripts/seed-equipment.js` | Equipment registry seed |
| `scripts/backfill-employment-periods.js` | Employment period backfill |

---

## Release checklist (agent must do all on every shipped version)

1. **Implement** feature/fix; keep scope minimal.
2. **Bump** `package.json` → `version`.
3. **Update docs:**
   - `CHANGELOG.md` — move `[Unreleased]` → new version section with date
   - `TUTORIAL.md` — user-facing changes
   - `FEATURES.md` — presentation-style feature overview (update when major features ship)
   - `README.md` — architecture / deploy / version notes
   - `AI_Agent.md` — if workflows, versions, or architecture changed
4. **Update live `app_versions` in Supabase** (required — do not skip):

```powershell
cd "F:\download app hr"   # or your repo root
node scripts/publish-app-version.js --notes "One-line release notes"
```

| Release kind | When to use | Command |
|--------------|-------------|---------|
| **Minor** (optional update warning) | UI tweaks, non-breaking fixes | `node scripts/publish-app-version.js` |
| **Field-breaking** | New APIs/schema — old EXE breaks for HR/Quality/field staff | `node scripts/publish-app-version.js --field-breaking --min-compatible 1.0.7-beta.1` |
| **Breaking (all roles)** | Login or data layer incompatible for everyone | `node scripts/publish-app-version.js --breaking` |

- **`--field-breaking`** sets `force_update_min_version` to `package.json` version → blocks **hr, quality, agent, tl, op, rtm** below that version at login (admin/CEO/finance get warning only until they update).
- **`--breaking`** sets `min_compatible_version` = new version → **everyone** below it is blocked.
- **Always check:** if the release needs new DB migrations or API shapes, use `--field-breaking` or `--breaking` — do not leave HR on an old EXE that cannot sync.

Manual SQL (fallback):

```sql
UPDATE app_versions SET is_current = false WHERE is_current = true;

INSERT INTO app_versions (version, release_date, release_type, min_compatible_version, force_update_min_version, is_current, notes)
VALUES ('X.Y.Z', CURRENT_DATE, 'minor', '1.0.7-beta.1', 'X.Y.Z', true, 'One-line release notes')
ON CONFLICT (version) DO UPDATE SET
  is_current = true,
  release_date = EXCLUDED.release_date,
  release_type = EXCLUDED.release_type,
  min_compatible_version = EXCLUDED.min_compatible_version,
  force_update_min_version = EXCLUDED.force_update_min_version,
  notes = EXCLUDED.notes;
```

- Apply migration `20260706_app_versions_force_update.sql` once for `force_update_min_version` column.
- Only **one** row should have `is_current = true`.

5. **Build** Windows EXEs on **your PC** (primary — unchanged):

```powershell
.\scripts\build.ps1 all
```

Output: `dist\Hangup-Portal-Setup-{version}.exe` and portable variant (or `dist-build\` if `dist\` is locked).

6. **Optional — GitHub in-app updates** (does not replace step 5):

```powershell
.\scripts\build.ps1 all
node scripts/fetch-all-release-manifests.js
npm run package:github -- --full
npm run verify:update -- dist\Hangup-Portal-{version}-win-x64-full.zip
.\scripts\publish-github-release.ps1 -IncludeFull
```

In-app updater uses **Setup.exe** (NSIS silent) on Windows and **full zips** on portable/mac. Patch zips are CI/manual only.

7. **macOS DMG** — push tag `v{version}` to GitHub; CI job `build-macos` produces `.dmg` + mac full zips. Or on a Mac: `bash scripts/build-macos.sh` then `npm run package:github -- --full`.

8. **Manual recovery** (if in-app update broken on old builds):

```powershell
# Close Hangup Portal first!
node scripts/apply-github-patch-standalone.js --install-dir "$env:LOCALAPPDATA\Programs\Hangup Portal"
```

9. **Do not** host installers in Supabase Storage (each EXE ~130–180 MB; use USB/share folder instead).

---

## Version policy behaviour

Checked on **login** and every **~5 min** (`SESSION_CHECK_MS` in `app.js`):

| App vs policy | Result |
|---------------|--------|
| ≥ current | OK |
| ≥ min compatible, &lt; current | Warning popup, can continue |
| &lt; min compatible | Blocked — cannot use app |

---

## Security notes

- Express uses `SUPABASE_SECRET_KEY` server-side only (bypasses RLS).
- RLS may show “disabled” in Supabase dashboard — acceptable for desktop-only + secret key on loopback.
- Recommended hardening: enable RLS with deny-all for `anon` if publishable key could leak.
- Session: `x-session-id` header + `sessionStorage`; 10-minute idle logout.
- Never commit `.env`, service account JSON, or Supabase secret keys.

---

## Common commands

```powershell
npm start                          # dev Electron
npm run test:supabase              # verify Supabase env
npm run migrate:supabase           # one-time Sheets → Postgres (before switching backend)
npm run rebuild:native             # after npm install / Electron version change
.\scripts\build.ps1 all            # production build (installer + portable)
```

---

## Decisions already made (do not re-litigate without user ask)

| Topic | Decision |
|-------|----------|
| App update hosting | **Not** Supabase Storage (&gt;100 MB per EXE). Installers: USB/share folder. **Optional:** GitHub Releases — Setup.exe + full zips for in-app update (`UPDATES.md`) |
| Local SQLite cache | **Keep** — performance layer on each PC |
| User management | **Raymond only** |
| Password reset | Manual by Raymond today; `email` column ready for future |
| Supabase Auth / MFA | Not implemented |
| Browser / localhost server mode | Removed — desktop only |

---

## Current `app_versions` state

| version | is_current | notes |
|---------|------------|-------|
| **1.3.1** | **true** | Supabase-only sale attachments; migrate script; multi-version GitHub patches |
| 1.3.0 | false | Sales export; catalog validation; quality audio; registration identity |
| 1.2.5 | false | Updater integrity |
| 1.2.4 | false | Permanent updater fix (safe zip + ASAR checksums); training program; org/registration |
| 1.2.3 | false | Org hierarchy, agent registration, sales date filter, device CSV fix |
| 1.2.2 | false | Windows updater Expand-Archive fix (partial — superseded by 1.2.4) |
| 1.2.0 | false | Sales catalog, break schedules, session ID, Dropbox attachments |
| 1.0.9-beta.6 | false | 1.0.8-beta.1 | — | UI modals, GitHub updates all users |
| 1.0.9-beta.1 | false | 1.0.8-beta.1 | 1.0.9-beta.1 | Finance workflow, FP import, loan approval, custom reports |
| 1.0.8-beta.1 | false | 1.0.7-beta.1 | 1.0.8-beta.1 | Employee identity, promotions revert, nav, field force-update |
| 1.0.5-beta.1 | false | 1.0.0 | — | Sales, bonus approval, costs/petty cash |
| 1.0.4-beta.3 | false | 1.0.0 | Nationality, compliance, employee filters |
| 1.0.4-beta.2 | false | 1.0.0 | HRMS advanced features |
| 1.0.2-beta.5 | false | 1.0.0 | UI themes |
| 1.0.2-beta.4 | false | — | prior beta |
| 1.0.0 | false | — | initial |

_Update this table when shipping a new version._

---

## Suggested next builds (HRMS roadmap)

> **Status:** Items below marked **Approved** shipped in `1.0.4-beta.2` unless noted pending.

Priority is rough (P1 = high value for daily HR ops). Adjust with the user.

### Auth & security

| ID | Feature | Priority | Notes |
|----|---------|----------|-------|
| AUTH-01 | **Forgot password / self-service reset** | P1 | Email link via Resend/SMTP or Supabase Auth; uses `app_users.email` |
| AUTH-02 | **Change my password** (logged-in user) | P1 | **Approved** `1.0.4-beta.2` — Settings page |
| AUTH-03 | **Supabase Auth migration** | P2 | Email login, JWT sessions, optional MFA; larger refactor |
| AUTH-04 | **RLS hardening** | P2 | **Approved** `1.0.4-beta.2` — migration `20260702_rls_deny_all.sql` (apply manually) |
| AUTH-05 | **Session management** | P3 | **Approved** `1.0.4-beta.2` — Raymond session registry |

### Employee lifecycle

| ID | Feature | Priority | Notes |
|----|---------|----------|-------|
| EMP-01 | **Onboarding checklist** | P2 | **Approved** `1.0.4-beta.2` |
| EMP-02 | **Offboarding workflow** | P2 | **Approved** `1.0.4-beta.2` |
| EMP-03 | **Probation / contract end alerts** | Done | `1.0.9-beta.1` — dashboard + employee fields |
| EMP-04 | **Org chart** | P3 | **Approved** `1.0.4-beta.2` — read-only org page |
| EMP-05 | **Employee self-service portal** | P3 | Agents view own attendance, payslips, submit leave requests (web or slim app) |

### Time & attendance

| ID | Feature | Priority | Notes |
|----|---------|----------|-------|
| ATT-01 | **Leave management** | P1 | **Approved** `1.0.4-beta.2` |
| ATT-02 | **Public holiday calendar** | P2 | **Approved** `1.0.4-beta.2` — USA federal holidays; **Egyptian holidays** `1.0.8-beta.1` (admin-only activate, separate Settings card) |
| ATT-03 | **Shift / roster planning** | P3 | Night shifts, rotating teams, expected vs actual hours |
| ATT-04 | **Overtime tracking** | P2 | OT hours, rates, approval; feed into payroll |
| ATT-05 | **Bulk attendance import** | Done | `1.0.9-beta.1` — FP device CSV/XLS + per-month rules |

### Payroll & compensation

| ID | Feature | Priority | Notes |
|----|---------|----------|-------|
| PAY-01 | **Payroll run lock / approve** | P1 | **Approved** `1.0.4-beta.2` |
| PAY-02 | **Payroll comparison report** | P2 | **Approved** `1.0.4-beta.2` |
| PAY-03 | **Tax / statutory deductions** | P2 | **Approved** `1.0.4-beta.2` — structure only, 0% default |
| PAY-04 | **13th month / annual bonus batch** | P3 | One-shot bonus wizard across all eligible employees |
| PAY-05 | **Bank file formats** | P2 | More export templates (beyond Cash/Bank/Insta CSV) |

### Loans, warnings & discipline

| ID | Feature | Priority | Notes |
|----|---------|----------|-------|
| HR-01 | **Warning escalation workflow** | P2 | **Approved** `1.0.4-beta.2` — 1st / 2nd / final levels |
| HR-02 | **Loan approval chain** | Done | `1.0.9-beta.1` — HR request → Mark/Phoebe/Raymond approve |
| HR-03 | **Commission plan builder** | P2 | **Approved** `1.0.4-beta.2` — commission types CRUD + tier editor |

### Documents & compliance

| ID | Feature | Priority | Notes |
|----|---------|----------|-------|
| DOC-01 | **Document expiry alerts** | P1 | **Approved** `1.0.4-beta.2` — dashboard widget |
| DOC-02 | **E-sign / acknowledgment** | P3 | Employee confirms policy read; audit trail |
| DOC-03 | **Bulk document export** | P2 | **Approved** `1.0.4-beta.2` — ZIP per employee |

### Reporting & analytics

| ID | Feature | Priority | Notes |
|----|---------|----------|-------|
| RPT-01 | **Headcount & turnover dashboard** | P2 | **Approved** `1.0.4-beta.2` |
| RPT-02 | **Attendance summary export** | P2 | **Approved** `1.0.4-beta.2` — rankings CSV |
| RPT-03 | **Custom report builder** | Done | `1.0.9-beta.1` — saved reports + CSV export |
| RPT-04 | **Finance handoff pack** | P2 | **Approved** `1.0.4-beta.2` |

### Admin & platform

| ID | Feature | Priority | Notes |
|----|---------|----------|-------|
| ADM-01 | **In-app notifications** | P2 | **Approved** `1.0.4-beta.2` |
| ADM-02 | **Audit export for Changes tab** | P2 | **Approved** `1.0.4-beta.2` |
| ADM-03 | **Multi-admin user management** | P3 | Delegate Users tab to more than Raymond (role-gated) |
| ADM-04 | **Auto-update checker** | Done | GitHub Releases — NSIS silent + full app swap; `app_versions` policy — see [`UPDATES.md`](UPDATES.md) |
| ADM-05 | **Backup / restore UI** | P2 | Raymond triggers Supabase-aware cache refresh; export config snapshot |
| ADM-06 | **Localization (EN + AR)** | P3 | RTL layout, bilingual payslips if needed |
| ADM-07 | **GitHub release channel (Windows)** | Done | Workflow + `bootstrap-github-repo.ps1` — user pushes repo + secrets |
| ADM-08 | **GitHub release channel (macOS CI)** | Done | `macos-latest` job + `scripts/build-macos.sh` in root `release.yml` (no `hr-app/` mirror) |
| ADM-09 | **macOS code signing** | P2 | Apple cert for Gatekeeper after in-app update (`identity: null` today) |

### Costs & finance

> **Shipped core** in `1.0.5-beta.1`: expenses, petty cash, monthly bills schema, HR/RTM submit.  
> **Code:** `routes/expenses.js`, `lib/business-repo.js`, `public/js/expenses.js`

| ID | Feature | Priority | Notes |
|----|---------|----------|-------|
| FIN-01 | **Expense approve/deny workflow** | Done | `1.0.9-beta.1` |
| FIN-02 | **Monthly bills CRUD UI** | Done | `1.0.9-beta.1` |
| FIN-03 | **Business cache invalidation** | Done | `1.0.9-beta.1` |
| FIN-04 | **Finance create status fix** | Done | `1.0.9-beta.1` |
| FIN-05 | **Own-pocket settlement** | Done | `1.0.9-beta.1` |
| FIN-06 | **Petty cash balance guard** | Done | `1.0.9-beta.1` |
| FIN-09 | **Edit posted petty cash deposits** | Done | `1.0.9-beta.3` |
| FIN-07 | **Due-date / overdue alerts** | Done | `1.0.9-beta.1` |
| FIN-08 | **Denied flow + notifications** | Done | `1.0.9-beta.1` |

**Finance access today:** usernames `mark`, `phoebe`, `raymond` + role `finance` + admin/ceo (`canAccessCostsFull` in `lib/roles.js`). HR/RTM submit only (`canSubmitExpense`).

### Suggested build order (if user asks “what next?”)

1. **AUTH-01** — forgot password (email column already exists)
2. **ATT-04** — overtime tracking → payroll feed
3. **ADM-09** — macOS code signing

_When user approves an item: note approval date + version target in this table and remove “Pending” for that row._

---

## Agent doc maintenance

When you change release process, backend, roles, or build output paths, update **this file** in the
same PR/session as `CHANGELOG.md`, `README.md`, and `FEATURES.md` when features change.

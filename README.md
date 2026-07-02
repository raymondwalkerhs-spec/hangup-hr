# Hangup HR — Desktop App

**Hangup HR** is a Windows desktop application for employee records, attendance, payroll, documents, and HR operations. The live backend is **Supabase** (`DATA_BACKEND=supabase`). Each PC keeps a **local SQLite cache** for fast reads; every edit is saved to Supabase and re-synced automatically.

**Current version:** `1.0.8-beta.1`

| Document | Purpose |
|----------|---------|
| [`TUTORIAL.md`](TUTORIAL.md) | Day-to-day user guide |
| [`FEATURES.md`](FEATURES.md) | Feature overview (presentation-style) |
| [`CHANGELOG.md`](CHANGELOG.md) | Release history |
| [`UPDATES.md`](UPDATES.md) | **Installer vs GitHub in-app updates** |
| [`SHEET_SCHEMA.md`](SHEET_SCHEMA.md) | Database / legacy sheet layout |
| [`AI_Agent.md`](AI_Agent.md) | Agent context, release checklist, architecture |

There is **no browser / localhost mode** — the app runs only as the packaged Electron desktop EXE.

---

## Architecture

```
Supabase (Postgres + Storage + app_users)
        │  sync on launch & after writes
        ▼
  Local SQLite cache (per PC)
        │
        ▼
  Electron UI + Express API (loopback only)
```

- **Source of truth:** Supabase  
- **Performance layer:** SQLite cache on each machine  
- **Auth:** `app_users` table (bcrypt passwords), session token after login  
- **Documents:** Supabase Storage bucket `hr-documents` (legacy Google Drive file IDs still open until re-uploaded)  
- **Version policy:** `app_versions` table — old EXEs can be blocked or warned at login  

Legacy `DATA_BACKEND=sheets` is still in code for migration only; production uses Supabase.

---

## Supabase project

| Item | Value |
|------|--------|
| **Project URL** | `https://ugntjwqimgosuiodsnnk.supabase.co` |
| **Auth** | `app_users` (Raymond manages via **Users** tab) |
| **HR data** | `employees`, `attendance_events`, `payroll_adjustments`, … |
| **HRMS tables** | `employment_periods`, `leave_requests`, `equipment`, `action_improvement_plans`, … |
| **Sales / costs** | `sales`, `bonus_requests`, `expense_requests`, `petty_cash_ledger`, `monthly_bills`, `app_notifications` |
| **Audit** | `change_log` |
| **Versions** | `app_versions` |

One-time Sheets → Supabase import: `npm run migrate:supabase`

Connectivity check: `npm run test:supabase`

### Migrations & live database

Schema changes are versioned in `supabase/migrations/`. **Cursor agents with Supabase MCP access should apply pending migrations directly** (`apply_migration` / `execute_sql` on server `user-supabase`) — do not leave new tables unapplied when shipping features that depend on them.

To apply manually (fallback): Supabase Dashboard → SQL Editor → paste the migration file contents.

After schema changes that ship a new app version, update `app_versions` (see `AI_Agent.md` release checklist).

---

## Feature summary

| Area | Highlights |
|------|------------|
| **Core HR** | Employees, attendance grid, payroll, payslips, bonuses, deductions, loans, salaries |
| **Compliance** | Nationality, work permit (non-Egyptian), social insurance (Egyptian) |
| **Lifecycle** | Employment periods, depart / re-hire, onboarding & offboarding checklists, clearance |
| **Discipline** | Warnings with escalation levels, Action Improvement Plans (AIP) |
| **Time off** | Leave requests; approvers: Mark, Raymond, Phoebe |
| **Payroll control** | Month lock, MoM comparison, tax stub (0% default), finance handoff ZIP |
| **Assets** | Equipment registry and assignments |
| **Documents** | Upload, expiry alerts, bulk ZIP export |
| **Reporting** | Monthly HR report, turnover, attendance rankings |
| **Admin** | Notifications bell, change log export, session registry (Raymond), user management |

Full detail: [`FEATURES.md`](FEATURES.md)

---

## Building (Windows)

### Prerequisites

- Windows 10/11 x64  
- Node.js 18+  
- `.env` with Supabase keys (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, …)  
- `credentials/service-account.json` only if you still use Drive-backed document IDs  

### Recommended build

```powershell
cd "K:\download app hr"
npm run dist:beta
```

Outputs in **`dist-beta-v2\`**:

| File | Purpose |
|------|---------|
| `Hangup-HR-Beta-v2-Setup-1.0.4-beta.3.exe` | Installer |
| `Hangup-HR-Beta-v2-Portable-1.0.4-beta.3.exe` | Portable (USB / folder) |
| `win-unpacked\Hangup HR Beta.exe` | Unpacked dev-style run |

Other scripts:

```powershell
.\scripts\build.ps1              # installer + portable → dist\
.\scripts\build.ps1 installer    # installer only
.\scripts\build.ps1 portable     # portable only
npm run dist:all                 # same via npm
```

**Before building:** close any running **Hangup HR** / Electron windows so `dist*` folders are not locked.

**Code signing (optional):** set `CSC_LINK` and `CSC_KEY_PASSWORD`, then run the build script.

### Deploy to a PC

1. Copy the installer or portable EXE.  
2. Run it (SmartScreen may warn on unsigned builds → *More info → Run anyway*).  
3. Sign in with credentials from `app_users` (Raymond creates users in **Users**).  
4. First launch needs internet for the initial Supabase sync.

### Development

```powershell
npm install
npm run rebuild:native
npm start
```

If Electron fails to start: `npm run fix:electron`

---

## Commands

| Command | Purpose |
|---------|---------|
| `npm start` | Run from source (Electron) |
| `npm run dist:beta` | Beta channel build → `dist-beta-v2\` |
| `npm run dist:all` | Installer + portable → `dist\` |
| `npm run package:github` | Patch/full update zips for GitHub Releases |
| `npm run publish:github` | Upload update assets to GitHub (`gh` CLI) |
| `npm run bootstrap:github` | Init git repo + print GitHub setup steps |
| `npm run rebuild:native` | Rebuild `better-sqlite3` for Electron |
| `npm run test:supabase` | Check Supabase env and clients |
| `npm run migrate:supabase` | One-time Sheets → Postgres import |
| `node scripts/import-june-sales.js` | Import June MLA-Ray sales CSV → `sales` table |
| `node scripts/import-june-sales.js --dry-run` | Preview import without writing |

---

## Payroll formula (summary)

```
Basic = (workingDays + extraDays − halfDays×0.5 − quarterDays×0.25 − nsnc×2 − nsncHalf×1.5) × dailyRate
Net   = basic + bonuses − deductions − lateness − loan − tax (when configured) − 2-week hold if enabled
```

Action Improvement Plan weeks apply extra rules (e.g. Lateness A = 75 EGP, tripled deductions). See [`FEATURES.md`](FEATURES.md).

---

## Roles & access

| Role | Access |
|------|--------|
| `ceo` | Full + **Changes** audit tab |
| `admin` | Full + **Changes** audit tab |
| `hr` | Full HR; no **Changes** tab |
| `finance` | Payroll + read |
| `tl` | Attendance edit + read |
| `agent` | Read only |

- **Users tab** (add/edit passwords, roles, email): **Raymond only**  
- **Changes tab:** `admin` and `ceo` only  
- **Leave approval:** Mark, Raymond, Phoebe (by username)  
- **Session timeout:** 10 minutes idle → auto logout  
- **Change password:** Settings (logged-in user)  

---

## Version policy

Each build embeds `package.json` version. On login and every ~5 minutes the app checks `app_versions`:

| Result | Behaviour |
|--------|-----------|
| App ≥ current | No notice |
| App ≥ min compatible, &lt; current | Update warning — can continue |
| App &lt; min compatible | Blocked — install newer EXE |

**On every release:** bump `package.json`, update docs, set `app_versions` in Supabase, build and distribute EXE.

### Two update channels (see [`UPDATES.md`](UPDATES.md))

| Channel | Use for |
|---------|---------|
| **Installer / portable EXE** (`.\scripts\build.ps1`) | New PCs, USB handoff, full reinstall — **primary, on your PC** |
| **GitHub patch update** (in-app “Update now”) | PCs already installed — changed files only, no new installer |

GitHub updates do **not** replace building installers locally.

```sql
UPDATE app_versions SET is_current = false WHERE is_current = true;

INSERT INTO app_versions (version, release_date, release_type, min_compatible_version, is_current, notes)
VALUES ('1.0.4-beta.3', CURRENT_DATE, 'minor', '1.0.0', true, 'Release notes here')
ON CONFLICT (version) DO UPDATE SET
  is_current = EXCLUDED.is_current,
  release_date = EXCLUDED.release_date,
  notes = EXCLUDED.notes;
```

**Live current version:** `1.0.4-beta.3`

---

## Security

- Express holds `SUPABASE_SECRET_KEY` on loopback — the UI never talks to Postgres directly.  
- **RLS enabled** on public tables with deny-all policies for `anon` / `authenticated`; the server secret bypasses RLS.  
- Do not expose the secret key in a public web client.  
- Distribute EXE only to trusted HR PCs; treat `.env` as confidential on build machines.

App updates are **not** delivered via Supabase Storage (installers are ~90 MB). Copy the new EXE manually (USB, shared folder, etc.), or use **GitHub in-app patch updates** for PCs that already have the app — see [`UPDATES.md`](UPDATES.md). Version enforcement uses `app_versions` only.

---

## Appearance

Settings → **Appearance** — six themes (Light, Dark, Grey, Dark wine, Dark grey, Alabaster), saved per device.

---

## Release checklist

1. Bump `package.json`  
2. Update `CHANGELOG.md`, `TUTORIAL.md`, `README.md`, `FEATURES.md` if features changed  
3. Update `app_versions` in Supabase  
4. `.\scripts\build.ps1 all` — **installer + portable on your PC** (unchanged)  
5. Distribute new EXE to HR PCs  
6. *(Optional)* `npm run package:github -- --full` then `npm run publish:github` — patch updates via GitHub  

See [`UPDATES.md`](UPDATES.md) and [`AI_Agent.md`](AI_Agent.md) for the full update workflow.

# AI Agent — Hangup HR project context

Internal reference for Cursor / coding agents. **Read this at the start of a session** when working on
Hangup HR. Keep it updated when architecture, release process, or key decisions change.

---

## What this app is

- **Hangup HR** — Windows **Electron + Express** desktop HR app (installer + portable EXE only).
- **Workspace:** `K:\download app hr`
- **Product name in builds:** `Hangup HR Beta` (`package.json` → `build.productName`)
- **Current version:** `1.0.5-beta.1` (`package.json` → `version`)

---

## Live backend (as of beta.5)

| Item | Value |
|------|--------|
| Active backend | `DATA_BACKEND=supabase` in `.env` |
| Supabase project | `https://ugntjwqimgosuiodsnnk.supabase.co` |
| Auth users | `app_users` (bcrypt passwords, optional `email` column) |
| Version policy | `app_versions` table (`lib/version-sheet.js`) |
| Documents | Supabase Storage bucket `hr-documents` |
| Local cache | SQLite per PC (`better-sqlite3`) — **keep this**; do not read Postgres on every UI click |
| Legacy fallback | `DATA_BACKEND=sheets` → Google Sheets + Drive |

**Data flow:** Supabase (source of truth) → sync → SQLite on each machine → fast UI reads. Writes go
to Supabase via Express, then re-sync.

---

## Key people & access

| User | Role | Special powers |
|------|------|----------------|
| Mark | `ceo` | Full access + **Changes** audit tab |
| Raymond | `admin` | Full access + **Changes** + **sole system admin** (`canManageAppUsers`) |
| Aurora, Eva, Phoebe | `hr` | Full HR work, no Changes tab |
| *(others)* | per `app_users.role` | See `lib/roles.js` |

- **Users admin** (`/api/admin/users`, **Users** sidebar tab): **Raymond only** — not other admins.
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
| Electron | `electron/main.js` |
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

## Google Sheets (legacy IDs — still used for migration / fallback)

| Sheet | ID |
|-------|-----|
| HR Access (login, App_Versions fallback) | `1i4KR3e_jNtPMTSDFnbpS7kYzExqEyA0CgLlaZg5KoF8` |
| HR Data | `17z8JrLV0_4fSXzsiZRpCZWFJk5FTit3IUkw0c3NOkvU` |
| Change Log | `14vcc32AvyXI6PEUPbCd5IBoTfhEirAorGX1xMI75h9Y` |
| Drive folder (legacy docs) | `1rfPMKlIqbJ_eKpwXIpHPKW_vfR7VXVUe` |

Service account: `hrsystem@decoded-flag-420721.iam.gserviceaccount.com`

---

## Supabase MCP

- Server name in Cursor: `user-supabase` (also `.cursor/mcp.json`)
- **DDL:** `apply_migration` with `name` + `query` — **apply pending migrations yourself** whenever schema changes are needed; do not ask the user to run SQL manually if MCP access works
- **DML / version updates / data imports:** `execute_sql`
- **Inspect:** `list_tables`, `list_migrations`
- Migration files live in `supabase/migrations/` — read the `.sql` file, then apply via MCP (or `execute_sql` for idempotent one-offs)
- **Do not** hardcode secrets in docs; keys live in `.env` only

### When to apply migrations

1. Before using new tables/API routes (e.g. `sales`, `bonus_requests`) — verify with `list_tables` first
2. After adding a new file under `supabase/migrations/`
3. On user request (“apply migrations”) or when import/scripts fail with “table not found”
4. Re-run is safe when migrations use `IF NOT EXISTS` / `ON CONFLICT`

### Data import scripts

| Script | Purpose |
|--------|---------|
| `scripts/migrate-sheets-to-supabase.js` | One-time Sheets → Postgres |
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

```sql
UPDATE app_versions SET is_current = false WHERE is_current = true;

INSERT INTO app_versions (version, release_date, release_type, min_compatible_version, is_current, notes)
VALUES ('X.Y.Z', CURRENT_DATE, 'minor', '1.0.0', true, 'One-line release notes')
ON CONFLICT (version) DO UPDATE SET
  is_current = true,
  release_date = EXCLUDED.release_date,
  release_type = EXCLUDED.release_type,
  min_compatible_version = EXCLUDED.min_compatible_version,
  notes = EXCLUDED.notes;
```

- Set `min_compatible_version` higher on **breaking** releases to block old EXEs at login.
- Only **one** row should have `is_current = true`.

5. **Build** Windows EXEs:

```powershell
cd "K:\download app hr"
.\scripts\build.ps1 all
```

Output: `dist\Hangup-HR-Beta-v2-Setup-{version}.exe` and portable variant.

6. **Do not** host installers in Supabase Storage (each EXE ~130–180 MB; use USB/share folder instead).

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
| App update hosting | **Not** Supabase Storage (&gt;100 MB per EXE) |
| Local SQLite cache | **Keep** — performance layer on each PC |
| User management | **Raymond only** |
| Password reset | Manual by Raymond today; `email` column ready for future |
| Supabase Auth / MFA | Not implemented |
| Browser / localhost server mode | Removed — desktop only |

---

## Current `app_versions` state

| version | is_current | min_compatible_version | notes |
|---------|------------|------------------------|-------|
| 1.0.5-beta.1 | **true** | 1.0.0 | Sales, bonus approval, costs/petty cash |
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
| EMP-03 | **Probation / contract end alerts** | P2 | Dashboard reminders from `start_date` / contract fields |
| EMP-04 | **Org chart** | P3 | **Approved** `1.0.4-beta.2` — read-only org page |
| EMP-05 | **Employee self-service portal** | P3 | Agents view own attendance, payslips, submit leave requests (web or slim app) |

### Time & attendance

| ID | Feature | Priority | Notes |
|----|---------|----------|-------|
| ATT-01 | **Leave management** | P1 | **Approved** `1.0.4-beta.2` |
| ATT-02 | **Public holiday calendar** | P2 | **Approved** `1.0.4-beta.2` — USA federal holidays, pink grid columns |
| ATT-03 | **Shift / roster planning** | P3 | Night shifts, rotating teams, expected vs actual hours |
| ATT-04 | **Overtime tracking** | P2 | OT hours, rates, approval; feed into payroll |
| ATT-05 | **Bulk attendance import** | P2 | CSV upload for biometric/export systems |

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
| HR-02 | **Loan approval chain** | P3 | Request → TL → HR → finance before active loan |
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
| RPT-03 | **Custom report builder** | P3 | Saved filters, scheduled exports |
| RPT-04 | **Finance handoff pack** | P2 | **Approved** `1.0.4-beta.2` |

### Admin & platform

| ID | Feature | Priority | Notes |
|----|---------|----------|-------|
| ADM-01 | **In-app notifications** | P2 | **Approved** `1.0.4-beta.2` |
| ADM-02 | **Audit export for Changes tab** | P2 | **Approved** `1.0.4-beta.2` |
| ADM-03 | **Multi-admin user management** | P3 | Delegate Users tab to more than Raymond (role-gated) |
| ADM-04 | **Auto-update checker** | P3 | Poll `app_versions` + shared folder URL for new EXE (not Storage) |
| ADM-05 | **Backup / restore UI** | P2 | Raymond triggers Supabase-aware cache refresh; export config snapshot |
| ADM-06 | **Localization (EN + AR)** | P3 | RTL layout, bilingual payslips if needed |

### Suggested build order (if user asks “what next?”)

1. **AUTH-01 + AUTH-02** — password flows (email column already exists)  
2. **ATT-01** — leave management (biggest HRMS gap vs current attendance-only model)  
3. **DOC-01** — document expiry alerts (low effort, high compliance value)  
4. **PAY-01** — payroll month lock (protects finance from accidental edits)  
5. **RPT-01** — headcount dashboard (extends existing Reports page)

_When user approves an item: note approval date + version target in this table and remove “Pending” for that row._

---

## Agent doc maintenance

When you change release process, backend, roles, or build output paths, update **this file** in the
same PR/session as `CHANGELOG.md`, `README.md`, and `FEATURES.md` when features change.

# AI Agent — Hangup Portal project context

> **Data backend:** Supabase only. **Do not use Google Sheets.** Historical sheet layout: [`LEGACY_GOOGLE_SHEETS.md`](LEGACY_GOOGLE_SHEETS.md).

Internal reference for Cursor / coding agents. **Read this at the start of a session** when working on
Hangup Portal. Keep it updated when architecture, release process, or key decisions change.

---

## What this app is

- **Hangup Portal** — Windows **Electron + Express** desktop HR app (installer + portable EXE only).
- **Workspace:** repo root (e.g. `F:\download app hr`) — **single codebase**; no `hr-app/` mirror
- **Product name in builds:** `Hangup Portal` (`package.json` → `build.productName`)
- **Current version:** `1.6.7` (`package.json` → `version`)
- **Previous:** `1.6.4` (FP ID+Date-only), `1.6.3` (training payroll consolidation), `1.6.2` (trainee day count UTC fix), `1.6.1` (pay units)

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
| Sales UI | `public/js/sales.js`, `public/js/sales-permissions-pages.js`, `public/js/sales-config-breaks.js` |
| Sales server | `routes/sales.js`, `lib/sales-field-catalog.js`, `lib/sales-list-columns.js`, `lib/sales-filter.js`, `lib/sales-working-day.js`, `lib/sales-field-access.js` |
| Access Control UI | `public/js/access-control.js`, `lib/permission-catalog.js`, `lib/role-permissions.js` |
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
| Docs (user + agent) | `TUTORIAL.md`, `FEATURES.md`, `SALES_LOG.md`, `CHANGELOG.md`, `UPDATES.md`, `AI_Agent.md` |
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

- **Employee pickers:** Any field representing a person (agent, closer, reviewer, verifier, bank-account chooser) must use a **dropdown** from `employees` — never free-text IDs in UI.
- **Sales edit:** Agent and closer are **read-only** after creation; reviewer, verifier, and bank-account chooser use employee dropdowns.
- **Sales toolbar filters (1.4.1+):** Client, Agent, Closer, Status on day/week/month views.
- **Advanced filter:** Value dropdowns for employee/client/team/status fields; AND/OR/NOT logic only when 2+ rules.
- **Modals:** `openModal()` auto-focuses first input; closes mobile sidebar; z-index 5000. `closeModal()` plays an exit animation (`.modal-closing`) before clearing.
- **Page load:** Search/toolbar inputs stay clickable during `page-loading` (only tables are temporarily non-interactive).
- **Design tokens (1.4.2+):** shared `:root` tokens in `public/css/app.css` — spacing (`--space-*`), radius (`--radius*`), theme-aware surfaces (`--surface`, `--surface-2`) and badge tints (`--tint-ok-bg` etc., via `color-mix` so all 7 themes work). Use tokens instead of hardcoded hex.
- **Buttons (1.4.2+):** variants `btn-primary`, `btn-secondary`, `btn-outline`, `btn-success`, `btn-danger`, `btn-ghost`, `btn-icon`, sizes `btn-sm`/`btn-lg`; `.is-loading` spinner state; consistent disabled/focus-visible styles.
- **Dialogs:** prefer `openConfirmModal` / `openPromptModal` / `showRegistrationCredentialsModal` over native `confirm()` / `alert()`.
- **Sales edit prefill (1.4.2):** edit modal resolves client/device/price catalog IDs from `form_data` and falls back to name/device/price matching (`resolveCatalogSelection` in `sales-config-breaks.js`); the sanitizer preserves `salesClientId`/`salesProductId`/`salesPriceId` (see `PASSTHROUGH_KEYS` in `lib/sales-field-catalog.js`). Backfill script: `scripts/backfill-sale-catalog-ids.js` (`--dry-run` supported).
- **Sales permissions (1.4.2+):** role-first page like Access Control — pick role, toggle View/Edit per field, pending-change tracking, batch save via `PUT /sales/field-permissions/:fieldKey`.
- **Registration (1.4.2+):** login page has a 3-step wizard (PIN → details → success pipeline); approval shows a credentials modal with copy buttons.

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
6. `20260711_v112_clients_breaks.sql` — sales clients/products/prices, break schedules
7. `20260712_org_registration.sql` — agent self-registration, daily PIN, org unit managers
8. `20260713_agent_training_phases.sql` — 4-week agent training program
9. `20260714_registration_identity_training.sql` — national ID, passport, training_passed
10. `20260715_rbac_payslip_grants.sql` — payslip_visible_to_agent, sales grant expires_at
11. `20260716_app_role_permissions.sql` — admin Access Control overrides
12. `20260717_app_user_permissions.sql` — per-user exception permissions
13. `20260718_notifications_quality_notes.sql` — notifications, quality notes split
14. `20260719_v140_sales_org_dashboards.sql` — working day, list columns, sales action permissions, team dashboards
15. `20260720_training_payroll.sql` — program outcomes, phase exit reasons, Trainee position seed

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

Sales field permissions remain in `sales_field_permissions` — managed on **Sales permissions** sidebar page (not Access Control). Log column enable/disable on **Log columns** page. Full reference: [`SALES_LOG.md`](SALES_LOG.md).

| Role | Employees | Org edit | Sales | Payslip | Equipment |
|------|-----------|----------|-------|---------|-----------|
| **Agent** | Self row, docs upload, no card/filters | Own team + OP view | Status, device, customer only; no export | My payslip when HR releases | Hidden |
| **TL** | Team roster read-only; no edit others | View | Team scope; OP can grant 24h wider view | — | View |
| **OP** | Unit roster | View | Unit scope; grant temp visibility | — | View |
| **Quality/RTM** | Self (scoped) | View + PIN | Company/team per rules; write notes | — | View |
| **HR/Admin** | Full CRUD | Team structure (admin/ceo/hr) | Full + **Sales permissions** / **Log columns** pages (RTM/admin/hr) | Full + release to agent | Full |

**Sales admin pages (1.4.1+, role-first since 1.4.2):** sidebar **Sales permissions** and **Log columns**. Visible when `canViewSalesAdmin` / `canManageSalesFieldPermissions` — **RTM / Admin only** (HR removed in 1.4.3).

**Notes:** HR/admin read employee warnings; TL/OP/quality/RTM can add notes without reading list.

---

## Agent self-registration & training

- **Register:** login screen + daily 4-digit PIN (OP/RTM/HR/Admin/Quality see PIN on Org page)
- **Approve:** OP/Admin/HR on Organization → pending list
- **Activate:** **Mark or Raymond only** (inactive → active on Users page)
- **Training:** 4 Mon–Fri phases; statuses passed/rejected/passed_exception; sales count per phase; wizard checkbox on add agent

---

## Sales log rules (v1.4.0+ / v1.4.1)

Full user/agent reference: [`SALES_LOG.md`](SALES_LOG.md)

| Topic | Rule |
|-------|------|
| **Working day** | Until **1 AM Cairo** counts on previous day; list uses `dateBasis=workingDay` |
| **List columns** | All catalog fields + Day/Time/Agent/Closer/Customer — admin enables on **Log columns** page; visibility ∩ field view ACL |
| **Toolbar filters** | Client, Agent, Closer, Status (all periods) |
| **Advanced filter** | AND/OR/NOT when 2+ rules; employee/client dropdowns for ID fields; persisted in `localStorage` |
| **Add sale** | Unit → team → agent cascade; closer company-wide; catalog client/device/price when configured |
| **Bank payment** | routing number, bank name, account number, address, who chose bank account (required fields when Bank account) |
| **Verifier feedback** | Dropdown; assigned verifier + RTM/Admin override |
| **Client feedback** | Dropdown; RTM/Admin edit only |
| **Quality/RTM** | Unit toggles HS-1/2/3 on log |
| **Attachments** | Supabase Storage `sales-attachments/{saleId}/…`; signed share URLs ~7 days |
| **Export** | CSV / Excel / PDF |
| **Payroll link** | Sale create/update recalcs agent `sales_count` for working-day month |

Legacy scripts:

```powershell
npm run migrate:sale-attachments   # Dropbox → Supabase (one-time)
node scripts/repair-backend-teams.js
node scripts/backfill-sales-working-day.js
node scripts/backfill-sales-payment-from-csv.js --dry-run   # fill empty card/bank from migration CSV
node scripts/dedupe-sales.js --dry-run                      # merge duplicate sales (DB only; see below)
```

**Dedupe (`dedupe-sales.js`):** removes duplicate sales by phone + submission date. Keeps the row with the most attachments / fullest `form_data`. **Does not delete Dropbox recordings or confirmations** — only DB rows; unique attachments are reassigned to the survivor. Log: `dedupe-sales-log.txt`.

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
3. **Update docs** (required on every change — do not skip):
   - `CHANGELOG.md` — move `[Unreleased]` → new version section with date
   - `TUTORIAL.md` — user-facing changes
   - `FEATURES.md` — presentation-style feature overview (update when major features ship)
   - `SALES_LOG.md` — when sales log / filters / permissions change
   - `README.md` — architecture / deploy / version notes
   - `AI_Agent.md` — workflows, versions, `app_versions` table
4. **Commit and push to GitHub** (required — do not leave fixes local only):

```powershell
git add <changed files>
git commit -m "vX.Y.Z: short summary"
git push origin HEAD
```

5. **GitHub release with installers** (required for in-app **Update now** and **web installer**):

Every release must include **patch zips + full packages** when a prior manifest exists:
- `Hangup-Portal-{version}-win-x64-patch-from-{prev}.zip` (and mac patch zips)
- `Hangup-Portal-Setup-{version}.exe`, `{version}-win-x64-full.zip`, mac full zips + DMG
- Manifests: `win-x64-latest.json`, `mac-*-latest.json`

After CI: **remove stale assets** (wrong-version duplicates on the same tag). Mark release **Latest**. Rebuild web bootstrap: `npm run dist:web-installer` (uses GitHub `/releases/latest` + Setup matching that tag).

If CI fails with **Artifact storage quota has been hit**, run `npm run cleanup:artifacts` (deletes stale Actions artifacts), then re-run the workflow.

```powershell
git push origin HEAD
# wait for push to finish before CI
npm run cleanup:artifacts   # only if quota blocked prior CI upload
gh workflow run "Release (update packages)" --repo raymondwalkerhs-spec/hangup-hr --ref desktop/1.0.8-beta.1-updates -f tag=vX.Y.Z
gh run watch --repo raymondwalkerhs-spec/hangup-hr
gh release edit vX.Y.Z --repo raymondwalkerhs-spec/hangup-hr --prerelease=false --latest
# remove wrong-version assets if CI re-upload duplicated files
npm run dist:web-installer
```

6. **Update live `app_versions` in Supabase** (required — do not skip):

```powershell
cd "F:\download app hr"   # or your repo root
node scripts/publish-app-version.js --notes "One-line release notes"
```

**1.4.1 → 1.4.2 example (minor — optional in-app update, no force block):**

```powershell
node scripts/publish-app-version.js --version 1.4.2 --notes "Sales edit prefill fix, role-first sales permissions, UI/UX overhaul, stepped registration"
.\scripts\build.ps1 all
npm run package:github -- --full
npm run verify:update -- dist\Hangup-Portal-1.4.2-win-x64-full.zip
.\scripts\publish-github-release.ps1 -IncludeFull
```

Users on **1.4.x** see **Update now** via GitHub Releases check (~5 min + on login). No `--field-breaking` needed unless old EXEs break on new API shapes.

**Note:** if `dist\win-unpacked` is locked, `build.ps1` falls back to `dist-beta7\` (or another `dist-*`). Set `$env:HR_BUILD_OUTPUT = "dist-beta7"` before running `package-github-release` / `publish-github-release.ps1` so they find the artifacts.

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
| **1.6.7** | **true** | Quality ticket uses sales field ACL (`surface=quality`); attachment kind gates; assigned verifier OP/TL edit rules; `test-quality-sales-perms.js` |
| **1.6.6** | **true** | Access control scope fixes: dual-role TL (`leadTeams`), sales RBAC enforcement, export defaults, team dashboard weekends, org privacy, `test-access-scope.js` |
| **1.6.5** | **true** | FP import: AM/PM parse, local dates, agent shift grouping, dedupe, check-in-only days + `test-fp-import.js` |
| **1.6.4** | **true** | FP import: ID+Date-only rows → Attended + "FP date only" note |
| **1.6.3** | false | Single consolidated training payroll per program; training defer/split validation fix |
| **1.6.2** | false | Trainee pay walks attendance in eligible phases; UTC calendar date fix |
| **1.6.0** | false | Training payroll split (Main/Training/Total tabs); fixed 12k/20/600 trainee pay |
| **1.5.3** | false | Stale working-days sync fix; fast batch training load; search debounce |
| **1.5.2** | false | Payroll search (Arabic/ID); trainee rate uses month working days |
| **1.5.1** | false | Payroll page fix when trainees have training programs |
| **1.5.0** | false | Training payroll, dual payslips, Trainee position, resignation notice rules |
| **1.4.6** | false | Sales log PERIOD_LABELS hotfix; advanced filter empty-rule fix (empty list) |
| 1.4.5 | false | Reposition HR/IT/RTM backend_pool fix; optional enforce ID prefix on reposition / change app ID |
| 1.4.4 | false | Hotfix: blank screen (app.js brace), IT role assignable + Access Control picker, payslip nav fix |
| 1.4.3 | false | RBAC hardening (IT role, attendance transport, bonus/deduction visibility, employee privacy, org/equipment scoping), sales UI two-status model, payment backfill + dedupe scripts |
| 1.4.2 | false | Sales edit prefill fix, role-first Sales permissions, UI/UX overhaul (tokens/buttons/tables/login), stepped registration |
| 1.4.1 | false | Sales log all columns, filter dropdowns, bank fields, verifier/client feedback, Sales permissions + Log columns pages, org modal/search fixes |
| 1.4.0 | false | Working day, advanced filter, org/dashboards, sales access surfaces |
| 1.3.13 | false | Notifications, routing, quality notes, user purge |
| 1.3.12 | false | Per-tab search, focus fix |
| 1.3.1 | false | Supabase-only sale attachments |
| 1.3.0 | false | Sales export; catalog validation |
| *(older)* | false | See `CHANGELOG.md` |

_Update this table when shipping a new version. Confirm live row: `SELECT * FROM app_versions WHERE is_current = true`._

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
same PR/session as `CHANGELOG.md`, `README.md`, `SALES_LOG.md`, and `FEATURES.md` when features change.

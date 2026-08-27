# AI Agent — Hangup Portal project context

> **Data backend:** Supabase only. **Do not use Google Sheets.** Historical sheet layout: [`LEGACY_GOOGLE_SHEETS.md`](LEGACY_GOOGLE_SHEETS.md).

> **Exception:** `routes/interview.js` + `lib/google-sheets.js` intentionally use Google Sheets for the Interviews module. Treat this module as the sanctioned exception.

## Interviews module notes
- Frontend: `public/js/interview.js` — renders into `#app` via `InterviewModule.init(root)`. Falls back to `document.getElementById("app")` if no container is passed.
- Backend: `routes/interview.js` — CRUD at `/api/interview/*` with HR/Admin/CEO access only.
- Sync: 5s polling from frontend; backend reads/writes Google Sheets directly.
- Training fields are disabled unless Status == Approved.
- Nav item ID: `nav-interview`, page key: `interview`, sidebar group: People.

Internal reference for Cursor / coding agents. **Read this at the start of a session** when working on
Hangup Portal. Keep it updated when architecture, release process, or key decisions change.

---

## What this app is

- **Hangup Portal** — Windows **Electron + Express** desktop HR app (installer + portable EXE only).
- **Workspace:** repo root (e.g. `F:\download app hr`) — **single codebase**; no `hr-app/` mirror
- **Product name in builds:** `Hangup Portal` (`package.json` → `build.productName`)
- **Current version:** `2.4.9` (`package.json` → `version`)
- **Previous:** `2.4.7`
- **Updates:** GitHub Setup.exe on `major.minor` change or optional installer ships (`2.4.9`); Supabase zip on third-segment (`2.4.1` → `2.4.2`). Pipeline: [`PUSH_UPDATE.md`](PUSH_UPDATE.md).
- **Premium themes:** Gotham / Hello Kitty / Spiderman unlock at **10** RPM sent as agent **or** 10 closed as closer this month; **Turtle Grove** (`turtles`) at **15** sent or 15 closed. Admin/CEO/HR always unlocked (`lib/theme-unlocks.js`).

---

## Live backend (Supabase only)

| Item | Value |
|------|--------|
| Active backend | `DATA_BACKEND=supabase` in `.env` (**required** — `sheets` throws at startup) |
| Supabase project | `https://ugntjwqimgosuiodsnnk.supabase.co` |
| Auth users | `app_users` (bcrypt passwords, optional `email` column) |
| Version policy | `app_versions` table (`lib/version-sheet.js`) |
| Documents | Supabase Storage bucket `hr-documents` |
| MLA sale attachments | Supabase Storage `hr-documents` → `mla-sales-attachments/{saleId}/{kind}/…` (legacy `sales-attachments/…` still valid; signed URLs ~7 days) |
| RPM sale attachments | Supabase Storage `hr-documents` → `rpm-sales-attachments/{saleId}/{kind}/…` (quality_record, recording, raw_call) |
| Announcements | Table `announcements` (`audience_units/teams/roles`, `image_placement`); storage `hr-documents` → `announcements/{company}/{id}/…`; API `/api/announcements` |
| Coaching tickets | Table `coaching_tickets`; API `/api/coaching`; secret notes stripped unless `viewCoachingSecret` or author |
| Airtable sales sync (optional) | MLA: `AIRTABLE_API_KEY` + `AIRTABLE_BASE_ID` → table **NEW MLA** / `AIRTABLE_TABLE_NAME`. RPM: **separate** `AIRTABLE_RPM_BASE_ID` → **RPM Sales** + **Q Feedback** + **NQ Checks**. Live RPM sync is **Supabase → Airtable** (DB trigger + Edge Function `airtable-rpm-sync`); deploy `npm run deploy:airtable:rpm-sync`. Desktop app does not write Airtable unless `AIRTABLE_RPM_SYNC_FROM_APP=true`. |
| Local cache | SQLite per PC (`better-sqlite3`) — **keep this**; do not read Postgres on every UI click |
| Legacy Sheets | **Removed from runtime** — see [`LEGACY_GOOGLE_SHEETS.md`](LEGACY_GOOGLE_SHEETS.md) |

**Data flow:** Supabase (source of truth) → sync → SQLite on each machine → fast UI reads. Writes go
to Supabase via Express, then re-sync.

---

## Security (v2.2.0+)

| Topic | Implementation |
|-------|----------------|
| Sessions | No plaintext password in memory; `password_changed_at` snapshot + `app_sessions.revoked_at` |
| Secrets | Build-time `.env` copied to `resources/.env` in the installer; first launch seeds `userData/HangupHR-data/.env` (not committed to git) |
| `SESSION_SECRET` | `lib/assert-session-secret.js` — packaged builds throw on default secret |
| CSP | `app.js` sets Content-Security-Policy; Lucide vendored at `public/vendor/lucide.min.js` |
| Login | No save-password checkbox; legacy `hr_saved_password` purged on load |
| PostgREST filters | `lib/postgrest-filter.js` sanitizes usernames in `.or()` strings |
| Interview feedback | Candidate scope check before create/edit/delete; `company` stamped on insert |
| Supabase probes | `GET /api/supabase/health` and `/status` require admin/CEO session |
| Updates | Zip-slip guard (`lib/zip-extract.js`); GitHub host allowlist in `lib/github-updater.js` |
| Tests | `npm run test:security` |

**Intentionally unchanged:** hardcoded `raymond` / `mark` admin usernames (H2).

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
| Interviews UI | `public/js/interview.js`, `public/css/interview.css` |
| Interviews server | `routes/interview.js`, `lib/google-sheets.js` |
| Sales UI | `public/js/sales.js`, `public/js/sales-permissions-pages.js`, `public/js/sales-config-breaks.js` |
| Sales server | `routes/sales.js`, `lib/sales-field-catalog.js`, `lib/sales-list-columns.js`, `lib/sales-filter.js`, `lib/sales-working-day.js`, `lib/sales-field-access.js`, `lib/airtable-sales-sync.js`, `lib/airtable-sales-field-map.js`, `lib/airtable-client.js`, `lib/airtable-rpm-sales-sync.js`, `lib/airtable-rpm-qfeedback-sync.js` |
| Access Control UI | `public/js/access-control.js`, `lib/permission-catalog.js`, `lib/role-permissions.js` |
| API | `routes/api.js`, `routes/admin-users.js`, `app.js` (Express entry) |
| Data layer | `lib/data-store.js`, `lib/backend.js`, `lib/supabase-repo.js`, `lib/cache.js` |
| Auth | `lib/auth.js`, `lib/auth-supabase.js`, `lib/session-store.js`, `lib/assert-session-secret.js` |
| Security helpers | `lib/postgrest-filter.js`, `lib/require-admin-session.js`, `lib/zip-extract.js`, `scripts/test-security.js` |
| Users CRUD | `lib/users-admin.js`, `lib/roles.js` |
| Analytics | `lib/analytics-aggregates.js`, `public/js/analytics.js`, `GET /api/reports/analytics` |
| TL bonus linking | `lib/tl-bonus-link.js` — paired TL/OP deduction ↔ bonus rows |
| GitHub in-app updates | `lib/github-updater.js`, `lib/cloud-updater.js`, `lib/zip-extract.js`, `lib/update-integrity.js`, `PUSH_UPDATE.md`, `UPDATES.md`, `.github/workflows/release.yml` |
| Org & registration | `lib/org-hierarchy.js`, `lib/registration.js`, `lib/training-phases.js`, `public/js/hrms-features.js` |
| Electron | `electron/main.js`, `electron/preload.js` |
| Build | `scripts/build.ps1`, `package.json` → `build` section |
| Migrations | `supabase/migrations/`, Supabase MCP `apply_migration` / `execute_sql` |
| Docs (user + agent) | `TUTORIAL.md`, `FEATURES.md`, `SALES_LOG.md`, `CHANGELOG.md`, `UPDATES.md`, `AI_Agent.md` |
| Env template | `.env.example` (never commit real `.env` or secret keys) |

**Naming trap:** `lib/supabase-client.js` is the client module — not `lib/supabase.js` (folder conflict).

---

## UI themes

React (`src/styles/tokens.css`, `hangup-theme` in localStorage): `light` (default), `dark`, `violet`, `pink`, `red-wine`, `diamond`, `emerald`.
Legacy vanilla: `public/js/theme.js` + `public/css/app.css` (`hr_ui_theme`).
Picker: Settings → Appearance, or cycle from the header.

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
16. `20260820_training_anchor_override.sql` — `payroll_adjustments.training_payroll_anchor_month` (HR override for training pay anchor)
17. `20260814_announcements_and_coaching.sql` — `announcements` + `coaching_tickets` (RLS deny-all; app uses service role)

See [`DB_SCHEMA.md`](DB_SCHEMA.md) for full table reference.

---

## Organization & company structure (user-defined rules)

| Rule | Implementation |
|------|----------------|
| **Unit → Team → Agent** | Organization page; OP per unit, TL per team, **closers** per team (sales/IT on behalf) |
| **HS-1, HS-3** | Main Hangup; OP manages each unit |
| **HS-2** | **Separate company** — switcher is admin/ceo/hr only (`manageHs2Company` hard-denied for OP/TL/agent); native HS-2 staff stay on their unit; strict isolation — HS-2 data only in HS-2 context; test: `node scripts/test-hs2-access.js` |
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
| **Agent** | Self row, docs upload, no card/filters | Own team + OP view | Status, device, customer only; no export | My payslip when HR releases | Own devices only while assigned |
| **TL** | Team roster read-only; no edit others | View | Team scope; OP can grant 24h wider view | — | Own devices only while assigned |
| **OP** | Unit roster | View | Unit scope; grant temp visibility | — | Unit inventory |
| **Quality/RTM** | Self (scoped) | View + PIN | Company/team per rules; write notes | — | Own devices only while assigned |
| **HR/Admin** | Full CRUD | Team structure (admin/ceo/hr) | Full + **Sales permissions** / **Log columns** pages (RTM/admin/hr) | Full + release to agent | Full |

**Sales admin pages (1.4.1+, role-first since 1.4.2):** sidebar **Sales permissions** and **Log columns**. Visible when `canViewSalesAdmin` / `canManageSalesFieldPermissions` — **RTM / Admin only** (HR removed in 1.4.3).

**Announcements:** Overview nav `/announcements`. `viewAnnouncements` all roles; `editAnnouncements` HR/RTM/Admin/CEO. Company from request context. Audience: empty unit/team/role arrays = whole company; otherwise AND across selected dimensions (OR within a dimension). Editors see all. Image placement `top` / `middle` / `bottom`. `GET /announcements/options` for pickers. Publish fans out `app_notifications` (`type=announcement`). Unread badge: `announcement_reads` + `GET /announcements/unread-count`; `POST /announcements/:id/read` when opened.

**Coaching:** People nav `/coaching`. `lib/coaching-scope.js` + `/api/coaching` (company column hangup|hs2). Agent picker: TL/Closer team agents only (no other coaches, no Out/HR/Quality/Admin); OP unit agents + TL/Closers; Quality/HR/Admin company agents. Coach: TL/Closer locked to self; Quality = quality team; OP = unit TL/Closer/agents; HR = TL/Closer/Quality; Admin = any. Secret notes: HR/Quality/Admin (+ coach/submitter). Date/time + delete: Admin/CEO. Outcome + extra notes: coach after session. Role checks prefer live `app_users.role` over ID prefixes.

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
| **Working day** | Until **2 AM Cairo** counts on previous day; RPM Day filter defaults to current Cairo working day |
| **List columns** | All catalog fields + Day/Time/Agent/Closer/Customer — admin enables on **Log columns** page; visibility ∩ field view ACL |
| **Toolbar filters** | Client, Agent, Closer, Status (all periods). RPM Day is a calendar (privileged roles). |
| **Advanced filter** | AND/OR/NOT when 2+ rules; employee/client dropdowns for ID fields; persisted in `localStorage` |
| **Add sale** | Opens only from **+ Add sale**, dock Sale, or command palette — not from visiting `/sales`. Unit → agent (team auto-fills from agent). Closer scoped by role (self + team TLs for agents; self default for org closers/TLs). Org closers/TLs see dialing agents on closer/lead teams (e.g. Amy → Tris), not TLs. `employees.sales_agent_picker` SQL override. Catalog client/device/price when configured |
| **Sales log visibility** | Row visible to team TL, assigned closer (`closerId`), and assigned agent (`agentId`). Not all closer-team sales. |
| **Q Feedback Sale closer** | When a Q auto-links to an RPM sale, `rpm_checks.closer_id` is set from the sale (DB triggers `20260904_rpm_checks_closer_from_sale` + `linkSaleToCheck`). Reassigning the sale closer updates linked Q rows. |
| **Checks MCN uniqueness (2.4.8)** | One live check per `(company, member_id_normalized, working_day)` **any agent**. Second insert → **409** `MEMBER_DAY_EXISTS`. Re-status / Duplicate = **PATCH** existing row. Invalid pattern → **"Wrong MCN"**. Names: letters + space/hyphen/apostrophe; phones digits only. |
| **Sale ↔ Q auto-link (2.4.8)** | Same `working_day` only (prefer same agent). May overwrite disposed feedback (`not_int`, etc.) to **sale**. No cross-day FIFO. |
| **RPM create validation (2.4.8)** | Empty requireds (incl. alt/emergency phone) red-glow after submit attempt only (not on open/draft). Soft duplicate ConfirmDialog via `GET /rpm-sales/identity-check`; notify Quality/RTM/Admin (`rpm_sale_duplicate`). Never hard-block the sale. |
| **Bank payment** | routing number, bank name, account number, address, who chose bank account (required fields when Bank account) |
| **Verifier feedback** | Dropdown; assigned verifier + RTM/Admin override |
| **Client feedback** | Dropdown; RTM/Admin edit only |
| **Quality/RTM** | Unit toggles HS-1/2/3 on log |
| **Attachments** | MLA: `mla-sales-attachments/{saleId}/…` (legacy `sales-attachments/…`); RPM: `rpm-sales-attachments/{saleId}/…`; quality records in separate `quality_record/` subfolders per program; signed share URLs ~7 days |
| **Airtable sync** | MLA: optional `.env` `AIRTABLE_BASE_ID` / `AIRTABLE_TABLE_NAME` (still from the Portal). RPM: separate `AIRTABLE_RPM_BASE_ID` (tables **RPM Sales**, **Q Feedback** completed dispositions, **NQ Checks** with a 10-digit form phone). RPM live sync is **Supabase → Airtable** (trigger + `airtable-rpm-sync`); upsert by Portal UUID (edits PATCH the same row). Manual backfill: `npm run sync:airtable:rpm`. |
| **RPM1 Google Form** | New inserts with Client **RPM1** only → **Supabase** Edge Function posts **both** Google Forms (TEST + Direct Tracking). Desktop app never submits. No backfill when adding a form. Env: `GOOGLE_FORM_TARGETS_JSON`. Deploy: `npm run deploy:rpm-google-form`. |
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

**Fast ship (installer only, ~2 min upload — no patch zips):**

```powershell
.\scripts\build.ps1 installer
npm run dist:web-installer
npm run publish:installer
```

**Full ship (patch zips for in-app delta updates — slow):**

```powershell
.\scripts\build.ps1 all
.\scripts\publish-github-release.ps1 -IncludeFull -MultiPatch
gh release edit vX.Y.Z --repo raymondwalkerhs-spec/hangup-hr --latest
node scripts/publish-app-version.js
```

**Note:** if `dist\win-unpacked` is locked, `build.ps1` falls back to `dist-beta7\` (or another `dist-*`). Set `$env:HR_BUILD_OUTPUT = "dist-beta7"` before publish scripts.

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
| App update hosting | GitHub Setup.exe on line change; Supabase Storage `app-updates` for same-line zip patches after 2.4.1 (`PUSH_UPDATE.md`) |
| Local SQLite cache | **Keep** — performance layer on each PC |
| User management | **Raymond only** |
| Password reset | Manual by Raymond today; `email` column ready for future |
| Supabase Auth / MFA | Not implemented |
| Browser / localhost server mode | Removed — desktop only |

---

## Current `app_versions` state

| version | is_current | notes |
|---------|------------|-------|
| **2.4.9** | **true** | Turtle Grove premium (15 RPM sent or 15 closed); spinning turtle loader + slow turtles on `/cats`; Gotham/Kitty/Spidey stay at 10. Optional update (`min_compatible=1.0.0`). GitHub Latest 2026-08-27. |
| **2.4.8** | false | Checks MCN uniqueness (409 same day); Wrong MCN / letters name / digits phone; RPM create red glow + soft dup warn (Quality/RTM/Admin); same-day Sale↔Q auto-link; Supabase→Airtable RPM Edge sync; Q closer from sale triggers. Optional update (`min_compatible=1.0.0`). Was Latest before 2.4.9. |
| **2.4.7** | false | Dead form fields / Electron confirm residue; Employee Out lag + depart date; deductions/bonuses Edit-Delete; Select search lag in dialogs; RPM Airtable Client RPM3; Import from open Q closer scope. Was Latest before 2.4.8. |
| **2.4.0** | false | Dropdowns work in dialogs (click, search, scroll) including RPM Add sale. Installer-only Latest 2026-08-18; in-app Update now from 2.3.29. |
| **2.3.29** | false | Hotfix: 2.3.28 would not start (`await` in IT PATCH), blank login (`CatsPage` import), shell crash (`PageLoadingOverlay` import). Breaking ship 2026-08-18. Local NSIS, no GH Actions. |
| **2.3.28** | false | UI/UX makeover: Select, recycle bin, dropzone, RPM member ID, attendance drag-select, sales period picker, agent payslip tab, transport grant, reconnect banner, agent guide, Cats tab. Closers with TL access who are not assigned TLs (Amy, Ria) see only own attendance; TL/closer dashboard Units KPI is teams they close. Team dashboards use RPM columns. OP assignment is idempotent (HS-3 OP1 Steven). First makeover EXE crashed on load; superseded by 2.3.29. |
| **2.3.27** | false | Equipment inventory + Clearance/Offboarding interactive tables; Emerald theme. Shipped GitHub Latest + Supabase `is_current` 2026-08-17. |
| **2.3.26** | false | Sales dashboard reliability: Cairo RPM day calendar, explicit Add-sale intent, role-scoped sales/attendance widgets, and HS-2 switcher hardening. Shipped GitHub Latest + Supabase `is_current` 2026-08-17. |
| **2.3.25** | false | Sales log defaults to RPM; NSIS includes React `public/dist` (DNA login). Installer-only Latest 2026-08-17. |
| **2.3.23** | false | Roster freshness for dialing pickers; MLA+RPM submission date/time correction (date+time columns); Deleted excluded from picker; RPM sort/filters/search; portal `sale_edit_history` for Quality/RTM/Admin/CEO. |
| **2.3.22** | false | Sale agent picker uses employees/`org_teams` (+ `sales_agent_picker` DB override), not `app_users.role`; team field follows selected agent. Shipped GitHub Latest + Supabase `is_current` 2026-08-13. |
| **2.3.21** | false | Announcements + coaching; live role over ID prefix; agent/closer sale submit (Amy Tris closer teams, agent-role closers); HS-2 employee move confirmation. Shipped GitHub Latest + Supabase `is_current` 2026-08-13. |
| **2.3.20** | false | Viewport cat loading overlay; payroll cache-first + prefetch; quality tickets use live Users role (HR-2 Eva); hide-zero display net; unified payroll trainees; RPM/MLA closer picker includes org closers as self (Ria). Shipped GitHub Latest + Supabase `is_current` 2026-08-12. |
| **2.3.19** | false | Closer picker Out/Deleted fix; unified payroll trainees visible; hide-zero = display net; Rose→Rose Brown merge; payroll core month-WD daily rate; HR→Quality transfer uses live `app_users.role` for quality tickets |
| **2.3.18** | **true** | Quality reviewer picker role enrichment; RPM canEditAttachmentKind; RTM reviewer edit on RPM |
| **2.3.17** | **true** | RPM optional Notes; quality ticket recordings + reviewer ACL; inline audio in React sales modals |
| **2.3.16** | **true** | Payroll page TDZ crash fix; PayslipDialog conditional mount; isOutEmployeeStatus dedupe |
| **2.3.15** | false | Training payroll defer/anchor fix; HR anchor month override; payroll history enrichment; login OTP/DNA UI |
| **1.7.10** | false | IT ticket delete fixed for Admin/CEO; deleteItRequest permission in Access Control |
| **1.7.9** | false | Meeting requests participant scoping; IT ticket timing; IT DB unit column fix |
| **1.6.24** | **true** | No recording required on submit; Agent/TL hidden from recordings; sale delete confirm button fix |
| **1.6.23** | **true** | Quality comments cache fix + permission override; sale delete Electron fix; Airtable immediate sync |
| **1.6.22** | **true** | Quality ticket save/delete fixes, Airtable delete on sale remove, out agents blocked from reviewer/verifier |
| **1.6.21** | **true** | Sales log load fix (duplicate `uploadKinds` broke `sales.js`) |
| **1.6.20** | **true** | Sales log time sort, quality ticket save fix, multi-file attachment upload |
| **1.6.19** | **true** | HS-2 access locked to CEO/Admin/HR (+ Quality in sales); patch release |
| **1.6.18** | **true** | Airtable upsert (no duplicate rows), attachment sync/clear, faster sync |
| **1.6.17** | **true** | Org TL display, released ID reuse, org_teams-only team pickers, sale delete → Airtable |
| **1.6.16** | **true** | Sales form hardening: delete sale, reassignment pickers, validation, draft, double-submit guard |
| **1.6.13** | **true** | Add sale team auto from agent; hide quality section on submit |
| **1.6.12** | **true** | Add sale submit surface; role-scoped pickers; My docs upload types; hide annual from agents |
| **1.6.11** | **true** | View sale read-only modal; fix quality ticket Sales permissions (camelCase qualityViewRoles) |
| **1.6.10** | **true** | Robust sales ACL: unified resolver, tabbed permissions, attachment ACL DB, cross-unit closer names, live user-exception defaults |
| **1.6.9** | **true** | Sales field ACL surfaces; OP verifier tickets; remove bankAccountChosenBy; payment backfill flags |
| **1.6.8** | **true** | Audit remediation: ACL/RBAC fixes, sales action permissions wired, web installer version pin, single-patch publish, `npm test` |
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

## Multi-Company Architecture (v1.29+)

**Company Structure:**
- **Hang-Up**: Merged HS-1 and HS-3 units (default company)
- **HS-2 Company**: Separate company for HS-2 and HS2-PT units
- **Dynamic companies**: Admin can add additional companies via Settings

**Database Tables:**
- `companies`: Company registry with slug, name, display settings
- `company_role_permissions`: Per-company role permission overrides
- `org_unit_managers.company_slug`: Links units to companies

**Code References:**
- `lib/company-context.js`: Company filtering and context resolution
- `lib/companies-repo.js`: Company CRUD operations
- `lib/roles.js`: `canManageCompanies()`, `canManageHs2Company()`

**Finance Company Scope (v1.30):**
- Finance tables now include `unit` column for per-company separation:
  - `employee_loans`, `loan_payments`
  - `bonus_events`, `deduction_events`
  - `bonus_requests`, `expense_requests`
  - `monthly_bills`, `petty_cash_funds`, `petty_cash_ledger`

---

## Agent doc maintenance

When you change release process, backend, roles, or build output paths, update **this file** in the
same PR/session as `CHANGELOG.md`, `README.md`, `SALES_LOG.md`, and `FEATURES.md` when features change.

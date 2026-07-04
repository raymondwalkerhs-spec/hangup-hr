# Changelog

All notable changes to the Hangup Portal desktop app.

## [Unreleased]

## [1.3.10] — 2026-07-04

### Changed
- **Product name** — rebranded from “Hangup HR” / “Hangup HR Beta” to **Hangup Portal** in the app UI, PDF exports, installers, and GitHub release assets (`Hangup-Portal-*`). In-app updater still accepts legacy `Hangup-HR-*` assets for upgrades.
- **Web installer** — `Hangup-Portal-Web-Setup.exe` (small bootstrap with progress bar; downloads full Setup from GitHub)

## [1.3.9] — 2026-07-04

### Added
- **Per-user access overrides** — exception permissions on App Users (`app_user_permissions`, migration `20260717`)
- **Access Control:** role-first permission editor; `submitSales`, `workQualityTicket` keys; separate HR vs Admin sales column UI
- **Registration workflow** — unit-only signup, daily PIN, pending queue on Organization/Users; OP/HR approve creates next free employee ID
- **App Users filters** — unit, team, role on Users page

### Changed
- **Organization:** Save / assign team auto-relocates when unit changes (Office, HS3 OP, etc.); TL picker allows any TL with double confirm
- **Settings UI** — display, session, theme, sync, profile photo, holidays respect Access Control flags from `/status`
- **Impersonation dropdown** — shows American name + username (Raymond testing)

### Fixed
- **Blank screen after 1.3.8 update** — JavaScript syntax errors in `public/js/app.js` (`};` → `});` on event listeners)
- **Registration approve “ID already exists”** — allocates next truly available ID (reserved + in-use)
- **Agent without linked employee ID** — Employees/Attendance show nobody (not full directory)
- **Agents in Settings** — federal/Egyptian holiday cards hidden unless `settingsHolidays` granted
- **Unassigned agents on Organization** — see themselves under “Unassigned (no team)” using live employee team, not stale login team
- **Team relocate ID collision** — safe ID allocation when reassigning dialing agents
- **Settings permissions** — Access Control toggles now apply to UI and API (hide-out, holidays, session)

## [1.3.8] — 2026-07-04

### Fixed
- **False “Reinstall required”:** packaged apps use `app.getAppPath()` — if Electron is running, install is healthy (no bad asar probe)
- **GitHub update trap:** latest GitHub release was still v1.3.6 (broken RBAC build); ship v1.3.8 as current
- **Raymond / superadmin role:** login stores canonical role (`superadmin` → `admin`); DB roles normalized via `scripts/normalize-app-user-roles.js`
- **RBAC role aliases:** permission catalog and version checks understand `superadmin`, `administrator`, etc.
- **Warm-cache boot fallback:** `refreshStatus()` before render on error recovery path

## [1.3.7] — 2026-07-04

### Fixed
- **Login stall after RBAC:** removed blocking `loadOverrides()` from every authenticated request; preload once at server start with deduplicated Supabase fetch
- **Warm-cache boot:** call `refreshStatus()` before first render so nav/permissions load immediately
- **False “Reinstall required” banner:** `installHealth` uses `process.resourcesPath/app.asar` and skips check in unpackaged dev mode

## [1.3.6] — 2026-07-04

### Added
- **Access Control** admin page (admin/ceo) — manage role permissions across the app
- `app_role_permissions` table — DB overrides merged with hardcoded defaults in `lib/roles.js`
- Permission catalog (`lib/permission-catalog.js`) and resolver (`lib/role-permissions.js`)
- API: `GET/PUT /rbac/catalog`, `/rbac/overrides`, `POST /rbac/reset`
- `npm run apply:migrations` — extended to apply migrations through `20260716`
- [`DB_SCHEMA.md`](DB_SCHEMA.md) — canonical Supabase schema documentation

### Changed
- All feature `can*` helpers in `lib/roles.js` respect DB overrides; empty table = v1.3.4 behavior
- Login / `hasAppAccess()` unchanged — overrides never block sign-in
- `/status` exposes `canManageAccessControl` for admin nav

### Fixed
- Migration apply script now probes and applies `20260707`–`20260716` (org registration, training, payslip grants, RBAC)

## [1.3.4] — 2026-07-03

### Added
- Central RBAC helpers in `lib/roles.js` exposed via `/status` for consistent nav and API gates
- Agent **My payslip** page (view-only when HR enables “Show payslip to agent” per month)
- `GET /employees/available-ids` — pick free IDs within a unit prefix
- `GET /documents/:employeeId/:docId/file` — view uploaded employee documents
- Temporary (24h) sales visibility grants with `expires_at` on `sales_visibility_grants`

### Changed
- **Organization:** team create/edit/relocate gated to admin/ceo/hr; agents see own team + OP only
- **Employees:** agents get read-only self row (no card modal, no filters); TL/OP cannot open edit cards
- **Notes:** HR/admin read; TL/OP/quality/RTM can write without reading history
- **Sales:** agents see status, device, customer name only; no export; RTM/admin manage column permissions
- **Dashboard:** hides company stats/net payroll for agents; scoped quick actions
- **Settings:** agents see theme + profile only (no holidays, session ID, hide-out)
- **Equipment** nav hidden for agents; API gated
- Price tier settings: inline edit with save tick (replaces Edit/Delete buttons)
- Holidays settings: all years collapsed by default
- Employee search debounced; toolbar overflow fixed; `downloadFile` session key fixed

### Fixed
- Reposition **effective month** uses local timezone (not UTC `toISOString`)
- `GET /employees/next-id?leadRole=Agent` uses unit-based ID suggestion
- Manual app ID changes validated against unit prefix
- Team relocate reports skipped agents (non-dialing / no ID rule)
- `noPayroll` and `payslipVisibleToAgent` persist on payroll adjustments

## [1.3.3] — 2026-07-03

### Fixed
- **Invalid package app.asar:** Disable Electron embedded ASAR integrity fuse at pack time (`afterPack`) so replacing `app.asar` + `.exe` via in-app update no longer bricks launch
- **Update failures no longer block startup:** corrupt/missing `app.asar` shows a reinstall banner on the login page instead of a fatal dialog
- **NSIS in-app update:** kill Hangup HR processes before silent installer runs (avoids locked files)
- **Atomic swap:** never delete `.hr-backup` — archive to `.hr-backup.archived-<timestamp>` instead
- **Portable full zip:** require main `.exe` in update payload alongside `app.asar`
- **`publish-github-release.ps1`:** resolve `gh.exe` when not on PATH

## [1.3.2] — 2026-07-03

### Changed
- **GitHub in-app updates:** Installer-primary — Windows NSIS silent `Setup.exe`; macOS full `.app` bundle replace; portable Windows full zip with atomic swap. No more in-app patch overlays (avoids corrupt `app.asar`).

### Added
- Startup recovery: `recoverOrCompleteUpdate()` — finish interrupted swaps, restore from `.hr-backup` if `app.asar` is invalid
- `publish-github-release.ps1` always uploads `Setup.exe` (required for NSIS in-app updates)

## [1.3.1] — 2026-07-03

### Changed
- **Sale attachments:** Supabase only (no Dropbox in app). Run `npm run migrate:sale-attachments` once with a valid `DROPBOX_ACCESS_TOKEN` to copy legacy files from Dropbox into Supabase.
- **GitHub updates:** Multi-version patch zips — users on older releases (not only the previous version) can patch-update.

### Added
- `scripts/migrate-sale-attachments-to-supabase.js` — migrates legacy Dropbox paths to `sales-attachments/…` in Supabase
- `scripts/fetch-all-release-manifests.js` — builds patch zips from multiple prior versions
- `scripts/clean-dist.ps1` — removes stale installer/update artifacts

## [1.3.0] — 2026-07-03

### Added
- **Sale attachments (Supabase):** New recordings and confirmations upload to `hr-documents` bucket (`sales-attachments/…`); share links are signed URLs (~7 days, refresh via Share link)
- **Sales export:** CSV, Excel, or PDF for current filters/date range or a single sale from the sales log
- **Sales catalog (RTM/Admin):** Edit/delete devices and price tiers in Settings; import from sales
- **Sale submission:** TL/OP must pick client, device, and price from catalog when configured (server-validated)
- **Quality ticket audio:** Expanded MIME types (m4a, ogg, webm); visible playback errors; share link modal fallback
- **App users:** Text search (username, name, ID, email, team)
- **Equipment:** Agent search toolbar, deep link `equipment?employee=ID`, agents-only issue modal
- **Raymond impersonation** (from 1.2.6 prep): view app as any user for testing
- **Registration identity** (from prior): national ID / passport, User ID on approval

### Changed
- **Sale attachments:** Primary storage is Supabase (legacy Dropbox paths still download via cache)
- **Sales config permissions:** RTM + Admin only (clients, devices, breaks) — HR/CEO no longer edit catalog
- **Dropbox:** Share links persist to DB; `createSharedLink` surfaces errors; admin status shows scope health
- **UX:** Sticky table headers, zebra rows, unified toolbars on Users/Equipment

### Fixed
- Quality call listen/download/share failing silently (MIME, Dropbox errors, clipboard fallback)
- macOS CI: `build-macos` no longer `continue-on-error`

## [1.2.5] — 2026-07-03

### Fixed
- **App crash on startup:** `ReferenceError: SYSTEM_ADMIN_USERNAME is not defined` in `lib/roles.js` (broken export after Mark/Raymond admin change)

## [1.2.4] — 2026-07-03

### Fixed (permanent in-app updater)
- **Root cause:** PowerShell `Expand-Archive` corrupted large `app.asar` during patch extraction → Electron “Invalid package app.asar”
- **Safe extraction:** `lib/zip-extract.js` — adm-zip per-entry only (never `extractAllTo`, never PowerShell unzip)
- **Integrity:** `lib/update-integrity.js` — ASAR header validation + SHA-256 checksums in `update-info.json`
- **Deferred swap:** `app.asar` + main `.exe` on Windows; `app.asar` on macOS — finish on restart via `.bat` / `.sh`
- **Pre-publish:** `npm run verify:update` + CI verify step on every release zip
- **Packaging:** Patch zips include `fileHashes`; manifest loader skips same-version false diffs

### Added (from 1.2.3)
- Agent training program (4 weekly phases), org hierarchy, agent self-registration, sales fixes — see 1.2.3

## [1.2.3] — 2026-07-03

### Added
- **Agent training program:** 4 weekly phases (Mon–Fri) with statuses Passed / Rejected / Passed (Exception); sales count per phase; phase 1 start auto-fills weeks 2–4; manual date override + recalculate for pause/resume
- **Add agent wizard:** Optional “In training program” with phase 1 start date
- **Organization:** Daily registration PIN + pending agent approvals (OP/HR/Admin); interactive OP/TL assignment
- **Login:** Agent self-register with today’s 4-digit PIN

### Changed
- **Sales log:** Month filter uses submission date only; RTM/Quality unit toggles (HS-1/2/3)
- **Agents:** Database `internal_id` hidden in all agent-facing views and API responses
- **User activation:** Only Mark or Raymond may activate inactive employee logins
- **Back-End org:** Phoebe linked as HR manager; backend teams under HS-Back-End

### Fixed
- Team names normalized (strip “Team ” prefix); device types corrected from Sales All Data.csv
- July sales appearing in June month view

### Applied (Supabase)
- `20260712_org_registration.sql`, `20260713_agent_training_phases.sql`

## [1.2.2] — 2026-07-03

### Fixed
- **In-app update on Windows:** Safe zip extraction (no `chmod` ENOENT on `app.asar`); deferred swap for locked `app.asar`/`.exe` via restart script
- **Patch packages:** Exclude main `Hangup HR Beta.exe` from patch zips (only `app.asar` + changed files — ~80 MB not ~190 MB)

## [1.2.1] — 2026-07-03

### Fixed
- **Quality workflow:** Quality agents open sales as **tickets** (not full edit); can **listen** to recordings/confirmation without upload-only UI
- **Assign Verifier:** Dropdown includes **TL and OP** in addition to quality staff
- **Attachments:** Upload inputs only shown when role has edit permission; view/list for recordings and confirmation
- **Column permissions:** Redesigned table with section groups and sticky headers
- **Breaks:** End time auto-calculated from start + duration
- **Sales clients:** **Import from sales** seeds clients/devices/prices from existing sales data

## [1.2.0] — 2026-07-03

### Added
- **Sales settings:** Clients, products, and prices in **Settings → Sales** (`sales_clients`, `sales_client_products`, `sales_client_prices`)
- **Break schedules:** Admin-defined breaks with in-app popup reminders (`break_schedules`; dismiss per session)
- **Session security:** Server session ID in Settings; **one active session per user**; other devices revoked after **10h idle**
- **Login:** Optional **Save password on this device** (localStorage, device-only)
- **Sale attachments:** Download, delete, replace, and **Dropbox share link**; **Dropbox-only** storage for new sales attachments
- **GitHub updater:** Windows + macOS patch/full zips and manifests (`package-github-release.js`, CI `build-macos` job)

### Changed
- **Sales import:** `import-sales-all-data.js` — `--attachments-only` completed (226/226 Dropbox attachments)
- **Settings revision:** `app_settings_revision` bumps when sales catalog or breaks change (clients reload in UI)

### Applied (Supabase)
- `20260710_v110_relations.sql`, `20260711_v112_clients_breaks.sql`

## [1.1.0] — 2026-07-03

### Added
- **Sales backfill:** `node scripts/import-sales-all-data.js` — replace all sales from `Asset/Sales All Data.csv` with full `form_data`, Airtable→Dropbox attachments (`--dry-run`, `--skip-attachments`)
- **Month-scoped position rates:** `position_rate_monthly` table; Salaries page scoped to selected month; init-month copies prior month snapshots
- **Sale assignment notifications:** `sale_reviewer_assigned`, `sale_verifier_assigned`, `sale_agent_assigned` (employee id → login username)
- **Payroll sales count:** Recalc from sales button on payslip; auto on init-month
- **Audit scripts:** `scripts/audit-relations.js`, `scripts/audit-dropbox-sales.js` (`--fix-links`)

### Changed
- **Unified relations:** `enrichUserRole` prefers `app_users.employee_id`; sales writes sync `agent_internal_id` / `closer_internal_id`
- **Team dashboard:** Unassigned sales warning in day totals
- **OUT payslip:** Clearance/equipment warning banner on payslip open (links to offboarding)

## [1.0.9-beta.7] — 2026-07-03

### Fixed
- **Session:** Login stores plaintext for periodic check — fixes false “Your access was changed” logout every ~5 min
- **Release ID:** `deleteEmployee` works (Supabase-only backend; stub release path)
- **Federal OFF:** Batch attendance write — no Google Sheets quota errors
- **Position rates:** Save errors surfaced; add-position form submit works

### Changed
- **Supabase-only runtime:** Removed Google Sheets from `lib/backend.js`, connectivity, auth, changelog, documents
- Legacy Sheets code moved to `scripts/legacy/` — see [`LEGACY_GOOGLE_SHEETS.md`](LEGACY_GOOGLE_SHEETS.md)
- **Sales:** Reviewer/verifier employee dropdowns; agent/closer read-only on edit; month filter by agent/closer
- **Payroll splits:** `training_bonus` type; defer with custom amount (validated against gross payable)

## [1.0.9-beta.6] — 2026-07-03

### Added
- GitHub update check for all users on boot, session poll, and login (with `GITHUB_UPDATES_TOKEN`)
- In-app prompt/confirm modals replacing Electron-broken `prompt()` / `confirm()` on sales, expenses, payroll

### Changed
- `.env` cleaned for Supabase-only (Sheets/Drive vars removed from production config)
- UI motion: modal fade-in, button press feedback, page transitions, stat card hover

## [1.0.9-beta.5] — 2026-07-03

### HR sprint
- Supabase-only health/status; entity mappers extracted from Sheets
- OUT/depart: worked-in-month payroll, auto-OUT after depart date, federal holiday bulk day-off
- Payslip: offboarding warnings with links, no-payroll toggle, per-split PDF export
- Release app ID: FK rewrites + confirm modal + loading state
- Users: owner skip rules, inactive employee logins, fix-app-users script
- HS2: company filter on bonuses/deductions/org
- Org: assign existing team to unit; position add modal
- Sales: MLA-Ray dynamic form, field permissions API, Dropbox attachments

## [1.0.9-beta.4] — 2026-07-03

### Fixed
- **Notifications:** Bell moved to visible sidebar header; panel positions correctly; plays sound on new items; shows error badge if API fails.
- **Sidebar:** Scrollable nav on desktop; active state respects hidden items; blocked pages redirect to dashboard; Escape closes mobile drawer.

### Changed
- **GitHub publish:** Uploads `win-unpacked` patch zip (changed files only), not installer EXEs.

## [1.0.9-beta.3] — 2026-07-03

### Fixed
- **Petty cash:** Duplicate withdrawals from repeated expense edits are removed during reconcile; corrected live ledger for print thome (balance **14,875 EGP** = 15,075 deposit − 200 withdrawal).

### Added
- **Petty cash:** Finance can **edit posted deposits** (amount + notes) from the ledger; fund balance recalculates automatically.

## [1.0.9-beta.2] — 2026-07-02

### Fixed
- **FP import:** Never overwrites manually entered attendance (including weekday Day-OFF); only empty days and auto weekend placeholders are filled.
- **Build:** `SKIP_NATIVE_REBUILD=1` skips electron-rebuild when prebuilt native modules are present (VS 2022/18 node-gyp issues).

### Added
- **`npm run apply:migrations`** — applies pending Supabase DDL (`internal_id`, `force_update_min_version`, finance/FP schema).
- Agent docs: migrations are applied by the agent (Supabase MCP or script), not delegated to the user.

### Pending (Supabase)
- Run `npm run apply:migrations` or MCP `apply_migration` for: `20260706_employee_internal_id.sql`, `20260706_app_versions_force_update.sql`, `20260708_finance_hr_attendance.sql`

## [1.0.9-beta.1] — 2026-07-02

### Added
- **Costs / finance (FIN-01–08):** Executive approval queue for HR/RTM expenses; monthly bills CRUD; own-pocket settlement; petty cash balance guard; overdue/denied notifications; cache refresh after mutations.
- **Loan approvals (HR-02):** HR submits loan requests; Mark / Phoebe / Raymond approve (hidden from other users).
- **FP attendance import (ATT-05):** CSV/XLS upload, per-month check-in/out rules, `fp_number` on employees, June seed script.
- **Probation / contract alerts (EMP-03):** Dashboard reminders 60 days before end dates.
- **Custom reports (RPT-03):** Save filters and export CSV (employees, attendance, payroll).

### Fixed
- **Petty cash:** Block overdraft; hardened ledger reconcile when editing paid expenses.
- **Finance submit:** Finance users create expenses as `pending` (not `pending_approval`).

### Applied (Supabase)
- `20260708_finance_hr_attendance.sql` — `fp_number`, probation/contract dates, `loan_requests`, `saved_reports`, `attendance_imports`

## [1.0.8-beta.1] — 2026-07-02

### Added
- **Company scope everywhere:** Payroll, attendance, org, sales, and team dashboards respect Main Hangup vs HS-2 toggle (HS2 IDs included).
- **Team dashboards:** Active dialing agents only; Day-OFF excluded from roster; sales from main log.
- **App users:** Employee ID column, filter/sort, group-by-team, sync missing inactive logins.
- **Reposition:** HR, RTM, IT backend transfers with IT01-style IDs; login role updates on promote.
- **Equipment:** Simplified issue flow — pick agent + device; unit auto from employee.

### Fixed
- **Petty cash:** Idempotent ledger sync — toggling cash ↔ petty cash no longer duplicates withdrawals.
- **Position dropdown:** Edit employee and wizard use salaries position-rates list.
- **HS-2 roster:** Migration removes Kate team, adds HS2-MGMT, assigns Hazel/Robert as HS-2 OP (apply `20260705_hs2_mgmt_roster.sql`).

## [1.0.7-beta.3] — 2026-07-02

### Added
- **Team dashboards:** New daily/weekly page matching the spreadsheet layout (agent roster + team summary). Excludes non-dialing roles (HR, RTM, OPs, TLs, closers, part-time).
- **Organization by unit:** Teams grouped under HS-1, HS-2, HS-3, HS-MGMT; add/edit teams, assign agents inline.
- **Company switcher:** Clear “Managing: Main Hangup | HS-2” toggle in the sidebar.

### Changed
- **Sales log:** Former Sales page is now a record log only; period team grid moved to Team dashboards.

### Fixed
- **Depart:** Auto-creates employment period when missing; setting status to Out from the employee form runs the proper depart flow.

### Applied (Supabase)
- `org_teams_registry` — `org_teams` table with unit assignment and dial roster flags

## [1.0.7-beta.2] — 2026-07-02

### Fixed
- **Petty cash:** Editing a paid receipt amount now updates the linked ledger withdrawal and recalculates fund balance (was stuck on the original amount).
- **Idle logout:** 10-minute auto sign-out now survives minimized/background windows (checks elapsed time on focus) and resets on API activity.

### Applied (Supabase)
- `public_holidays_active` — `public_holidays.active` column
- `v107_unified_requests_schema` — paid leave, requests, last login, notice type columns

## [1.0.7-beta.1] — 2026-07-02

### Added
- **Unified Requests:** Annual (paid Day-OFF), unpaid, medical, and same-day off in one module; late submission after 12:00 flagged; TL/OP team requests with HR warnings.
- **Paid leave payroll:** Approved annual leave counts as working day (`paidLeave` on attendance).
- **Sales period grid:** Daily date picker, weekly week picker, team×date passed-sales matrix with agents-off overlay.
- **Costs:** Edit/delete receipts, archived tab, release from on-hold; audit notifications to Raymond.
- **Equipment:** Edit assets, fixed type dropdown, double-assign guard.
- **Departure:** With/without 2-week notice; 10 working-day basic deduction for no-notice departures.
- **HS-2 company mode:** Sidebar toggle filters roster to HS-2 scope; default Hangup view hides HS-2 staff.
- **Users:** Last login tracking; auto-create inactive `app_users` on employee create.
- **Audit routing:** Raymond notified on unusual edits; Mark never notified; Phoebe/Eva/Aurora get HR warnings.

### Fixed
- Hide out / hide zero net pay filters in attendance and payroll.
- Clearance/equipment payslip blockers only for departed or offboarding agents.
- Payslip commission type tab removed (tiers remain in payroll engine).
- Settings: federal holiday import and empty-ID cleanup error surfacing.

### Changed
- Nav **Leave** → **Requests**; reposition uses position-rates dropdown; sale closer select; bonus/deduction delete requires confirmation.
- Out-agent bonuses rejected after depart date.

### Migration
- `supabase/migrations/20260703_v107_schema.sql`

## [1.0.6-beta.1] — 2026-07-02

### Added
- **Sales:** Edit modal + field PATCH; day/week/month dashboard; status stat cards (passed/pending/callback/denied); month list matches effective or submission date.
- **Costs:** Wider receipt modal, file upload, petty cash deposit/mark-paid modals, ledger view, `GET /expenses/:id/receipt`.
- **Attendance:** Sticky column backgrounds; holiday styling on body cells; per-agent **Mark month Attended** bulk action.
- **Federal holidays:** USA 2024–2028 seed/import; per-holiday active toggle; prefill-only Day-OFF on init-month (never overwrites existing cells).
- **HRMS lifecycle:** Modals for re-hire, depart, employment periods, Action Plan Week (renamed from AIP); panel refreshes after actions.
- **Organization:** Live team rosters from employee records.
- **Equipment:** Add asset, assign to agent dropdown, return workflow.
- **Leave:** Employee dropdown instead of manual ID.
- **IDs:** HS3 pad to 3 digits at ≥100; Reposition modal (role, team, position); empty stub cleanup in Settings.
- **Payroll:** Hide zero net pay toggle.
- **Nationality:** Select dropdown + expanded list and spelling aliases.

### Changed
- Repositioning keeps prior agent record **Active** (removed **Promoted** status on superseded records).
- Commission types removed from Settings (tiers remain on Payroll page).
- UI polish: page fade-in, clickable stat cards, wider modals.

### Migration
- `supabase/migrations/20260702_public_holidays_active.sql`

## [1.0.5-beta.2] — 2026-07-02

### Fixed
- **Performance:** Warm local SQLite cache loads UI immediately; background sync refreshes data. Page navigation no longer shows full-screen loader after first paint.
- **Race condition:** Fixed wrong page showing after fast tab switching (e.g. attendance → loans).
- **WebSocket / Supabase:** Added `ws` transport — fixes Costs, notifications, and other Supabase reads in Node/Electron.
- **Notifications panel:** Fixed transparent/unreadable panel (missing CSS variables).
- **Changes page:** Toolbar and buttons now use solid card backgrounds.
- **Employee filters:** Hide out + nationality filter now excludes Out agents on client and server; nationality matching is case-insensitive.
- **Bonus requests:** TL/OP submissions limited to **Bonus from TL / OP** type only (HR adds other types directly).

### Changed
- Business data (sales, expenses, bills, bonus requests) cached in SQLite during sync.
- Build outputs consolidated to `dist\` only (`npm run dist`).

## [1.0.5-beta.1] — 2026-07-02

### Added
- **Bonus approval:** TL/OP/quality/RTM submit bonus requests for agents; HR+ approves/denies; leadership roles receive bonuses via payslip only.
- **Sales module:** Per-sale records (phone, name, device, agent, closer); statuses passed/pending/postdated/denied/callback; TL submissions need approval; sales dashboard by team/week.
- **Sales visibility grants:** OP/admin/quality/RTM can delegate cross-team read scope (TL cannot pass cross-team to agents).
- **Costs module:** Expense receipts/invoices, petty cash ledger, monthly bills; finance access (Mark, Phoebe, Raymond, finance role); HR can submit own requests.
- **Persistent notifications:** `app_notifications` table; bell merges with leave/doc alerts.
- **Role:** `office_assistant` added to Users dropdown.
- Migration: `supabase/migrations/20260702_sales_bonus_costs.sql`

### API
- `/api/bonus-requests`, `/api/sales`, `/api/expenses` (+ petty cash, bills sub-routes)


### Added
- **Employee nationality & compliance:** nationality field (suggestions: Egyptian, Sudanese); non-Egyptians get work permit dropdown; Egyptians get insured/not insured with optional insurance type, amount, and employee deduction.
- **Employee filters:** filter by nationality, work permit, and insurance status on the Employees page.
- **Supabase ops:** RLS deny-all applied; `app_versions` set to `1.0.4-beta.2`; employment period backfill + equipment seed run.

## [1.0.4-beta.2] — 2026-07-02

### Added — HRMS advanced features
- **Employment lifecycle:** `employment_periods` table, depart/re-hire API, attendance guards outside active periods, working-days override audit banner.
- **Action Improvement Plans (AIP):** Mon–Fri week picker; payroll triples all deductions in-plan week; Lateness A fixed at 75 EGP; Day-OFF deducts 3 salary days; payslip section notes.
- **Onboarding / offboarding / clearance:** Checklists per employee; payroll approval blocked until final pay, clearance, and equipment returned.
- **Equipment registry:** Asset tracking + assignments; seed script `scripts/seed-equipment.js`.
- **Leave (ATT-01):** Request + approval queue; approvers Mark, Raymond, Phoebe only; approved leave auto-creates Day-OFF rows.
- **Federal holidays (ATT-02):** CRUD in Settings; pink columns in attendance grid.
- **Payroll month lock (PAY-01):** Lock/unlock month; blocks attendance/bonus/deduction/adjustment writes.
- **Payroll compare (PAY-02):** Month-over-month net pay delta + anomaly flags on Payroll page.
- **Tax stub (PAY-03):** `taxRules` in config (0% default); payslip tax lines; Settings editor.
- **Auth:** Change password (AUTH-02); session registry + revoke for Raymond (AUTH-05); RLS deny-all migration file (AUTH-04).
- **Warnings (HR-01):** Warning levels 1st / 2nd / final on employee profile.
- **Commission types (HR-03):** CRUD UI in Settings.
- **Documents (DOC-01/03):** Expiry dashboard widget; `no_expiry` flag on upload; bulk ZIP export per employee.
- **Reports (RPT-01/02/04):** Turnover, attendance rankings CSV, finance handoff ZIP (payroll CSV + payslips + change log).
- **Admin (ADM-01/02):** Notifications bell; Changes tab CSV export.
- **New nav pages:** Leave, Equipment, Organization.
- `public/js/hrms-features.js` — HRMS UI module; `lib/hrms-repo.js`, `lib/export-zip.js`, `routes/hrms.js`, `routes/auth-routes.js`.

### Scripts
- `scripts/backfill-employment-periods.js` — safe employment period backfill (skips invalid dates).
- `scripts/app-versions-1.0.4-beta.2.sql` — mark this build current in Supabase.

### Documentation
- Updated `AI_Agent.md`, `README.md`, `TUTORIAL.md`, `SHEET_SCHEMA.md` for HRMS scope.

## [1.0.2-beta.5] — 2026-07-02

### Added
- **UI themes.** Settings → **Appearance** offers six color themes (saved per device in local storage):
  Light mode (default), Dark mode, Grey UI, Dark wine, Dark grey, and Alabaster. Layout and structure
  unchanged — only colors and surfaces update.
- **`app_users.email`** — optional contact email per login (set by Raymond in **Users**). Reserved for
  future forgot-password / self-service reset via email; not used for sign-in yet.
- **App users admin (Raymond only).** When signed in as **Raymond**, a **Users** tab appears in the
  sidebar. He can add, edit, or remove rows in Supabase `app_users`, set each person's **role**
  (access level) and **status** (`active` / `inactive` / `terminated`), and reset passwords. Changes
  are written to `change_log`. Other users — including other admins — do not see this tab.
- `lib/users-admin.js`, `routes/admin-users.js` — CRUD API at `/api/admin/users` (requires
  `DATA_BACKEND=supabase`).

### Changed
- **Supabase migration (live).** Set `DATA_BACKEND=supabase` to use PostgreSQL + Storage instead of
  Google Sheets/Drive as the live backend. Run `npm run migrate:supabase` once to import existing
  sheet data. Users are stored in `app_users` with **bcrypt-hashed** passwords. New document uploads
  go to Supabase Storage (`hr-documents` bucket); existing Drive file IDs still work until re-uploaded.
- **Version policy** reads from Supabase `app_versions` when `DATA_BACKEND=supabase` (sheet
  `App_Versions` tab remains the fallback for `DATA_BACKEND=sheets`).
- Local SQLite cache unchanged — reads stay fast; sync now pulls from Supabase.

### Documentation
- **Release habit:** every shipped version must update [`CHANGELOG.md`](CHANGELOG.md),
  [`TUTORIAL.md`](TUTORIAL.md), [`README.md`](README.md), and **[`AI_Agent.md`](AI_Agent.md)** when
  architecture or agent workflows change.
- **Supabase `app_versions` (required on every build/release):** the coding agent must update the live
  table so only the new build is marked current — see [`AI_Agent.md`](AI_Agent.md) § Release checklist.
  Applied for this release: **`1.0.2-beta.5`** marked `is_current = true`.

### Not planned
- **App updates via Supabase Storage** — Windows installers/portables are ~130–180 MB each (over the
  100 MB threshold). Keep distributing EXEs manually (USB, shared folder, or a release host). The
  `hr-documents` bucket stays for employee files only. Data sync uses Postgres, not Storage.

### Added (infrastructure)
- `lib/supabase-client.js`, `lib/supabase-repo.js`, `lib/backend.js` — data layer switch
- `lib/auth-supabase.js` — auth from `app_users` table
- `lib/storage.js` — Supabase Storage for PDFs/photos
- `public/js/theme.js` — UI theme persistence
- `npm run migrate:supabase` — one-time Sheets → Postgres import
- Postgres schema: employees, attendance, payroll, loans, change_log, app_users, app_versions, …

### Build
- `Hangup-HR-Beta-v2-Setup-1.0.2-beta.5.exe` and portable EXE in `dist\`.

## [1.0.2-beta.4] — 2026-07-02

### Added
- **App version policy.** The HR Access sheet now has an **`App_Versions`** tab that defines the
  current release and minimum compatible version. On login and during the periodic session check,
  the app compares its built-in version (`package.json`) against the sheet:
  - **Compatible but outdated** → popup warning to ask Admin for the latest build (you can continue).
  - **Not compatible** → sign-in and app use are blocked until Admin installs the required version.
- **Auto re-sync after every write.** Each edit is pushed to the Google Sheet and
  then the app silently pulls the newest data back (including edits made by other
  users) and refreshes the current view — without the full-screen sync overlay,
  and without interrupting in-progress typing.
- **Changes view for Raymond.** The user `Raymond` gets an extra **Changes**
  button in the sidebar showing the full audit trail (employee, attendance,
  bonus, deduction, config, warnings, documents), read live from the Change Log
  sheet `14vcc32AvyXI6PEUPbCd5IBoTfhEirAorGX1xMI75h9Y`. Includes user/type filters.
- **Exam / medical note document types.** Added `Medical Note` and `Exam Note` to
  the document upload types. Documents, profile photos, and notes upload to the
  Drive folder `1rfPMKlIqbJ_eKpwXIpHPKW_vfR7VXVUe`.
- **Real per-user roles.** Roles are now read from a **Role** column in the HR
  Access sheet (via the service account) instead of hardcoding `hr`. Supported
  roles: `ceo`, `admin`, `hr`, `finance`, `tl`, `agent` (plus common aliases).
  The role is stored in the session at login and refreshed on the periodic
  session check.
  - **Blank/unknown role = no access:** a user must be given a recognised role
    before they can sign in; removing a role signs them out automatically.
  - **Audit logs restricted to `admin` + `ceo`:** the Changes tab and the
    Settings change-log card are hidden from `hr` and everyone else.
  - Current assignments seeded in the sheet: Mark=`ceo`, Raymond=`admin`,
    Aurora/Eva/Phoebe=`hr`.
- **Sheet schema doc.** Added [`SHEET_SCHEMA.md`](SHEET_SCHEMA.md) describing every
  tab/column in the HR data sheet and how it maps to the local SQLite cache.

### Changed
- **Standalone/portable app only.** Removed the `localhost` browser/server mode
  entirely: deleted `server.js` and the `npm run server` script, and dropped it
  from the packaged files. The app runs solely as the Windows installer or the
  portable EXE. (The Electron window still talks to an internal in-process
  loopback; that is an implementation detail, not a server you run.)
- **Local-first data model.** Reads are now served from the local SQLite cache
  with **no per-request internet probe**, so day-to-day work is fast and stable.
  The previous behaviour verified connectivity on every request.

### Fixed
- **Blank main area / dead sidebar tabs.** `app.js` was loaded as `type="module"`
  which prevented the UI script from running reliably; restored as a classic script.
  Session ID is now stored in `sessionStorage` and sent as `x-session-id` on every API
  call so authenticated data loads after login.
- **Loading animation restored** on startup sync and tab navigation (orbit loader +
  bouncing dots).
- **10-minute idle auto-logout.** The app signs out automatically after 10 minutes
  with no activity (mouse/keyboard/scroll) in the window.
- **Robust first-run sync.** The post-login sync now retries a few times so a
  fresh PC with an empty cache reliably populates before the app is used; on
  failure it shows the Retry card instead of a blank screen.
- **Signing-ready build.** `electron-builder` signs the Windows output
  automatically when `CSC_LINK` + `CSC_KEY_PASSWORD` are set; `build.ps1` reports
  whether a certificate is configured. Unsigned builds still succeed.

## [Prior]

### Fixed
- Post-login blank screen: defined the missing `SESSION_CHECK_MS`, hardened the
  startup flow with a clear error + Retry card, and made `render()` always show a
  result.
- Invisible sidebar "Refresh data" button (white-on-white) — added visible
  sidebar button styling.
- Logged-in user was not shown — the user chip is now always populated.
- `/status` moved above the sync middleware so the username and online/offline
  badge render even when Sheets sync is failing.

### Added
- "Remember my username" checkbox on the login screen (stores the username only;
  the password must always be re-entered).
- Transport allowance override for Lateness A, Lateness B, and Quarter Day-Off
  (same Full/Half/None dropdown as half days).

### Changed
- Startup hardening in `electron/main.js`: bind to `127.0.0.1`, single-instance
  lock, clear error dialogs, lazy-load `better-sqlite3`, bundle `.env`.

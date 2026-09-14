## v2.6.1 release checklist

**Shipping 2026-09-14 (patch from 2.6.0):** Auth/Office PO/loans gap fixes + WFH AvgAuto exclusion. Target: GitHub [v2.6.1](https://github.com/raymondwalkerhs-spec/hangup-hr/releases/tag/v2.6.1) **Latest** + Supabase `app_versions` `is_current`.

### Shipped in 2.6.1
- WFH employee flag → excluded from Office PO AvgAuto
- Forgot-password via username + Authenticator OTP
- Google OAuth loopback + identity sync; either MFA or Google completes setup
- Office PO RLS + overdue notify; loan schedule line id preserved

### Checklist
- [x] Bump `package.json` to **2.6.1**; docs
- [x] Migration `20260914_employee_wfh.sql`; Kate marked WFH
- [x] Backfill loan schedules: `node scripts/backfill-loan-schedules.js`
- [ ] Release CI + Latest + `publish-app-version.js` + web installer

---

## v2.6.0 release checklist

**Shipped 2026-09-13 (installer + patch from 2.5.0):** GitHub [v2.6.0](https://github.com/raymondwalkerhs-spec/hangup-hr/releases/tag/v2.6.0) is **Latest**. Supabase `app_versions` `2.6.0` is `is_current` with `min_compatible_version=1.0.0`.

### Shipped in 2.6.0
- Office PO planner (catalog, headcount/days overrides, purchases, notifications)
- Loan schedule v2 (skip/defer) + adjust payment overrides
- Auth MFA + Google dual-run (`AUTH_BACKEND`, default legacy) + `hangup-portal://`
- Training lifecycle: local dates, MLA/RPM sales, Quarter Day-Off **0.75**, Monday HR phase notify
- Clear temporary quarter `extra_days` (HS3-81 Aug / HS3-27 Jun)
- Bonus transfer picker scopes

### Checklist
- [x] Bump `package.json` to **2.6.0**; docs (`CHANGELOG`, `README`, `AI_Agent`, `TUTORIAL`, `UPDATES`, `FEATURES`)
- [x] Apply migrations: office_po, loan_schedule, loan_month_overrides, auth_google_mfa; clear_training_quarter_extra_days (HS3-81/27)
- [x] `gh workflow run "Release (update packages)"` → Latest + `publish-app-version.js` + web installer
- [ ] Ops: Google OAuth client + `AUTH_BACKEND=dual` when ready (`docs/AUTH_MFA_OPS.md`)
- [ ] Optional: `node scripts/backfill-loan-schedules.js`

### Access Control keys (new)
| Key | Default roles | Gates |
|-----|---------------|--------|
| `viewOfficePo` | hr, admin, ceo, finance, op, rtm | Office PO page |
| `manageOfficePoItems` | hr, admin, ceo | Catalog CRUD |
| `editOfficePoPurchases` | hr, admin, ceo, finance | Generate / buy / overrides |

---

## v2.5.0 release checklist

**Shipped 2026-08-31 (optional installer + patch from 2.4.9 / not breaking):** GitHub [v2.5.0](https://github.com/raymondwalkerhs-spec/hangup-hr/releases/tag/v2.5.0) is **Latest**. Supabase `app_versions` `2.5.0` is `is_current` with `min_compatible_version=1.0.0`.

### Shipped in 2.5.0
- Sales Rankings (filters, check status columns, no Team on closers)
- Theme unlock admin + staff roles unlock premiums without sales
- Checks Q feedback shortcut; Out to inactive login + backfill
- RPM1 Google Forms; HR Monthly reports restored; company-scope hardenings

### Checklist
- [x] Bump `package.json` to **2.5.0**; docs (`CHANGELOG`, `README`, `AI_Agent`, `TUTORIAL`, `UPDATES`, `FEATURES`, `SALES_LOG`)
- [x] `npm run build:web`; `npm run test:pages`
- [x] NSIS + web installer + GitHub Latest + Supabase `is_current`
- [x] Patch `Hangup-Portal-2.5.0-win-x64-patch-from-2.4.9.zip` on GitHub release
- [x] Run backfill: Out → inactive logins (26 disabled)

### Access Control keys
| Key | Default roles | Gates |
|-----|---------------|--------|
| `viewSalesRankings` | OP, Admin, CEO, HR, RTM, Quality | Reports → Sales Rankings tab + API |
| `settingsThemeUnlocks` | Admin, CEO, HR | Settings → Premium theme unlock targets |

---

## v2.4.9 release checklist

**Shipped 2026-08-27 (optional installer + patch from 2.4.8 / not breaking):** GitHub [v2.4.9](https://github.com/raymondwalkerhs-spec/hangup-hr/releases/tag/v2.4.9) was **Latest**. Supabase `app_versions` `2.4.9` was `is_current` with `min_compatible_version=1.0.0`.

### Shipped in 2.4.9
- **Turtle Grove** premium theme (moss/earth); spinning turtle loader; slow turtles on `/cats`
- Premium unlock tiers: Gotham / Hello Kitty / Spiderman at 10 sent or 10 closed; Turtle Grove at 15 sent or 15 closed

### Checklist
- [x] Bump `package.json` → `2.4.9`; docs (`CHANGELOG`, `README`, `AI_Agent`, `TUTORIAL`, `UPDATES`, `FEATURES`)
- [x] Local NSIS Setup + patch from 2.4.8 + web installer
- [x] GitHub release `v2.4.9` Latest (Setup.exe, web installer, patch, manifests)
- [x] `node scripts/publish-app-version.js` (not breaking; `min_compatible=1.0.0`)

## v2.4.8 release checklist

**Shipped 2026-08-26 (optional installer + patch from 2.4.7 / not breaking):** GitHub [v2.4.8](https://github.com/raymondwalkerhs-spec/hangup-hr/releases/tag/v2.4.8) was **Latest**. Supabase `app_versions` `2.4.8` was `is_current` with `min_compatible_version=1.0.0`.

### Shipped in 2.4.8
- Checks: unique live MCN per company + working day (any agent) → 409 `MEMBER_DAY_EXISTS`
- Form validation: Wrong MCN; digits phones; letters-only names (Checks, Q Feedback edit, RPM)
- RPM create: required-field red glow; soft duplicate ConfirmDialog; notify Quality/RTM/Admin
- Sale ↔ Q auto-link same working day only; may set disposed feedback to Sale
- Migration `20260905_rpm_checks_unique_member_day` + cleanup script

### Checklist
- [x] Bump `package.json` → `2.4.8`; docs (`CHANGELOG`, `README`, `AI_Agent`, `TUTORIAL`, `UPDATES`, `FEATURES`, `DB_SCHEMA`)
- [x] Local NSIS Setup + patch from 2.4.7 + web installer
- [x] GitHub release `v2.4.8` Latest (Setup.exe, web installer, patch, manifests)
- [x] `node scripts/publish-app-version.js` (not breaking; `min_compatible=1.0.0`)

## v2.4.7 release checklist

**Shipped 2026-08-25 (optional installer + patch from 2.4.6 / not breaking):** GitHub [v2.4.7](https://github.com/raymondwalkerhs-spec/hangup-hr/releases/tag/v2.4.7) is **Latest**. Supabase `app_versions` `2.4.7` is `is_current` with `min_compatible_version=1.0.0`. Notes: dead form fields / Electron confirm residue; Employee Out lag + depart date wiring; deductions/bonuses Edit-Delete; Select search lag in dialogs; RPM Airtable Client RPM3; Import from open Q closer scope.

### Build / publish
- [x] Bump `package.json` → `2.4.7`; docs
- [x] `npm run build:web` + local NSIS (`npm run dist:installer`)
- [x] Patch `Hangup-Portal-2.4.7-win-x64-patch-from-2.4.6.zip` + manifests
- [x] GitHub release `v2.4.7` Latest (Setup.exe, web installer, patch, manifests)
- [x] `node scripts/publish-app-version.js` (not breaking)

## v2.3.28 release checklist

**Shipped 2026-08-18 (installer-only, breaking):** GitHub [v2.3.28](https://github.com/raymondwalkerhs-spec/hangup-hr/releases/tag/v2.3.28) is **Latest**. Supabase `app_versions` `2.3.28` is `is_current` with `--breaking`. Apply `20260824_recycle_bin_and_transport_grant.sql`. Then `npm run build:web`, `dist:installer`, `dist:web-installer`, `publish:installer`.

## v2.3.27 release checklist

**Shipped 2026-08-17 (installer-only):** GitHub [v2.3.27](https://github.com/raymondwalkerhs-spec/hangup-hr/releases/tag/v2.3.27) is **Latest**. Supabase `app_versions` `2.3.27` is `is_current`. Assets: `Hangup-Portal-Setup-2.3.27.exe`, `Hangup-Portal-Web-Setup.exe`, `win-x64-latest.json`. Equipment/Clearance/Offboarding tables, Emerald theme.

## v2.3.26 release checklist

**Shipped 2026-08-17 (installer-only):** GitHub [v2.3.26](https://github.com/raymondwalkerhs-spec/hangup-hr/releases/tag/v2.3.26). Supabase `app_versions` `2.3.26` was `is_current`. Assets: `Hangup-Portal-Setup-2.3.26.exe`. Includes Cairo RPM date filtering, explicit Add-sale intent, HS-2 switcher hardening, and role-scoped dashboard metrics.

## v2.3.23 release checklist

**Shipped 2026-08-15:** GitHub [v2.3.23](https://github.com/raymondwalkerhs-spec/hangup-hr/releases/tag/v2.3.23) is **Latest**. Supabase `app_versions` `2.3.23` is `is_current`. Assets: `Hangup-Portal-Setup-2.3.23.exe`, win full/patch zips, `Hangup-Portal-Web-Setup.exe`, `win-x64-latest.json`. (macOS CI job failed; Windows assets shipped.)

1. Bump `package.json` → `2.3.23`
2. Docs: `CHANGELOG.md`, `FEATURES.md`, `SALES_LOG.md`, `AI_Agent.md`, `UPDATES.md`, `TUTORIAL.md`, `README.md`
3. Apply migration `20260822_sale_edit_history.sql`
4. Push `ship/v2.3.23-from-222` then Release workflow `-f tag=v2.3.23`
5. Promote Latest + `publish-app-version.js`

**2.3.23 changes:** Employee roster freshness on auth/submit-scope; MLA+RPM Admin/RTM/CEO submission date/time correction with reconstructed timestamps; Deleted excluded from dialing picker; RPM sort/filters; customer name/phone search; sale edit history UI.

## v2.3.22 release checklist

**Shipped 2026-08-13:** GitHub [v2.3.22](https://github.com/raymondwalkerhs-spec/hangup-hr/releases/tag/v2.3.22). Supabase `app_versions` `2.3.22` was `is_current`. Assets: `Hangup-Portal-Setup-2.3.22.exe`, `Hangup-Portal-Web-Setup.exe` (pinned 2.3.22), `win-x64-latest.json`.

1. Bump `package.json` → `2.3.22`
2. `npm run dist:installer` then `npm run dist:web-installer`
3. `.\scripts\publish-github-release.ps1 -IncludeFull` (or `publish-installer-only.ps1`)
4. `gh release edit v2.3.22 --repo raymondwalkerhs-spec/hangup-hr --prerelease=false --latest`
5. `node scripts/publish-app-version.js`
6. Apply `supabase/migrations/20260813_sales_agent_picker.sql` (`node scripts/apply-sales-agent-picker.js`)

**2.3.22 changes:** Sale agent picker shows dialing agents (not TLs). Team is auto-filled from the selected agent. `employees.sales_agent_picker` override for SQL fixes without an app update.

## v2.3.21 release checklist

**Shipped 2026-08-13:** GitHub [v2.3.21](https://github.com/raymondwalkerhs-spec/hangup-hr/releases/tag/v2.3.21) is **Latest**. Supabase `app_versions` `2.3.21` is `is_current`. Assets: `Hangup-Portal-Setup-2.3.21.exe`, `Hangup-Portal-Web-Setup.exe` (pinned 2.3.21), `win-x64-latest.json`.

1. Bump `package.json` → `2.3.21`
2. `npm run build:web` then `npm run dist:installer` then `npm run dist:web-installer`
3. `.\scripts\publish-github-release.ps1 -IncludeFull` (or `publish-installer-only.ps1`)
4. `gh release edit v2.3.21 --repo raymondwalkerhs-spec/hangup-hr --prerelease=false --latest`
5. `node scripts/publish-app-version.js`
6. Update `CHANGELOG.md`, `README.md`, `AI_Agent.md`, `FEATURES.md`, `TUTORIAL.md`, `SALES_LOG.md`, `UPDATES.md`

**2.3.21 changes:** Announcements (audience + notifications + unread badge) and coaching tickets. Live `app_users.role` over ID-prefix inference. Agents and agent-role closers can submit sales; Amy/Tris closer-team submit (no Management team lock). HS-2 employee move requires confirm + new team. Quality record playback.

## v2.3.20 release checklist

**Shipped 2026-08-12:** GitHub [v2.3.20](https://github.com/raymondwalkerhs-spec/hangup-hr/releases/tag/v2.3.20) is **Latest**. Supabase `app_versions` `2.3.20` is `is_current`. Assets: `Hangup-Portal-Setup-2.3.20.exe`, `Hangup-Portal-Web-Setup.exe` (pinned 2.3.20), `win-x64-latest.json`.

1. Bump `package.json` → `2.3.20`
2. `npm run build:web` then `npm run dist:installer` then `npm run dist:web-installer`
3. `.\scripts\publish-installer-only.ps1`
4. `gh release edit v2.3.20 --repo raymondwalkerhs-spec/hangup-hr --prerelease=false --latest`
5. `node scripts/publish-app-version.js`
6. Update `CHANGELOG.md`, `README.md`, `AI_Agent.md`, `FEATURES.md`, `TUTORIAL.md`, `SALES_LOG.md`, `UPDATES.md`

**2.3.20 changes:** Viewport-centered cat loading overlay (varied nearby orbits, flips to face direction). Payroll opens from local cache with background refresh + sidebar prefetch. Quality tickets follow the live Users role after HR→Quality transfers (HR-2 Eva). Hide-zero uses display net; unified payroll keeps trainees on one screen. RPM/MLA submit closer picker: org closers (Ria) can choose themselves as closer; role-scoped agent/closer lists.

## v2.3.19 release checklist

1. Bump `package.json` → `2.3.19`
2. Update `CHANGELOG.md`, `README.md`, `AI_Agent.md`, `FEATURES.md`, `TUTORIAL.md`, `SALES_LOG.md`, `UPDATES.md`
3. `npm run build:web` then `npm run dist:installer` then `npm run dist:web-installer`
4. `.\scripts\publish-installer-only.ps1`

**2.3.19 changes:** Closer picker excludes Out/Deleted (Billie); includes team leads with dialing IDs via role / lead_role / org TL (Ayla). Payroll: unified list shows trainees again; hide-zero uses display net; Rose merged into Rose Brown; DB payroll-core daily rate uses month working days. Quality tickets follow the live Users role after HR→Quality transfers (e.g. HR-2 Eva).

## v2.3.18 release checklist

1. Bump `package.json` → `2.3.18`
2. Update `CHANGELOG.md`, `README.md`, `AI_Agent.md`, `FEATURES.md`, `TUTORIAL.md`, `SALES_LOG.md`, `UPDATES.md`
3. `npm run build:web` then `npm run dist:installer` then `npm run dist:web-installer`
4. `.\scripts\publish-installer-only.ps1`
5. `gh release edit v2.3.18 --repo raymondwalkerhs-spec/hangup-hr --prerelease=false --latest`
6. `node scripts/publish-app-version.js`

**2.3.18 changes:** Reviewer picker role enrichment; RPM canEditAttachmentKind export; RTM reviewer edit on RPM quality; upload size limits.

## v2.3.17 release checklist

1. Bump `package.json` → `2.3.17`
2. Update `CHANGELOG.md`, `README.md`, `AI_Agent.md`, `FEATURES.md`, `TUTORIAL.md`, `SALES_LOG.md`, `UPDATES.md`
3. `npm run build:web` then `npm run dist:installer` then `npm run dist:web-installer`
4. `.\scripts\publish-installer-only.ps1`
5. `gh release edit v2.3.17 --repo raymondwalkerhs-spec/hangup-hr --prerelease=false --latest`
6. `node scripts/publish-app-version.js`

**2.3.17 changes:** RPM optional Notes field; quality ticket recording upload + reviewer filter; inline audio playback in React sales modals; RPM `/file` stream endpoint.

## v2.3.16 release checklist

1. Bump `package.json` → `2.3.16`
2. Update `CHANGELOG.md`, `README.md`, `AI_Agent.md`, `FEATURES.md`, `TUTORIAL.md`, `SALES_LOG.md`, `UPDATES.md`
3. `npm run build:web` then `npm run dist:installer` then `npm run dist:web-installer`
4. `git push origin HEAD`
5. `npm run publish:installer`
6. `gh release edit v2.3.16 --repo raymondwalkerhs-spec/hangup-hr --prerelease=false --latest`
7. `node scripts/publish-app-version.js`

**2.3.16 changes:** Payroll page crash fix (`trainingAnchorMonth` TDZ in PayslipDialog); conditional payslip mount; `isOutEmployeeStatus` dedupe.

## v2.3.15 release checklist

1. Bump `package.json` → `2.3.15`
2. Update `CHANGELOG.md`, `README.md`, `AI_Agent.md`, `FEATURES.md`, `TUTORIAL.md`, `SALES_LOG.md`, `UPDATES.md`
3. `npm run apply:migrations` (`20260820_training_anchor_override.sql` if pending)
4. `npm run build:web` then `npm run dist:installer` then `npm run dist:web-installer`
5. `npm run publish:installer` (or `.\scripts\publish-installer-only.ps1`)
6. `gh release edit v2.3.15 --repo raymondwalkerhs-spec/hangup-hr --prerelease=false --latest`
7. `node scripts/publish-app-version.js`

**2.3.15 changes:** Training payroll double-pay fix (defer before anchor, graduated trainees); HR anchor month override on payslip; payroll history training enrichment + company bonus types; agent-scope PDF export; login OTP PIN animation + DNA sign-in button.

## v2.3.14 release checklist

1. Bump `package.json` → `2.3.14`
2. Update docs (same list as above)
3. `npm run build:web` then ship installer
4. `npm run publish:installer`
5. `gh release edit v2.3.14 --latest` + `node scripts/publish-app-version.js`

**2.3.14 changes:** Company-scoped notifications; payroll adjustments/extras/splits/loans respect company; expenses/leave/IT/meetings gated by company; frontend mutations pass `?company=hs2` on HS-2 tab.

## v2.3.13 release checklist

1. Bump `package.json` → `2.3.13`
2. Update `CHANGELOG.md`, `README.md`, `AI_Agent.md`, `FEATURES.md`, `TUTORIAL.md`, `SALES_LOG.md`, `UPDATES.md`
3. `node scripts/test-hs2-isolation.js` && `node scripts/test-hs2-access.js`
4. `npm run build:web` then `npm run dist:installer`
5. `git push origin HEAD`
6. `npm run publish:installer`
7. `gh release edit v2.3.13 --repo raymondwalkerhs-spec/hangup-hr --prerelease=false --latest`
8. `node scripts/publish-app-version.js`

**2.3.13 changes:** Full HS-2 company isolation audit — gated `?company=hs2`, strict sales filter, payroll/org/bonus/analytics leaks fixed, frontend scoping.

## v2.3.12 release checklist

1. Bump `package.json` → `2.3.12`
2. Update `CHANGELOG.md`, `README.md`, `AI_Agent.md`, `FEATURES.md`, `TUTORIAL.md`, `SALES_LOG.md`, `UPDATES.md`
3. `npm run build:web` then `npm run dist:installer`
4. `git push origin HEAD`
5. `npm run publish:installer` (or `.\scripts\publish-installer-only.ps1`)
6. `gh release edit v2.3.12 --repo raymondwalkerhs-spec/hangup-hr --prerelease=false --latest`
7. `node scripts/publish-app-version.js`

**2.3.12 changes:** MLA/RPM full program split (tables, UI, payroll counts, storage); RPM quality ticket for Quality/RTM/Admin only (agents/TL/OP view-only); edit-sale reassignment; teams dashboard Target %; agent/closer picker fixes; RPM attachment download + catalog fixes.

## v2.3.11 release checklist

1. Bump `package.json` → `2.3.11`
2. Update `CHANGELOG.md`, `README.md`, `AI_Agent.md`, `FEATURES.md`, `TUTORIAL.md`, `SALES_LOG.md`, `UPDATES.md`
3. `npm run build:web` then `npm run dist:installer`
4. `git push origin HEAD`
5. `npm run publish:installer` (or `.\scripts\publish-installer-only.ps1`)
6. `gh release edit v2.3.11 --repo raymondwalkerhs-spec/hangup-hr --prerelease=false --latest`
7. `node scripts/publish-app-version.js`

**2.3.11 changes:** Leaving types; notice-period sales on payslip; legacy OUT hidden (2+ months); deferred training accrued amounts in grid; payroll totals alignment; training phase-1 exception + cross-month breakdown.

## v2.3.10 release checklist

1. Bump `package.json` → `2.3.10`
2. Update `CHANGELOG.md`, `README.md`, `AI_Agent.md`, `FEATURES.md`, `TUTORIAL.md`, `SALES_LOG.md`, `UPDATES.md`
3. `npm run build:web` then `npm run dist:installer`
4. `git push origin HEAD`
5. `npm run publish:installer` (or `.\scripts\publish-installer-only.ps1`)
6. `gh release edit v2.3.10 --repo raymondwalkerhs-spec/hangup-hr --prerelease=false --latest`
7. `node scripts/publish-app-version.js`

**2.3.10 changes:** Cross-month training payroll (one anchor payslip); settled payroll (0 in totals, earned + Done on payslip); training half-day pay fix; bonus pending visibility; registration one-step approval.

## v2.3.9 release checklist

1. Bump `package.json` → `2.3.9`
2. Update `CHANGELOG.md`, `README.md`, `AI_Agent.md`, `FEATURES.md`, `TUTORIAL.md`, `SALES_LOG.md`, `UPDATES.md`
3. `npm run build:web` then `npm run dist:installer`
4. `git push origin HEAD`
5. `npm run publish:installer` (or `.\scripts\publish-installer-only.ps1`)
6. `gh release edit v2.3.9 --repo raymondwalkerhs-spec/hangup-hr --prerelease=false --latest`
7. `node scripts/publish-app-version.js`

**2.3.9 changes:** OUT depart confirmation; clear depart date; pause → attendance (`paused` week fill); unified payment methods; training/employment date sync; Employees payment filter crash fix; leave approval refreshes attendance grid.

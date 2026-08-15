## v2.3.23 release checklist

**Pending ship:** bump, push, Release workflow, promote Latest, `node scripts/publish-app-version.js`.

1. Bump `package.json` → `2.3.23`
2. Docs: `CHANGELOG.md`, `FEATURES.md`, `SALES_LOG.md`, `AI_Agent.md`, `UPDATES.md`, `TUTORIAL.md`, `README.md`
3. Apply migration `20260822_sale_edit_history.sql`
4. `git push` then `gh workflow run "Release (update packages)" … -f tag=v2.3.23`
5. Promote Latest + publish app version to Supabase `is_current`

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

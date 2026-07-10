## v1.7.11 release checklist

1. Bump `package.json` → `1.7.11`
2. Update `CHANGELOG.md` with release notes.
3. Run `npm test`.
4. `git push` then trigger CI: `gh workflow run "Release (update packages)" --repo raymondwalkerhs-spec/hangup-hr --ref desktop/1.0.8-beta.1-updates -f tag=v1.7.11`
5. `gh run watch --repo raymondwalkerhs-spec/hangup-hr`
6. `gh release edit v1.7.11 --repo raymondwalkerhs-spec/hangup-hr --prerelease=false --latest`
7. `node scripts/publish-app-version.js`

**1.7.11 changes:** Attendance revert bug fixed (navigate awaits flush, pendingAttendance cleared on save, batch POST returns confirmed records, cache-first attendance read). Sales log weekly date snaps to Monday; Edit/Quality ticket buttons restored on weekly/monthly by fixing stale date range and clearing period filters on switch.

## v1.7.6 release checklist

1. Bump `package.json` → `1.7.6`
2. Update `CHANGELOG.md` with the release notes.
3. Run `npm test`.
4. Build NSIS installer: `SKIP_NATIVE_REBUILD=1 npm run dist:installer`.
5. `git push` then locally run `.	ests\publish-installer-only.ps1 -Tag v1.7.6`.
6. `gh release edit v1.7.6 --latest` + `node scripts/publish-app-version.js`

## v1.7.4.B release checklist

1. Bump `package.json` → `1.7.4.B`
2. Update `CHANGELOG.md` with the release notes.
3. Run `npm test`.
4. Build NSIS installer: `npm run dist:installer`.
5. `git push` then CI or locally run `.
routes\publish-github-release.ps1 -IncludeFull -Tag v1.7.4.B`
6. `gh release edit v1.7.4.B --latest` + `node scripts/publish-app-version.js`

**1.7.4.B change:** IT ticket UX and routing improvements; Edit/Delete tickets; notification center entries for IT users; Resolve modal with structured options.

## v1.6.13 release checklist

1. Bump `package.json` → `1.6.13`
2. Build: `SKIP_NATIVE_REBUILD=1 npm run dist:installer` + `npm run dist:web-installer`
3. `npm test`
4. `git push` then `.\scripts\publish-github-release.ps1 -IncludeFull -Tag v1.6.13`
5. `gh release edit v1.6.13 --latest` + `node scripts/publish-app-version.js`

**1.6.13 change:** Add sale team auto from agent; hide quality section on submit.

## v1.6.12 release checklist

1. Bump `package.json` → `1.6.12`
2. Build: `SKIP_NATIVE_REBUILD=1 npm run dist:installer` + `npm run dist:web-installer`
3. `npm test`
4. `git push` then CI or local `.\scripts\publish-github-release.ps1 -Tag v1.6.12`
5. `gh release edit v1.6.12 --latest` + `node scripts/publish-app-version.js`

**1.6.12 change:** Add sale submit surface (full form); role-scoped agent/closer pickers; My docs self-upload types; hide annual from agents.

## v1.6.11 release checklist

1. Bump `package.json` → `1.6.11`
2. Run `npm test`
3. Build NSIS: `npm run dist:installer` (use `SKIP_NATIVE_REBUILD=1` if VS 2022 C++ workload unavailable)
4. `git push` then CI or local `.\scripts\publish-github-release.ps1 -Tag v1.6.11`
5. `node scripts/publish-app-version.js`

**1.6.11 change:** View sale read-only modal; fix quality ticket ignoring Sales permissions Quality tab (camelCase DB row keys).

---

Note on macOS builds (Windows): You can produce a raw macOS application zip on Windows using `electron-builder` (no DMG). Run:

```powershell
npm run dist:mac -- --mac zip
```

This outputs a mac `.app` bundled as a `.zip` that macOS users can unzip and run (Gatekeeper may warn — code signing not applied).

## v1.6.10 release checklist

1. Bump `package.json` → `1.6.10`
2. Run `npm test` (includes extended `test-quality-sales-perms.js`)
3. Apply migration: `npm run apply:migrations` (adds `sales_attachment_permissions`)
4. In app: **Sales permissions → Reset all to defaults** (seeds attachment ACL + quality-only field defaults)
5. Build NSIS: `npm run dist:installer`
6. `git push` then CI or local `.\scripts\publish-github-release.ps1`
7. `node scripts/publish-app-version.js`

**1.6.10 change:** Robust sales ACL — unified resolver, tabbed Sales permissions (Edit / Quality / Attachments), DB attachment ACL, cross-unit closer names, live user-exception defaults.

---
## v1.6.8 release checklist

1. Bump `package.json` → `1.6.8`
2. Run `npm test` (access-scope, quality-sales-perms, rbac-defaults, fp-import, training-payroll)
3. Build with native rebuild (VS 2022 / `npm_config_msvs_version=2022` on Windows)
4. Publish **latest-only** assets: Setup.exe, Web-Setup.exe, `win-x64-latest.json`, single `patch-from-{previous}.zip`
5. `git push` then CI or local `.\scripts\publish-github-release.ps1` (no `-MultiPatch` unless legacy manual apply)
6. `node scripts/publish-app-version.js`

**1.6.8 change:** Full audit remediation — ACL/RBAC fixes, sales action permissions UI, web installer version pin, single-patch publish default.

---
## v1.6.5 release checklist

1. Bump `package.json` → `1.6.5`
2. Document FP import AM/PM, local dates, shift grouping, dedupe, check-in-only days; run `node scripts/test-fp-import.js`
3. `git push` then trigger CI: `gh workflow run "Release (update packages)" --repo raymondwalkerhs-spec/hangup-hr --ref desktop/1.0.8-beta.1-updates -f tag=v1.6.5`
4. After CI: `gh release edit v1.6.5 --repo raymondwalkerhs-spec/hangup-hr --prerelease=false --latest`
5. `node scripts/publish-app-version.js` and `npm run dist:web-installer`
6. `gh release upload v1.6.5 dist-bootstrap/Hangup-Portal-Web-Setup.exe --clobber`

**1.6.5 change:** Fingerprint import fixes (1:36 PM → 13:36, local calendar dates, agent shift grouping, dedupe punches, check-in-only days).

---
## v1.6.4 release checklist

1. Bump `package.json` → `1.6.4`
2. Document FP import ID+Date-only → Attended + **FP date only**
3. `git push` then trigger CI: `gh workflow run "Release (update packages)" --repo raymondwalkerhs-spec/hangup-hr --ref desktop/1.0.8-beta.1-updates -f tag=v1.6.4`
4. After CI: `gh release edit v1.6.4 --repo raymondwalkerhs-spec/hangup-hr --prerelease=false --latest`
5. `node scripts/publish-app-version.js` and `npm run dist:web-installer`

**1.6.4 change:** Fingerprint import accepts ID+Date-only rows; defaults to Attended with **FP date only** note.

---
# Hangup Portal — App updates

> **Data backend:** Supabase only. **Do not use Google Sheets.** See [`LEGACY_GOOGLE_SHEETS.md`](LEGACY_GOOGLE_SHEETS.md).

Hangup Portal uses **two separate distribution channels**. They work together but do not replace each other.

| Channel | What it delivers | Who uses it | Size |
|---------|------------------|-------------|------|
| **Web installer** (`Hangup-Portal-Web-Setup.exe`) | Small GUI exe with progress bar; downloads full Setup.exe | New PCs via USB/email | **~9 KB** exe → downloads ~95 MB at run time |
| **NSIS installer** (your PC build or CI) | Full first-time install | New PCs, reinstall | ~130–180 MB |
| **macOS DMG** (Mac or CI `build-macos`) | Full first-time install on Mac | New Macs, reinstall | ~150–200 MB |
| **GitHub in-app update** | Silent NSIS installer (Windows) or full `.app` replace (macOS) | PCs already running the app | ~130–180 MB (NSIS) / ~150–200 MB (mac full zip) |

**Your local build workflow:** run `.\scripts\build.ps1 all` on Windows (NSIS Setup + portable) or `./scripts/build-macos.sh` on a Mac (DMG). For a **small USB-friendly bootstrap**, run `npm run dist:web-installer` and copy `dist-bootstrap/Hangup-Portal-Web-Setup.exe` — it downloads the full installer from GitHub when the user runs it.

---

## Web installer (small bootstrap)

Ship **`Hangup-Portal-Web-Setup.exe`** (~10 KB) instead of the full Setup.exe on USB or email:

```powershell
npm run dist:web-installer
```

Requires **`GITHUB_UPDATES_TOKEN`** in `.env` at build time (read once; embedded in the EXE). The token is **not** in any zip or script — only inside the compiled installer.

**What it does:** normal Windows installer UI with **progress bar and percentage** → uses the embedded token to download **Setup.exe for the pinned release** (defaults to `package.json` version at build time) → launches the full NSIS installer.

**On a new PC:** double-click `Hangup-Portal-Web-Setup.exe` → wait for download → full installer runs. No `.env`, no GitHub login, no `gh` CLI on the target PC.

**After each release:** run `gh release edit vX.Y.Z --prerelease=false --latest`, remove wrong-version assets from that release, then `npm run dist:web-installer` if you redistribute the bootstrap EXE.

| Note | Detail |
|------|--------|
| Rebuild each release | Run `npm run dist:web-installer` after publishing (pins to `package.json` version) |
| Distribution | USB / internal share only — **do not** upload this EXE to public sites (contains your GitHub token) |
| Token scope | Fine-grained PAT with read access to repo contents/releases is enough |

```powershell
# Optional: always fetch newest release (empty pin) when building
powershell -File scripts/build-web-installer.ps1 -Version ""
```

Legacy PowerShell zip bootstrap is deprecated — use `Hangup-Portal-Web-Setup.exe` only.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  YOUR PC (primary — unchanged)                                   │
│  .\scripts\build.ps1 all  →  Setup.exe + Portable.exe           │
│  Copy EXEs to HR PCs (USB, shared folder)                       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  GITHUB RELEASES (in-app updates — optional add-on)              │
│  Setup.exe + full zips published to GitHub Releases              │
│  Desktop app → "Update now" → silent installer or full app swap  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  SUPABASE app_versions (policy only — not file hosting)          │
│  Warn / block old versions at login                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## v1.5.3 release checklist

1. Bump `package.json` → `1.5.3`
2. `npm run test:training-payroll`
3. `git push` then trigger CI: `gh workflow run "Release (update packages)" --ref desktop/1.0.8-beta.1-updates -f tag=v1.5.3`
4. After CI: `gh release edit v1.5.3 --prerelease=false --latest`
5. `node scripts/publish-app-version.js --notes "Working days sync fix; payroll perf + search"`

## v1.5.2 release checklist

1. Bump `package.json` → `1.5.2`
2. `npm run test:training-payroll`
3. `git push` then trigger CI: `gh workflow run "Release (update packages)" --ref desktop/1.0.8-beta.1-updates -f tag=v1.5.2`
4. After CI: `gh release edit v1.5.2 --prerelease=false --latest`
5. `node scripts/publish-app-version.js --notes "Payroll search + trainee working days fix"`

**1.5.2 change:** Payroll search finds Arabic names/IDs; trainee pay uses configured month working days (e.g. 22 not a fixed 20).

## v1.5.1 release checklist

1. Bump `package.json` → `1.5.1`
2. `git push` then trigger CI: `gh workflow run "Release (update packages)" --ref desktop/1.0.8-beta.1-updates -f tag=v1.5.1`
3. After CI: `gh release edit v1.5.1 --prerelease=false --latest` — verify Setup, full zips, patch-from-1.5.0
4. `node scripts/publish-app-version.js --notes "Payroll page fix for trainee training programs"`
5. Optional: `npm run dist:web-installer` for USB bootstrap

**1.5.1 change:** Payroll page loads when agents have training programs (fixes `/api/payroll` crash on missing actionPlans in training enrich).

## v1.6.0 release checklist

1. Bump `package.json` → `1.6.0`
2. `npm run test:training-payroll`
3. `git push` then trigger CI: `gh workflow run "Release (update packages)" --repo raymondwalkerhs-spec/hangup-hr --ref desktop/1.0.8-beta.1-updates -f tag=v1.6.0`
4. After CI: `gh release edit v1.6.0 --repo raymondwalkerhs-spec/hangup-hr --prerelease=false --latest`
5. `node scripts/publish-app-version.js --notes "Training payroll split, fixed 12k/20/600, three tabs"`
6. `npm run dist:web-installer` for USB bootstrap

**1.6.0 change:** Training payroll split — Main | Training | Total tabs; fixed 12,000/20/600 trainee pay; agent due 15th next month.

## v1.5.0 release checklist

1. Bump `package.json` → `1.5.0`
2. `npm run apply:migrations` (adds `20260720_training_payroll.sql`)
3. `npm run test:training-payroll`
4. `git push` then trigger CI: `gh workflow run "Release (update packages)" --ref desktop/1.0.8-beta.1-updates -f tag=v1.5.0`
5. After CI: `gh release edit v1.5.0 --prerelease=false --latest` — verify Setup, full zips, patch-from-1.4.6
6. `node scripts/publish-app-version.js --notes "Training payroll, dual payslips, Trainee position"`
7. `npm run dist:web-installer` for USB bootstrap

**Storage quota:** GitHub recalculates Actions artifact usage every **6–12 hours** after `npm run cleanup:artifacts`. Release CI **v1.5.0+** uploads directly to GitHub Releases (no Actions artifacts), avoiding quota blocks.

**1.5.0 change:** Training payroll with Trainee rate, dual payslips on mid-month promotion, resignation notice rules.

## v1.4.6 release checklist

1. Bump `package.json` → `1.4.6`
2. `git push` then trigger CI: `gh workflow run "Release (update packages)" --ref desktop/1.0.8-beta.1-updates -f tag=v1.4.6`
3. After CI: `gh release edit v1.4.6 --prerelease=false --latest` — verify **Setup-1.4.6.exe**, full zips, and **patch-from-1.4.5** zips
4. `node scripts/publish-app-version.js --notes "Sales log PERIOD_LABELS hotfix"`
5. Optional: `npm run dist:web-installer` for USB bootstrap (downloads Latest Setup from GitHub)

**1.4.6 change:** Sales log hotfix — `PERIOD_LABELS` restore + advanced filter empty-rule fix (log showed zero rows). Patch update from 1.4.5 is sufficient for existing installs.

---

## v1.3.9 release checklist

1. Bump `package.json` → `1.3.9`
2. `npm run apply:migrations` — includes `20260717_app_user_permissions.sql`
3. Windows: `.\scripts\build.ps1 all`
4. Verify: `node scripts/verify-update-package.js dist\Hangup-HR-*-win-x64-full.zip`
5. `.\scripts\publish-github-release.ps1 -IncludeFull -IncludeExtras`
6. Push tag `v1.3.9` → CI builds macOS DMG + uploads to same release (`.github/workflows/release.yml`)
7. `node scripts/publish-app-version.js --field-breaking --notes "RBAC fixes, registration, access scoping — install 1.3.9"`

## v1.3.6 release checklist

1. Bump `package.json` → `1.3.6`
2. `npm run apply:migrations` — includes `20260716_app_role_permissions.sql`
3. Windows: `$env:SKIP_NATIVE_REBUILD="1"; .\scripts\build.ps1 installer`
4. Verify: `node scripts/verify-update-package.js dist\Hangup-HR-*-win-x64-full.zip`
5. Push tag `v1.3.6` → CI builds Windows NSIS + macOS DMG (`.github/workflows/release.yml`)
6. `node scripts/publish-app-version.js --version 1.3.6 --notes "Admin Access Control + RBAC DB overrides"`

## v1.3.1 release checklist

1. Bump `package.json` → `1.3.1`
2. **Migrate legacy sale files** (one-time, before wide rollout):

```powershell
# Fresh DROPBOX_ACCESS_TOKEN in .env (files.content.read) — generate in Dropbox App Console
npm run migrate:sale-attachments
```

3. Windows: `.\scripts\build.ps1 installer` then `.\scripts\clean-dist.ps1`
4. `node scripts/fetch-all-release-manifests.js` (optional — seeds multi-version patch manifests)
5. `npm run package:github -- --full` (builds patch zips for **multiple** prior versions + full zip)
6. `npm run verify:update -- dist-build2\Hangup-HR-1.3.1-win-x64-full.zip`
7. `.\scripts\publish-github-release.ps1 -IncludeFull`
8. Push tag `v1.3.1` → CI builds macOS DMG
9. `node scripts/publish-app-version.js --version 1.3.1`
10. Run [`scripts/qa-smoke-checklist.md`](scripts/qa-smoke-checklist.md)

### Multi-version patches (CI / manual only)

`package-github-release.js --full` still builds patch zips for **emergency manual apply** (`apply-github-patch-standalone.js`). The **in-app updater does not use patch zips** — it uses Setup.exe (NSIS) or full zips only.

---

## What the in-app updater does

| Install type | Update method | User data preserved |
|--------------|---------------|---------------------|
| **NSIS** (default HR PCs) | Downloads `Setup.exe`, runs silent `/S` upgrade | `%AppData%` / `HangupHR-data` |
| **Portable** Windows | Downloads `win-x64-full.zip`, stages + atomic folder swap on restart | `HangupHR-data\` beside portable EXE |
| **macOS `.app`** | Downloads `mac-{arch}-full.zip`, replaces entire `.app` bundle on restart | `HangupHR-data` / userData |
| `win-unpacked\` dev run | Full zip atomic swap | Local cache dirs |

**Never overwritten:** `HangupHR-data\`, `hr-cache\`, `.env`

### macOS notes

- In-app update **replaces the whole `.app` bundle** (not file-by-file overlay inside `Contents/`).
- Builds are **unsigned** today (`identity: null` in `package.json`). After update, macOS Gatekeeper may require **System Settings → Privacy & Security → Open Anyway** until ADM-09 (code signing) ships.
- CI builds on `macos-latest` via `scripts/build-macos.sh`; assets: `Hangup-HR-{version}-mac-x64-full.zip` and `mac-arm64-full.zip`.

### Windows NSIS notes

- Test silent upgrade before wide rollout: install vN, publish vN+1 with Setup.exe on GitHub, click **Update now** — app closes, installer upgrades in place, shortcut unchanged.
- `publish-github-release.ps1` **always uploads Setup.exe** (required for in-app updates).

---

## Release asset naming

Each GitHub Release must include (for in-app updates):

| Asset | Purpose |
|-------|---------|
| `Hangup-Portal-Setup-{version}.exe` | **Required** — in-app update on NSIS installs (silent `/S`) |
| `Hangup-Portal-{version}-win-x64-full.zip` | Portable Windows + dev `win-unpacked` |
| `win-x64-latest.json` | Manifest for CI patch packaging (not used in-app) |

Legacy `Hangup-HR-*` assets from older releases are still accepted by the in-app updater.

Optional (CI / manual recovery):

| Asset | Purpose |
|-------|---------|
| `Hangup-Portal-{version}-win-x64-patch-from-{prev}.zip` | Manual apply only (`apply-github-patch-standalone.js`) |
| `Hangup-Portal-Portable-{version}.exe` | Optional on GitHub (`-IncludeExtras`) |

macOS (CI or local Mac build):

| Asset | Purpose |
|-------|---------|
| `Hangup-Portal-{version}-mac-x64-full.zip` / `mac-arm64-full.zip` | **Required** — in-app update replaces full `.app` |
| `Hangup-Portal-{version}-mac-*-patch-from-{prev}.zip` | Manual / CI only (not used in-app) |
| `mac-x64-latest.json` / `mac-arm64-latest.json` | Manifests for CI patch diff |

electron-builder outputs `.app` bundles under `dist/mac-x64/` and `dist/mac-arm64/` — `package-github-release.js` discovers these automatically.

Patch zips contain an `update-info.json` with `removed` file paths (deleted in the new build).

---

## Update process (end user)

1. User opens Hangup Portal (desktop EXE).
2. App checks **Supabase `app_versions`** — warn or block if policy requires a newer version.
3. App checks **GitHub Releases** for **every signed-in user** (and on the login page when configured):
   - Boot, session poll (~5 min), background interval (~30 min), tab visibility return
   - Requires `GITHUB_UPDATES_REPO` in packaged `.env`; private repos need `GITHUB_UPDATES_TOKEN`
4. If a newer release exists, **Update now** downloads:
   - **Windows NSIS** → `Setup.exe` (~130 MB), runs silent installer, app closes.
   - **Windows portable** → `win-x64-full.zip`, staged atomic swap on restart.
   - **macOS** → `mac-{arch}-full.zip`, replaces entire `.app` on restart.
5. User data and shortcuts are preserved.

---

## Release process (developer — your PC)

### Every release (required — same as before)

1. Bump `package.json` version.
2. Update `CHANGELOG.md` and other docs.
3. Publish version policy:
   ```powershell
   node scripts/publish-app-version.js --notes "Release notes"
   ```
4. **Build installers on your PC** (unchanged):
   ```powershell
   .\scripts\build.ps1 all
   ```
5. Distribute `Setup.exe` / `Portable.exe` to HR PCs as you do today.

### GitHub in-app updates (optional add-on — after local build)

6. Package update zips from the same `dist\win-unpacked` output:
   ```powershell
   npm run package:github -- --full
   ```
   - First release for a platform → **full zip** only.
   - Next releases → **patch zip** (diff vs `dist\update-manifests\`) + **full zip** with `--full`.

7. Publish to GitHub (uploads Setup.exe + zips automatically):
   ```powershell
   .\scripts\publish-github-release.ps1 -IncludeFull
   ```
   Or push a tag and let CI publish (see below).

8. Ensure packaged `.env` includes:
   ```env
   GITHUB_UPDATES_REPO=your-org/hangup-hr
   GITHUB_UPDATES_TOKEN=ghp_...   # private repo; generate via `gh auth token`
   ```
   Rebuild once so new installs know where to check. Existing installs keep their packaged `.env` unless you redistribute.

**Latest published:** `v1.2.0`

---

## Release process (GitHub Actions — optional)

Workflow: [`.github/workflows/release.yml`](.github/workflows/release.yml)

**Triggers:** push tag `v*` (e.g. `v1.0.9-beta.1`) or manual **workflow_dispatch**.

**Jobs:**

| Job | Runner | Output |
|-----|--------|--------|
| `resolve-tag` | ubuntu | Release tag + version |
| `build-windows` | windows-latest | `win-x64` patch + full zips, `win-x64-latest.json` |
| `build-macos` | macos-latest | `mac-x64` / `mac-arm64` patch + full zips, manifests |
| `publish` | ubuntu | Single GitHub Release with all artifacts |

**What CI does NOT do:** replace your local `.\scripts\build.ps1 all` installer build on your PC.

**First release bootstrap:** patch zips need a previous manifest. The **first** `v*` release publishes **full zips only** per platform. The second release onward generates patch zips automatically (CI fetches manifests from the previous release).

**Required repository secrets:**

| Secret | Purpose |
|--------|---------|
| `SUPABASE_URL` | Packaged into CI `.env` |
| `SUPABASE_SECRET_KEY` | Packaged into CI `.env` |
| `SUPABASE_PUBLISHABLE_KEY` | Packaged into CI `.env` |
| `SESSION_SECRET` | Session signing |
| `CSC_LINK` | *(optional)* Code signing |
| `CSC_KEY_PASSWORD` | *(optional)* Code signing |

`GITHUB_TOKEN` is provided automatically.

**First-time repo setup:**
1. Create GitHub repo and push this project.
2. Add secrets under **Settings → Secrets and variables → Actions**.
3. Tag a release: `git tag v1.0.8-beta.1 && git push origin v1.0.8-beta.1`
4. Or run **Actions → Release (update packages) → Run workflow**.

---

## Commands reference

| Command | Purpose |
|---------|---------|
| `.\scripts\build.ps1 all` | **Primary** — installer + portable on your PC |
| `.\scripts\build.ps1 portable` | Portable + unpacked only (Windows) |
| `bash scripts/build-macos.sh` | macOS dmg + zip + `.app` (on a Mac) |
| `npm run dist:mac:script` | Same as `build-macos.sh` |
| `npm run package:github` | Patch zip only (if previous manifest exists) |
| `npm run package:github -- --full` | Patch + full zip |
| `npm run verify:update -- <zip>` | **Required before publish** — extract + ASAR + SHA-256 check |
| `.\scripts\publish-github-release.ps1` | Upload Setup.exe + zips/manifests to GitHub via `gh` CLI |
| `node scripts/apply-github-patch-standalone.js` | Manual patch when in-app updater broken (close app first) |
| `node scripts/fetch-release-manifest.js` | Download previous manifests (CI / fresh clone) |

---

## Code map

| File | Role |
|------|------|
| `lib/github-updater.js` | Check releases; NSIS silent install / full app or portable swap |
| `lib/zip-extract.js` | Safe zip extraction (adm-zip per-entry; **never** PowerShell `Expand-Archive`) |
| `lib/update-integrity.js` | ASAR header + SHA-256 verification before copying files |
| `scripts/package-github-release.js` | Build patch/full zips + manifests + `fileHashes` (win + mac) |
| `scripts/verify-update-package.js` | Pre-publish validation — run on every patch/full zip |
| `scripts/build-macos.sh` | macOS CI/local build script |
| `scripts/fetch-release-manifest.js` | Pull manifests from previous GitHub release |
| `scripts/apply-github-patch-standalone.js` | Bootstrap patch apply when updater is broken |
| `scripts/publish-github-release.ps1` | Local publish helper (`gh release create`) |
| `electron/main.js` | IPC: `check-github-update`, `apply-github-update`, `relaunch-app` |
| `electron/preload.js` | Exposes `hrDesktop.checkGitHubUpdate()` to UI |
| `public/js/app.js` | `checkForAppUpdate()` — popup + login banner; all users |
| `public/login.html` | GitHub update banner before sign-in |
| `.github/workflows/release.yml` | Optional CI release publishing |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| **Invalid package app.asar** | App restores from `.hr-backup` on startup if possible. Otherwise use **Update now** (full installer/zip) or run Setup.exe manually. |
| No update popup | Set `GITHUB_UPDATES_REPO` (+ `GITHUB_UPDATES_TOKEN` if private) in packaged `.env` and rebuild |
| NSIS update fails | Ensure GitHub release includes `*Setup-{version}.exe`. Run `.\scripts\build.ps1 all` before `publish-github-release.ps1` |
| Portable/mac update stuck | Restart app — startup completes atomic swap from `hangup-hr-atomic-swap.json` |
| Stuck on old patch-only updater (≤1.3.1) | Close app; run Setup.exe manually or `node scripts/apply-github-patch-standalone.js` |
| Private repo rate limits | Set `GITHUB_UPDATES_TOKEN` in `.env` |
| CI build fails on credentials | Uses `SKIP_CREDENTIALS_CHECK=1` stub — normal for Actions |
| macOS update blocked by Gatekeeper | Unsigned build — allow in Privacy & Security; plan ADM-09 signing |
| No mac assets in release | `build-macos` job may warn if Mac build fails; Windows release still publishes |

---

## Related docs

- [`README.md`](README.md) — build & deploy overview  
- [`AI_Agent.md`](AI_Agent.md) — agent release checklist  
- [`CHANGELOG.md`](CHANGELOG.md) — version history  
- [`.env.example`](.env.example) — `GITHUB_UPDATES_REPO` template  

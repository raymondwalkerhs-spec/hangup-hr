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

**What it does:** normal Windows installer UI with **progress bar and percentage** → uses the embedded token to download **Setup.exe from the GitHub release marked Latest** → launches the full NSIS installer. Picks the Setup whose version matches that release tag (ignores stale duplicate assets on the same release page).

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

## v1.4.6 release checklist

1. Bump `package.json` → `1.4.6`
2. `git push` then trigger CI: `gh workflow run "Release (update packages)" --ref desktop/1.0.8-beta.1-updates -f tag=v1.4.6`
3. After CI: `gh release edit v1.4.6 --prerelease=false --latest` — verify **Setup-1.4.6.exe**, full zips, and **patch-from-1.4.5** zips
4. `node scripts/publish-app-version.js --notes "Sales log PERIOD_LABELS hotfix"`
5. Optional: `npm run dist:web-installer` for USB bootstrap (downloads Latest Setup from GitHub)

**1.4.6 change:** Sales log hotfix only — patch update from 1.4.5 is sufficient for existing installs.

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

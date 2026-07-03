# Hangup HR — App updates

> **Data backend:** Supabase only. **Do not use Google Sheets.** See [`LEGACY_GOOGLE_SHEETS.md`](LEGACY_GOOGLE_SHEETS.md).

Hangup HR uses **two separate distribution channels**. They work together but do not replace each other.

| Channel | What it delivers | Who uses it | Size |
|---------|------------------|-------------|------|
| **NSIS installer** (your PC build or CI) | Full first-time install | New PCs, reinstall | ~130–180 MB |
| **macOS DMG** (Mac or CI `build-macos`) | Full first-time install on Mac | New Macs, reinstall | ~150–200 MB |
| **GitHub patch update** (in-app) | Changed files only | PCs already running the app | Usually a few MB |

**Your local build workflow:** run `.\scripts\build.ps1 installer` on Windows (NSIS Setup) or `./scripts/build-macos.sh` on a Mac (DMG). GitHub in-app updates use patch/full zips — not the installers.

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
│  npm run package:github  →  patch zip + full zip                  │
│  gh release / CI workflow  →  assets on GitHub                   │
│  Desktop app checks releases → "Update now" overlays files       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  SUPABASE app_versions (policy only — not file hosting)          │
│  Warn / block old versions at login                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## v1.3.0 release checklist

1. Bump `package.json` → `1.3.0`
2. `node scripts/audit-dropbox-sales.js --fix-links` (if attachments missing links)
3. Windows: `.\scripts\build.ps1 installer` then `npm run package:github -- --full`
4. `npm run verify:update -- dist/update-manifests/win-x64-full.zip` (or patch zip)
5. Push tag `v1.3.0` → CI builds macOS DMG (`build-macos` job — no longer optional fail)
6. Update `app_versions` in Supabase to `1.3.0`
7. Run [`scripts/qa-smoke-checklist.md`](scripts/qa-smoke-checklist.md)

---

## What gets updated in-place

The in-app updater replaces files inside the **unpacked install folder**:

| Install type | Update root | User data preserved |
|--------------|-------------|---------------------|
| Portable EXE folder | Folder containing the portable `.exe` | `HangupHR-data\` |
| NSIS installed app | `Program Files\…\` unpacked files | `%AppData%` / portable data dir |
| `win-unpacked\` dev run | `dist\win-unpacked\` | Local cache dirs |
| macOS `.app` in Applications | `Hangup HR Beta.app/Contents` | `HangupHR-data` in app folder / userData |

**Never overwritten:** `HangupHR-data\`, `hr-cache\`, `.env`

### macOS notes

- In-app update overlays files inside the **`.app` bundle** (`Contents/`). Users should run the `.app` directly (not only mount a DMG once and discard).
- Builds are **unsigned** today (`identity: null` in `package.json`). After update, macOS Gatekeeper may require **System Settings → Privacy & Security → Open Anyway** until ADM-09 (code signing) ships.
- CI builds on `macos-latest` via `scripts/build-macos.sh`; assets: `Hangup-HR-{version}-mac-x64-full.zip` and `mac-arm64` when both arches are built.

---

## Release asset naming

Each GitHub Release should include:

| Asset | Purpose |
|-------|---------|
| `Hangup-HR-{version}-win-x64-patch-from-{prev}.zip` | **Preferred** — only changed files since previous version |
| `Hangup-HR-{version}-win-x64-full.zip` | Fallback when user skipped a version |
| `win-x64-latest.json` | Manifest for next release’s patch diff |
| `Hangup-HR-Beta-v2-Setup-{version}.exe` | *(optional on GitHub)* — same as your local installer |
| `Hangup-HR-Beta-v2-Portable-{version}.exe` | *(optional on GitHub)* — same as your local portable |

macOS (CI or local Mac build):

| Asset | Purpose |
|-------|---------|
| `Hangup-HR-{version}-mac-x64-patch-from-{prev}.zip` | Patch for Intel Mac |
| `Hangup-HR-{version}-mac-arm64-patch-from-{prev}.zip` | Patch for Apple Silicon |
| `Hangup-HR-{version}-mac-x64-full.zip` / `mac-arm64-full.zip` | Full fallback per arch |
| `mac-x64-latest.json` / `mac-arm64-latest.json` | Manifests for next patch diff |

electron-builder outputs `.app` bundles under `dist/mac-x64/` and `dist/mac-arm64/` — `package-github-release.js` discovers these automatically.

Patch zips contain an `update-info.json` with `removed` file paths (deleted in the new build).

---

## Update process (end user)

1. User opens Hangup HR (desktop EXE).
2. App checks **Supabase `app_versions`** — warn or block if policy requires a newer version.
3. App checks **GitHub Releases** for **every signed-in user** (and on the login page when configured):
   - Boot, session poll (~5 min), background interval (~30 min), tab visibility return
   - Requires `GITHUB_UPDATES_REPO` in packaged `.env`; private repos need `GITHUB_UPDATES_TOKEN`
4. If a newer release exists:
   - On **previous version** → download **patch zip** (small).
   - On **older skipped version** → download **full zip**.
5. User clicks **Update now** in the popup.
6. Files are extracted over the install folder; app restarts.
7. **No new installer run** — same shortcut, same data folder.

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

7. Publish to GitHub:
   ```powershell
   .\scripts\publish-github-release.ps1 -Notes "See CHANGELOG.md"
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
| `.\scripts\publish-github-release.ps1` | Upload zips/manifests to GitHub via `gh` CLI |
| `node scripts/apply-github-patch-standalone.js` | Manual patch when in-app updater broken (close app first) |
| `node scripts/fetch-release-manifest.js` | Download previous manifests (CI / fresh clone) |

---

## Code map

| File | Role |
|------|------|
| `lib/github-updater.js` | Check releases, pick patch vs full, apply update |
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
| **Invalid package app.asar** | Fixed in **1.2.4+** — was corrupted zip extract. Upgrade via standalone script or full zip. Never use PowerShell `Expand-Archive` for update zips. |
| No update popup | Set `GITHUB_UPDATES_REPO` (+ `GITHUB_UPDATES_TOKEN` if private) in packaged `.env` and rebuild |
| Patch not created | Download `win-x64-latest.json` from previous release into `dist/update-manifests/` before `package:github` |
| User on old version gets large download | Expected — full zip fallback |
| Update fails while app running | Normal for `app.asar` — updater writes `.hr-pending` and finishes on **restart** |
| Stuck on 1.2.0–1.2.3 updater | Close app; run `node scripts/apply-github-patch-standalone.js --install-dir "…\\Hangup HR Beta"` |
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

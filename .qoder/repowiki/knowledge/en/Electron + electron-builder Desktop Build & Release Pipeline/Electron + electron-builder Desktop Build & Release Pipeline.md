---
kind: build_system
name: Electron + electron-builder Desktop Build & Release Pipeline
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - scripts/build.ps1
    - scripts/build-macos.sh
    - scripts/electron-after-pack.js
    - scripts/package-github-release.js
    - scripts/publish-github-release.ps1
    - scripts/ensure-electron.js
    - .github/RELEASE_SETUP.md
---

The Hangup HR desktop app is built, packaged, and released using an Electron-based pipeline centered on `electron-builder` with custom PowerShell/Node orchestration scripts. The system produces Windows NSIS installers and portable zips, macOS DMG/zip bundles, and GitHub Releases containing incremental patch updates for in-app upgrades.

### What system/approach is used
- **Packaging**: `electron-builder` (v25) configured via the `build` field in `package.json`, targeting NSIS installers (`win-x64`) and macOS dmg/zip bundles (`x64` + `arm64`).
- **Native rebuild**: `@electron/rebuild` invoked before packaging to compile native modules (e.g. `better-sqlite3`) against the bundled Electron runtime.
- **Post-pack hook**: `scripts/electron-after-pack.js` uses `@electron/fuses` to flip two fuses — disabling ASAR integrity validation and allowing non-ASAR loading — so that in-app updates can replace `app.asar` and the host `.exe` without triggering "Invalid package" errors.
- **Patch generation**: `scripts/package-github-release.js` walks the unpacked app, hashes every file, diffs against previous manifests, and emits per-version `*-patch-from-*.zip` files plus optional full zips; manifest JSONs are written under `dist/update-manifests/<platform>-<version>.json`.
- **Release publishing**: `scripts/publish-github-release.ps1` uploads Setup.exe, patch/full zips, and `*-latest.json` manifests to a GitHub Release created via the `gh` CLI.
- **CI / local parity**: `scripts/build.ps1` (Windows) and `scripts/build-macos.sh` (macOS) wrap `electron-builder`, handle credential stubbing when `DATA_BACKEND=supabase`, skip npm installs in CI, and accept `HR_BUILD_OUTPUT` to redirect artifacts into parallel folders (`dist-build`, `dist-beta7`, etc.).

### Key files and packages
- `package.json` — project metadata, `npm run dist*` entry points, and the complete `electron-builder` config (targets, artifact naming, `extraResources`, `asarUnpack`, code-signing flags).
- `scripts/build.ps1` — primary Windows build orchestrator: stops running apps, cleans locked output dirs, rewrites `package.json.version` to a semver-compatible form while preserving the real version via `build.extraMetadata`, triggers native rebuild, runs `electron-builder --win nsis|portable`, prunes stale EXEs.
- `scripts/build-macos.sh` — macOS counterpart invoking `electron-builder --mac dmg zip`.
- `scripts/electron-after-pack.js` — flips Electron Fuses to disable ASAR integrity so updater can overwrite the bundle.
- `scripts/package-github-release.js` — computes SHA-256 manifests, generates incremental patch zips (skipping the host `.exe`), writes `update-manifests/*.json`, and supports multi-patch targets.
- `scripts/publish-github-release.ps1` — locates `gh`, builds patch/full assets if missing, uploads all artifacts to a GitHub Release tag `v<version>`.
- `scripts/ensure-electron.js` — pre-flight check that re-downloads a corrupted Electron binary before dev/start.
- `.github/RELEASE_SETUP.md` — one-time repo setup (secrets, `GITHUB_UPDATES_REPO`, first-release vs subsequent-release flow).

### Architecture and conventions
- **Versioning**: App version lives in `package.json`; `build.ps1` strips pre-release suffixes for `electron-builder` compatibility while embedding the original via `extraMetadata`. Tags pushed as `v<major.minor.patch[-prerelease]>` drive release creation.
- **Output layout**: Default `dist/` holds `win-unpacked/`, `Hangup-Portal-Setup-*.exe`, `*.blockmap`, and `update-manifests/`. Parallel outputs (`dist-build`, `dist-beta7`, `dist-bootstrap`, …) are supported by setting `HR_BUILD_OUTPUT`.
- **Credentials handling**: If `credentials/service-account.json` is absent and `DATA_BACKEND=supabase` or `CI=true`, a stub `{}` is emitted; otherwise the build aborts. `.env` is copied from `.env.example` when missing and shipped inside the app via `extraResources`.
- **Update channel**: A `beta` argument to `build.ps1` switches logging/output but does not change artifact names; the updater reads `GITHUB_UPDATES_REPO` from the packaged `.env` to locate releases.
- **Code signing**: Optional via `CSC_LINK` / `CSC_KEY_PASSWORD` env vars; builds default to unsigned with a warning.
- **Artifact pruning**: After each build, stale `.exe`/`.blockmap` files whose name does not match the current version are deleted to keep publish fast.

### Rules developers should follow
- Always build through `npm run dist` (Windows) or `npm run dist:mac` (mac); do not call `electron-builder` directly so that credential checks, native rebuilds, and post-pack fuse flipping are applied.
- Keep `package.json.version` at a valid semver string; pre-release suffixes are tolerated but the builder-compatible base is what determines artifact filenames.
- When adding new files to the update payload, ensure they are included in the `files` array of the `electron-builder` config and NOT listed in `SKIP_DIRS` / `SKIP_FILES` in `package-github-release.js`.
- For first-time releases, use `-IncludeFull` (or `--full`) so a full zip is produced; subsequent tags will automatically generate patch zips.
- Do not commit `.env`, `credentials/service-account.json`, `node_modules/`, or `dist/`; supply secrets via repository secrets or local environment variables.
- To sign locally, set `CSC_LINK` and `CSC_KEY_PASSWORD` before running the build script.
# Plan — macOS build of Hangup Portal v1.8.3 (self-contained)

## Goal

Build an **unsigned** macOS `.dmg` (x64 + arm64) of **Hangup Portal v1.8.3** — matching the
current Windows version — entirely from the **local source**, hosted in its **own GitHub repo**.
No dependency on `raymondwalkerhs-spec/hangup-hr`: the new repo contains its own source and its
own build workflow.

## Repo (self-contained)

- **Repo:** `superRTM/IMG-SUPER-RTM` (private)
- The PAT authenticates as `superRTM` and has the `workflow` scope, so the macOS
  workflow file can be committed and GitHub Actions can run in this repo.
- **Source pushed:** the local working dir, minus secrets & build artifacts.
  `.gitignore` already excludes `.env`, `credentials/*.json`, `node_modules/`, `dist/`,
  `*.log`, etc., so nothing sensitive is committed.
- **History:** pushed on an **orphan** branch (no parent commits), so the original
  `hangup-hr` history is not carried over and no historical secrets can leak.

## Version

- Windows current = **1.8.3** (already in `package-lock.json`).
- `package.json` was bumped `1.7.14 → 1.8.3` so the produced artifacts are named
  `Hangup-Portal-1.8.3-*.dmg` / `*-mac-*.zip`.
- Build is **unsigned** (`build.mac.identity: null`) — the user allows the app in
  **System Settings → Privacy & Security** after first launch.

## Build workflow (`.github/workflows/build-macos.yml`)

Runs on `macos-latest`, triggered by `workflow_dispatch` (default tag `v1.8.3`) or a `v*` tag push.

1. `actions/checkout@v4` — checks out **this repo's own** source (self-contained).
2. `actions/setup-node@v4` (Node 20, npm cache).
3. Prepare `.env`:
   - If Actions secret `SERVICE_ACCOUNT_JSON` is set → write it as `.env` and append
     `GITHUB_UPDATES_REPO=<this repo>`.
   - Else → build a placeholder `.env` from `SUPABASE_URL/SECRET/PUBLISHABLE` + `SESSION_SECRET`
     (falls back to CI placeholders). `GITHUB_UPDATES_REPO` points at this repo.
4. `npm ci --ignore-scripts` then `npm run rebuild:native` (rebuild `better-sqlite3` for Electron).
5. `bash scripts/build-macos.sh` → `electron-builder --mac dmg zip` (unsigned).
6. `node scripts/package-github-release.js --full` → update zips + `mac-*-latest.json` manifests.
7. `node scripts/verify-update-package.js` on each mac zip.
8. Upload `mac-build` **artifacts** (dmg + zips + manifests).
9. Publish a GitHub **Release** `v1.8.3` (latest) with all assets.

> Note: `scripts/build-macos.sh` refuses to run off-Darwin unless `CI=true`; the runner is
> `macos-latest` so it runs natively. `npm ci` requires `package-lock.json` (present, v1.8.3).

---

## How to do it (CLI)

All commands use the `gh` CLI authenticated with the repo-owning account
(`raymondwalkerhs-spec`). The token is supplied via `gh auth login` or the `GH_TOKEN`
environment variable — **it is never committed to the repo.**

### 1. Push the local source (one time)

From the local working dir (`F:\download app hr`):

```powershell
cd "F:\download app hr"

# Orphan branch so we push ONLY the current tree (no hangup-hr history / secrets)
git checkout --orphan mac-build
git add -A                       # respects .gitignore (.env, credentials, node_modules, dist excluded)
git commit -m "Hangup Portal v1.8.3 — self-contained macOS source"
git remote add newrepo https://github.com/superRTM/IMG-SUPER-RTM.git
git push -u newrepo mac-build:main --force
```

> If `main` already exists, the `--force` replaces it with the clean tree.

### 2. Trigger the macOS build

```powershell
gh workflow run build-macos.yml -R superRTM/IMG-SUPER-RTM
```

### 3. Watch the run

```powershell
gh run watch -R superRTM/IMG-SUPER-RTM
# or list first:  gh run list -R superRTM/IMG-SUPER-RTM
```

### 4. Download the dmg

From the GitHub Release:

```powershell
gh release download v1.8.3 -R superRTM/IMG-SUPER-RTM -p "*.dmg" -D ./out
```

Or from the workflow artifacts:

```powershell
gh run download -R superRTM/IMG-SUPER-RTM -n mac-build -D ./out
```

---

## GitHub API references (non-secret)

These are public GitHub REST/CLI endpoints and repo identifiers — safe to document.
Authenticate with a token in `GH_TOKEN` or the `Authorization: Bearer <token>` header.
Replace `OWNER/REPO` with `superRTM/IMG-SUPER-RTM`.

| Purpose | REST endpoint | `gh` CLI |
|---------|---------------|----------|
| Repo info | `GET /repos/superRTM/IMG-SUPER-RTM` | `gh repo view superRTM/IMG-SUPER-RTM` |
| List workflows | `GET /repos/superRTM/IMG-SUPER-RTM/actions/workflows` | `gh workflow list -R superRTM/IMG-SUPER-RTM` |
| Trigger build | `POST /repos/superRTM/IMG-SUPER-RTM/actions/workflows/build-macos.yml/dispatches` `{"ref":"main"}` | `gh workflow run build-macos.yml -R superRTM/IMG-SUPER-RTM` |
| List runs | `GET /repos/superRTM/IMG-SUPER-RTM/actions/runs` | `gh run list -R superRTM/IMG-SUPER-RTM` |
| Run status | `GET /repos/superRTM/IMG-SUPER-RTM/actions/runs/{run_id}` | `gh run watch -R superRTM/IMG-SUPER-RTM` |
| List releases | `GET /repos/superRTM/IMG-SUPER-RTM/releases` | `gh release list -R superRTM/IMG-SUPER-RTM` |
| Create release | `POST /repos/superRTM/IMG-SUPER-RTM/releases` `{"tag_name":"v1.8.3", ...}` | (done by the workflow via `softprops/action-gh-release`) |
| Download asset | `GET /repos/superRTM/IMG-SUPER-RTM/releases/assets/{asset_id}` | `gh release download v1.8.3 -R superRTM/IMG-SUPER-RTM -p "*.dmg"` |
| Upload artifact | `POST /repos/superRTM/IMG-SUPER-RTM/actions/runs/{run_id}/artifacts` | (done by the workflow via `actions/upload-artifact`) |

Base URL: `https://api.github.com` (REST) and `https://cli.github.com` (`gh`).

## Repository secrets (set in repo Settings → Secrets — NOT committed)

| Secret | Required | Purpose |
|--------|----------|---------|
| `SERVICE_ACCOUNT_JSON` | One of these | Full `.env` text, written as-is during CI build |
| `SUPABASE_URL` | Optional* | Packaged into CI `.env` |
| `SUPABASE_SECRET_KEY` | Optional* | Server API key |
| `SUPABASE_PUBLISHABLE_KEY` | Optional* | Client key |
| `SESSION_SECRET` | Optional* | Session signing |
| `GITHUB_TOKEN` | Auto | Provided to Actions automatically |

\* If `SERVICE_ACCOUNT_JSON` is absent, the build falls back to placeholder Supabase/state
values — the app builds and runs, but needs real credentials in `.env` for live data.

## Result

- Repo `superRTM/IMG-SUPER-RTM` contains the full local source + `build-macos.yml` + this `PLAN.md`.
  No `.env` / `credentials/*.json` / `node_modules` / `dist*` are committed (see `.gitignore`).
- A GitHub Release `v1.8.3` holds `Hangup-Portal-1.8.3-arm64.dmg`, the
  `Hangup-Portal-1.8.3-mac-arm64-full.zip` update bundle, and the `mac-arm64-latest.json` manifest.
- The in-app updater (if used) checks `GITHUB_UPDATES_REPO=superRTM/IMG-SUPER-RTM`.

### Build status (2026-07-15)

- ✅ macOS **arm64** `.dmg` + `.zip` built on `macos-latest` (arm64) and downloaded
  to `out/Hangup-Portal-1.8.3-arm64.dmg`. Covers all Apple-Silicon Macs.
- ⚠️ **x64 (Intel) not built.** Cross-compiling the x64 native deps (`bcrypt`) on the
  arm64 runner fails: `node-gyp` → `ModuleNotFoundError: No module named 'distutils'`
  (Python 3.12 removed `distutils`). The arm64 build is unaffected.
- To also ship an **x64** `.dmg`, run the same workflow on an **Intel (x64) macOS runner**,
  or pre-install `setuptools`/`python<3.12` on the runner and rebuild `bcrypt` from source
  (`npm_config_build_from_source=true`). Both arches can be built from an x64 runner.
- The mistakenly-created `raymondwalkerhs-spec/IMG-SUPER-RTM` was removed.

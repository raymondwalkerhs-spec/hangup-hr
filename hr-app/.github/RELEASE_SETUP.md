# GitHub repository setup

One-time steps to enable in-app patch updates. **Does not change** how you build installers on your PC.

Quick bootstrap script:

```powershell
cd "F:\download app hr"
.\scripts\bootstrap-github-repo.ps1
```

---

## 1. Create / connect the repo

```powershell
cd "F:\download app hr"
git init
git add .
git commit -m "Hangup HR — initial commit"
```

Create an empty repo on GitHub (e.g. `hangup-hr`), then:

```powershell
git remote add origin https://github.com/YOUR-ORG/hangup-hr.git
git branch -M main
git push -u origin main
```

**Do not commit:** `.env`, `credentials/service-account.json`, `node_modules/`, `dist/` (see `.gitignore`).

---

## 2. Repository secrets

**Settings → Secrets and variables → Actions → New repository secret**

| Secret | Required | Purpose |
|--------|----------|---------|
| `SUPABASE_URL` | Yes | Packaged into CI `.env` |
| `SUPABASE_SECRET_KEY` | Yes | Server API key |
| `SUPABASE_PUBLISHABLE_KEY` | Yes | Client key |
| `SESSION_SECRET` | Yes | Session signing |
| `CSC_LINK` | No | Windows code signing (CI) |
| `CSC_KEY_PASSWORD` | No | Windows signing password |

`GITHUB_TOKEN` is provided automatically to Actions.

---

## 3. Configure the app

In `.env` (packaged with builds via `extraResources`):

```env
GITHUB_UPDATES_REPO=raymondwalkerhs-spec/hangup-hr
```

Rebuild Windows installer once so new installs know where to check for updates.

---

## 4. Publish releases

### Option A — Local (with your installer build)

```powershell
.\scripts\build.ps1 all
npm run package:github -- --full
npm run publish:github
```

Requires [GitHub CLI](https://cli.github.com/) (`gh auth login`).

### Option B — GitHub Actions (recommended for win + mac)

```powershell
git tag v1.0.8-beta.1
git push origin v1.0.8-beta.1
```

Workflow [`.github/workflows/release.yml`](workflows/release.yml) runs:

1. **build-windows** — portable + unpacked → win-x64 zips
2. **build-macos** — dmg/zip + `.app` → mac-x64 / mac-arm64 zips
3. **publish** — single GitHub Release with all assets

Or: **Actions → Release (update packages) → Run workflow**.

**First release:** full zips only (no patch yet). Second tag onward: patch + full.

---

## 5. macOS caveats

- Updates apply inside `Hangup HR Beta.app/Contents`.
- Builds are **unsigned** — users may need to allow the app in **System Settings → Privacy & Security** after update.
- Future: ADM-09 Apple code signing.

---

## 6. Verify

1. Set `GITHUB_UPDATES_REPO` in packaged `.env` and install a build.
2. Push a newer `v*` tag (or publish via `publish:github`).
3. Open the app → **Update available** → **Update now**.

See [`UPDATES.md`](../UPDATES.md) for full process documentation.

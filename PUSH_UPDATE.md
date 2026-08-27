# Push an Hangup Portal update

Operator runbook. `npm run push:update` automates this; humans follow the same order. **Never upload while QA is red.**

```
build:web → page+dropdown QA (stop if red) → choose patch vs major → upload file first → then flip live
```

## Step 1 — Build first (do not skip)

```
npm run build:web
```

SPA in `public/dist` must match the code you intend to ship. Then start Hangup (`npm start` or packed `win-unpacked`). Tester and humans both use this build. Packaging NSIS comes **after** QA is green (major) or after the patch zip is built (patch).

## Step 2 — Check for future bugs (pages + dropdowns)

```
npm run test:pages
npm run test:rpm-forms   # optional: Checks/RPM Wrong MCN, 409 duplicate, empty-submit glow (same HR_TEST_* env)
```

Uses Playwright against the built SPA on localhost. Env: `HR_TEST_USER`, `HR_TEST_PASSWORD` (admin/CEO).

**A. Login first** — `/login` renders, no blank DNA screen, sign-in works, no version-block without Update now. A version-block with no Update now is a fail (“lower min_compatible”).

**B. Every nav page** from `src/app/nav-config.ts` in order (dashboard → … → settings). Skip `/cats` for load-error rules (it is a playground). Wait until the cat overlay (`[data-page-loader="1"]`) is gone (fail if still there at 20s).

Fail the page if any of: `pageerror`, `unhandledrejection`, `Cannot access`, ErrorBoundary, error card + Retry, HTTP 5xx from `/api/` for that page’s first fetch.

Do **not** fail on empty tables or 403 for a page this user cannot open (log as skip).

**C. Every dropdown on that page**

- Shared Select: `button[aria-haspopup="listbox"]` — click, listbox appears, `pointer-events` on the menu is not `none`, at least one option (or “No matches” only after typing). Close with Escape. **Do not commit** a new value (open/close only) so QA does not rewrite Org/payroll.
- Native `<select>`: exists, not `disabled` unless the UI says so, has options.
- Inside dialogs the tester **must open**, not only the idle page:
  - Sales log → **+ Add sale** (RPM) → Agent, Closer, Unit, client/catalog Selects + search type one letter
  - Checks → **+ New check** / **New check** → agent Select + MCN/phone inputs (Escape closes)
  - Q Feedback → page loads queue/empty (no ErrorBoundary)
  - Coaching → **+ New ticket** → agent/coach Selects
  - Org → pending **Approve** if a row exists → unit/team Selects

If search is shown, type `a` and assert the list updates (not frozen, not dialog-eaten).

**D. Repeat until green** — `push:update` runs this gate once; if red, **stop upload**, fix, rebuild, rerun. The pipeline will not publish a red build. It does not prove the software is empty of all bugs.

Manual extra (not all automated): HS-2 company switch once; Sales period picker open/close. The tester opens `/sales` on HS-2 when the test user can switch companies.

Installer smoke is **manual**: after a major, Update now on one 2.4.1 VM. Not automated in v1.

## Step 3 — When to update (choose channel)

| Situation | Command | Users get |
|-----------|---------|-----------|
| UI/hotfix, same `2.4.x`, `Hangup Portal.exe` unchanged, QA green | `npm run push:update` | Small Supabase zip |
| New line `2.5.0`, Electron/native change, or **first** cloud-aware EXE | `npm run push:update -- --major` | GitHub Setup.exe + web installer |
| QA red | **Do not publish** | — |
| Want to brick old EXEs | Never on a patch. `--major` + `--breaking` only when login/API is actually incompatible | |

**Line vs patch:** `major.minor` change (2.4 → 2.5) = GitHub Setup.exe. Third-segment bump (2.4.1 → 2.4.2) = Supabase zip.

Do not publish a patch until an **installer baseline** exists for this `major.minor` (`app_update_assets.kind = installer`). `2.4.0` cannot apply Supabase zips — that first cloud-aware EXE is GitHub **2.4.1**.

Patches **never raise** `min_compatible_version`.

## Step 4 — How the file is built, uploaded, made live

### Patch (`npm run push:update`)

1. Read `package.json` version (e.g. `2.4.2`). Baseline `from_version` = GitHub line EXE (`2.4.1` after that ship).
2. Pack `win-unpacked` if needed. Refuse if unpacked version ≠ `package.json`. Diff unpacked app vs baseline manifest; zip **full new `app.asar`** + changed unpacked natives. Abort if `Hangup Portal.exe` hash changed (`--major`).
3. `sha256` the zip.
4. **Upload first** to Storage `app-updates/win-x64/{version}/patch-from-{from}.zip`. `GET` the object, verify size + sha256. If GET fails, **do not** touch `app_versions`. Paths include the version so objects are immutable — never overwrite an existing sha256 path.
5. Upsert `app_update_assets` (version, platform, kind=patch, from_version, path, sha256, size).
6. Then `publish-app-version.js` **without** `--breaking` and **without** raising `min_compatible` (keep `1.0.0` or existing floor).
7. Assert exactly one `app_versions.is_current` row.
8. Print: version, zip bytes, public URL, `app_versions.is_current`.

### Major (`--major`)

Still run `test:pages` first. Then `dist:installer` → GitHub Latest Setup.exe + web installer + `win-x64-latest.json` → `app_update_assets` kind=installer → `publish-app-version.js`. Bytes on GitHub must be downloadable **before** `is_current` flips.

### Script flags

- `--dry-run` print only.
- `--skip-test` forbidden in this runbook except a broken Playwright env; the script logs a warning.
- `--major` GitHub Setup.exe line.
- `--breaking` only with `--major`, and only when login/API is actually incompatible.

Env: `SUPABASE_URL`, service role, `HR_TEST_USER`, `HR_TEST_PASSWORD`, `GITHUB_UPDATES_REPO` for major.

## Step 5 — After live

- One 2.4.1 machine: Update now → small zip → relaunch shows new version.
- One 2.4.0 machine: Update now → Setup.exe 2.4.1, not a zip they cannot apply.
- Rollback: set previous `app_versions` `is_current = true`; **do not delete** the zip (users mid-download).

## Residual failures (guards)

- Flip live before the file is fetchable → 404. Guard: GET+sha256 before `is_current`.
- Two `is_current` rows if clear-current fails. Guard: assert exactly one current row after publish.
- QA never opens Add sale → RPM search ships broken again. Guard: tester step 2C opens that dialog.
- Dropdown test saves a real Org/agent change. Guard: open/Escape only; never click-to-select on org pickers.
- Native `<select>` still used on login/training — shared Select tester misses them. Guard: also query `select` elements.
- HS-2 context untested. Guard: if test user can switch company, open `/sales` once on HS-2.
- Patch zip built from dirty `win-unpacked` (old asar). Guard: refuse if unpacked version ≠ `package.json`.
- Supabase Storage cache serving old zip at same path. Guard: path includes version; never overwrite.
- Test user blocked by min_compatible. Guard: tester treats version-block as fail with “lower min_compatible”; patches never raise it.
- Playwright vs packed EXE. Accepted residual: installer smoke is manual.
- Zero-bug claim. Impossible. Guard: pipeline **blocks publish on red QA**.

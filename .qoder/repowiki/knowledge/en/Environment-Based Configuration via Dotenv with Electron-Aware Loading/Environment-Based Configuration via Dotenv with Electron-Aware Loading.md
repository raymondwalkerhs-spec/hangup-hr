---
kind: configuration_system
name: Environment-Based Configuration via Dotenv with Electron-Aware Loading
category: configuration_system
scope:
    - '**'
source_files:
    - .env.example
    - lib/app-bootstrap.js
    - electron/main.js
    - lib/supabase-client.js
    - lib/backend.js
    - lib/airtable-client.js
    - lib/github-updater.js
---

The Hangup HR Desktop app uses a simple, file-based configuration system driven entirely by environment variables loaded from `.env` files. There is no dedicated config module or schema validator — configuration is consumed directly through `process.env` across the codebase, with a single centralized loader that resolves the correct `.env` path at startup.

**Loading strategy**
The central loader `lib/app-bootstrap.js::loadEnvironment()` walks a prioritized list of candidate `.env` locations and loads the first one found via `dotenv.config({ path })`. The search order accounts for development, packaged Electron, and portable installs:
1. `$HR_APP_ROOT/.env` (explicit override)
2. `<repo-root>/.env`
3. `<cwd>/.env`
4. `<resourcesPath>/.env` (packaged Electron)
5. `$PORTABLE_EXECUTABLE_DIR/.env` and `$PORTABLE_EXECUTABLE_DIR/HangupHR-data/.env` (portable mode)
6. `<execDir>/.env`
7. `<app.getAppPath()>/ .env` (Electron app bundle root)

If none exists, loading returns `null` and the app proceeds with defaults where possible.

**Startup validation**
At Electron bootstrap (`electron/main.js`), `assertSupabaseConfigured()` is called before starting the Express server. It rejects startup if `DATA_BACKEND=sheets` (deprecated) or if Supabase credentials are missing, surfacing a user-facing error dialog instead of crashing silently.

**Configuration surface area**
All runtime settings are exposed as `process.env` keys documented in `.env.example`:
- Backend: `DATA_BACKEND`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL`, optional `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`
- Server: `SESSION_SECRET`, `PORT` (default 3847)
- Updates: `GITHUB_UPDATES_REPO`, `GITHUB_UPDATES_TOKEN` / `GITHUB_TOKEN`
- Dropbox (sales attachments): `DROPBOX_ACCESS_TOKEN`, `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`
- Airtable sync: `AIRTABLE_API_KEY`/`AIRTABLE_PAT`, `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_NAME`, `AIRTABLE_SYNC_ENABLED`, `AIRTABLE_SYNC_DEBOUNCE_MS`, `AIRTABLE_ATTACHMENT_URL_TTL_SEC`, `AIRTABLE_SKIP_ATTACHMENT_KINDS`, `AIRTABLE_PORTAL_SALE_ID_FIELD`
- Runtime hints: `HR_APP_ROOT`, `HR_CACHE_DIR`, `HR_PORTABLE`, `HR_INSTALL_HEALTH`, `PORTABLE_EXECUTABLE_DIR`

Each feature reads its own subset directly from `process.env` inside its module (e.g., `lib/supabase-client.js`, `lib/airtable-client.js`, `lib/github-updater.js`). There is no shared config object; values are read on demand.

**Defaults and fallbacks**
- `DATA_BACKEND` defaults to `supabase` (sheets rejected outright).
- `SESSION_SECRET` falls back to a hardcoded string when unset.
- `PORT` is hard-coded to 3847 in the Electron main process.
- Many optional integrations (Airtable, Dropbox) short-circuit when their required env vars are absent.

**Packaging & distribution**
In Electron builds, `.env` files can be shipped under `resources/.env` (inside the packaged app) so end users don't need to edit files manually. Portable installations support a per-installation `.env` alongside the executable or under `HangupHR-data/`.

**Rules developers should follow**
- Add new configuration keys to `.env.example` and document them inline.
- Read configuration exclusively via `process.env.*`; do not create a separate config object.
- Provide sensible defaults and validate critical settings in `assertSupabaseConfigured()` or the relevant module's initialization.
- Keep secrets out of the renderer/UI — only server-side modules (`lib/*`) should consume `SUPABASE_SECRET_KEY`.
- For optional integrations, gate functionality with an `isConfigured()` helper that checks the presence of required env vars.
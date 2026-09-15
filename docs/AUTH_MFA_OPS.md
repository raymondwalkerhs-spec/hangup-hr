# Auth MFA + Google — ops checklist (Hangup Portal)

Feature flag: MFA/Google bridge defaults to **dual** (no per-PC `.env` required).

Optional controls:
- Supabase `app_config.authBackend` = `"dual"` | `"legacy"` (synced to all PCs)
- Local emergency only: `AUTH_BACKEND=legacy` in Hangup `.env`

OIDC project host: `ugntjwqimgosuiodsnnk.supabase.co`  
Electron redirect: `hangup-portal://auth/callback`

## Product rules (locked)

| Action | Authenticator OTP? |
|--------|--------------------|
| Daily password login | **No** |
| Daily Google login (after link) | **No** |
| MFA enroll (`/setup-2fa`) | **Yes** |
| Forgot password (login screen) | **Yes** — username + TOTP → new password |
| Change password (Settings → Account security) | **Yes** (when enrolled) |
| Unlink Google | **Yes** |
| Registration email | Claimed only (`email_claimed`) |
| Confirmed Gmail | After OAuth / `linkIdentity` → `google_email` + employee card |
| Cold Google login | Only if `google_email` already linked — **never** auto-create users |
| Email magic-link / SMTP reset | **Never** (out of scope) |

## Password recovery

- **Self-service (users):** Login → **Forgot password?** → username + Authenticator code + new password. No email; do **not** show admin menu paths on that screen.
- **Admin (lost phone / no MFA):** **Users → Reset password** (temp password; default clears MFA + unlinks Google so they re-enroll).
- **Signed-in change:** **Settings → Account security → Change password** (current password + TOTP).

## Google Cloud Console (ops)

1. Create OAuth 2.0 Client (**Web application** preferred for Supabase; Desktop “installed” often fails redirects).
2. Authorized redirect URIs must include Supabase callback, e.g.  
   `https://ugntjwqimgosuiodsnnk.supabase.co/auth/v1/callback`
3. Add custom scheme allowlist where supported: `hangup-portal://auth/callback` (Electron deep link).
4. Copy Client ID + Secret into **Supabase Dashboard → Authentication → Providers → Google**.
5. Supabase Auth → URL configuration: add redirect URLs:
   - `http://127.0.0.1:3847/auth/callback` (primary — external browser → local app poll)
   - `http://localhost:3847/auth/callback`
   - `hangup-portal://auth/callback` (optional deep link)
6. Enable Google provider; leave email confirmation off for synthetic `@users.hangup.local` identities.
7. **Enable Manual linking** (Authentication settings) — required for `linkIdentity()` Google link.
8. Hangup `.env`: `AUTH_BACKEND=dual` and `AUTH_GOOGLE_REDIRECT_URI=http://127.0.0.1:3847/auth/callback`. Never commit secrets.

## Supabase

1. Apply migration: `supabase/migrations/20260913_app_users_auth_google_mfa.sql`
2. Confirm service role key is on the desktop/server (admin createUser + MFA admin reset).
3. Publishable/anon key available for `signInWithPassword` / OAuth PKCE exchange.

## Dual-run cutover

1. Fleet default is **dual** from 2.7.1+ (no per-PC `.env`).
2. Seed/confirm `app_config.authBackend` = `"dual"` (migration `20260915_app_config_auth_backend_dual.sql`).
3. On each password login: bcrypt still validates; bridge syncs password into Auth (`auth_user_id`, `synthetic_email`, `auth_password_synced_at`).
4. Soft session `pending_setup` until MFA enrolled **or** Google linked (product: either completes setup).
5. Rollback: set `app_config.authBackend` to `"legacy"` (or local `AUTH_BACKEND=legacy`) — bcrypt path unchanged; setup gates off.

## QA scenarios

1. **Legacy login** — `AUTH_BACKEND` unset/legacy → username/password works; no `/setup-2fa` gate.
2. **Dual first login** — password OK → `pending_setup` → `/setup-2fa` → QR + TOTP → `/link-google` → browser OAuth → full session.
3. **Login has no OTP** — after enroll, daily login is password or Google only.
4. **Forgot password** — username + TOTP → new password → sign in (no email copy on screen).
5. **Cold Google linked** — Sign in with Google succeeds for matching `google_email`.
6. **Cold Google unknown** — rejected `google_not_linked`; no user created.
7. **Change password** — requires TOTP when enrolled; syncs Auth password.
8. **Unlink Google** — requires TOTP; session returns to `pending_setup` / link gate.
9. **Admin Reset MFA** — Users page → Reset MFA → user must re-enroll.
10. **Electron deep link** — `hangup-portal://auth/callback?code=…` focuses second-instance and opens `/oauth-pending`.
11. **20s hang** — setup/OAuth pages show Retry (no blank hang).
12. **Registration email** — stored as `email_claimed`; employee email overwritten only after Google link.
13. **Redirect mismatch** — error map returns `redirect_uri_mismatch` with ops hint.

## Remaining packaging / ops notes

- Rebuild installer so `package.json` `build.protocols` registers `hangup-portal` on Windows/macOS.
- First-run protocol registration uses `app.setAsDefaultProtocolClient` (already stubbed in `electron/main.js`).
- Do **not** bump app version solely for this flag flip; ship with release process when ready.

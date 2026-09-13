# Auth MFA + Google — ops checklist (Hangup Portal)

Feature flag: `AUTH_BACKEND=legacy` (default, bcrypt only) or `AUTH_BACKEND=dual` (bcrypt login + Auth sync + MFA/Google gates).

OIDC project host: `ugntjwqimgosuiodsnnk.supabase.co`  
Electron redirect: `hangup-portal://auth/callback`

## Product rules (locked)

| Action | Authenticator OTP? |
|--------|--------------------|
| Daily password login | **No** |
| Daily Google login (after link) | **No** |
| MFA enroll (`/setup-2fa`) | **Yes** |
| Change password | **Yes** (when enrolled) |
| Unlink Google | **Yes** |
| Registration email | Claimed only (`email_claimed`) |
| Confirmed Gmail | After OAuth / `linkIdentity` → `google_email` + employee card |
| Cold Google login | Only if `google_email` already linked — **never** auto-create users |

## Google Cloud Console (ops)

1. Create OAuth 2.0 Client (Desktop or Web as required by Supabase Google provider docs).
2. Authorized redirect URIs must include Supabase callback, e.g.  
   `https://ugntjwqimgosuiodsnnk.supabase.co/auth/v1/callback`
3. Add custom scheme allowlist where supported: `hangup-portal://auth/callback` (Electron deep link).
4. Copy Client ID + Secret into **Supabase Dashboard → Authentication → Providers → Google**.
5. Supabase Auth → URL configuration: add `hangup-portal://auth/callback` to Redirect URLs.
6. Enable Google provider; leave email confirmation off for synthetic `@users.hangup.local` identities.

## Supabase

1. Apply migration: `supabase/migrations/20260913_app_users_auth_google_mfa.sql`
2. Confirm service role key is on the desktop/server (admin createUser + MFA admin reset).
3. Publishable/anon key available for `signInWithPassword` / OAuth PKCE exchange.

## Dual-run cutover

1. Keep `AUTH_BACKEND=legacy` in production until migration + Google client are ready.
2. Staging: set `AUTH_BACKEND=dual`.
3. On each password login: bcrypt still validates; bridge syncs password into Auth (`auth_user_id`, `synthetic_email`, `auth_password_synced_at`).
4. Soft session `pending_setup` until MFA enrolled **and** Google linked.
5. Rollback: set `AUTH_BACKEND=legacy` — bcrypt path unchanged; setup gates off.

## QA scenarios

1. **Legacy login** — `AUTH_BACKEND` unset/legacy → username/password works; no `/setup-2fa` gate.
2. **Dual first login** — password OK → `pending_setup` → `/setup-2fa` → QR + TOTP → `/link-google` → browser OAuth → full session.
3. **Login has no OTP** — after enroll, daily login is password or Google only.
4. **Cold Google linked** — Sign in with Google succeeds for matching `google_email`.
5. **Cold Google unknown** — rejected `google_not_linked`; no user created.
6. **Change password** — requires TOTP when enrolled; syncs Auth password.
7. **Unlink Google** — requires TOTP; session returns to `pending_setup` / link gate.
8. **Admin Reset MFA** — Users page → Reset MFA → user must re-enroll.
9. **Electron deep link** — `hangup-portal://auth/callback?code=…` focuses second-instance and opens `/oauth-pending`.
10. **20s hang** — setup/OAuth pages show Retry (no blank hang).
11. **Registration email** — stored as `email_claimed`; employee email overwritten only after Google link.
12. **Redirect mismatch** — error map returns `redirect_uri_mismatch` with ops hint.

## Remaining packaging / ops notes

- Rebuild installer so `package.json` `build.protocols` registers `hangup-portal` on Windows/macOS.
- First-run protocol registration uses `app.setAsDefaultProtocolClient` (already stubbed in `electron/main.js`).
- Do **not** bump app version solely for this flag flip; ship with release process when ready.

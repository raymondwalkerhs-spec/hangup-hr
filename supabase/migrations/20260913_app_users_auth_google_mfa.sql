-- Auth MFA + Google link columns (Hangup Portal PART C)
-- Safe to re-run: IF NOT EXISTS / DO blocks.

-- ─── app_users: Supabase Auth bridge + Google + MFA ───────────────────────────
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS synthetic_email text;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email_claimed text;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS google_email text;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS google_linked_at timestamptz;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS mfa_required boolean NOT NULL DEFAULT true;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS mfa_enrolled_at timestamptz;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS auth_password_synced_at timestamptz;

COMMENT ON COLUMN app_users.auth_user_id IS 'Linked auth.users.id (Supabase Auth)';
COMMENT ON COLUMN app_users.synthetic_email IS 'Password Auth identity (e.g. username@users.hangup.local); not a real mailbox';
COMMENT ON COLUMN app_users.email_claimed IS 'Unconfirmed email from registration/admin; not trusted for Google login';
COMMENT ON COLUMN app_users.google_email IS 'Confirmed Google email after OAuth linkIdentity; used for cold Google login';
COMMENT ON COLUMN app_users.google_linked_at IS 'When Google identity was linked';
COMMENT ON COLUMN app_users.mfa_required IS 'When true, user must enroll TOTP before full session (AUTH_BACKEND dual/supabase)';
COMMENT ON COLUMN app_users.mfa_enrolled_at IS 'When Authenticator TOTP was successfully enrolled';
COMMENT ON COLUMN app_users.auth_password_synced_at IS 'Last successful bcrypt→Auth password sync';

-- Unique confirmed Google email (case-insensitive); nulls allowed
CREATE UNIQUE INDEX IF NOT EXISTS app_users_google_email_lower_uidx
  ON app_users (lower(google_email))
  WHERE google_email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS app_users_synthetic_email_lower_uidx
  ON app_users (lower(synthetic_email))
  WHERE synthetic_email IS NOT NULL;

-- Backfill claimed email from legacy contact email where empty
UPDATE app_users
SET email_claimed = lower(trim(email))
WHERE email_claimed IS NULL
  AND email IS NOT NULL
  AND trim(email) <> '';

-- ─── app_sessions: soft setup sessions + login audit ──────────────────────────
ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS session_kind text NOT NULL DEFAULT 'full';
ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS auth_user_id uuid;
ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS login_method text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_sessions_session_kind_chk'
  ) THEN
    ALTER TABLE app_sessions
      ADD CONSTRAINT app_sessions_session_kind_chk
      CHECK (session_kind IN ('full', 'pending_setup'));
  END IF;
END $$;

COMMENT ON COLUMN app_sessions.session_kind IS 'full = normal app access; pending_setup = MFA enroll and/or Link Google only';
COMMENT ON COLUMN app_sessions.auth_user_id IS 'Supabase Auth user id for this session (optional)';
COMMENT ON COLUMN app_sessions.login_method IS 'password | google | admin';

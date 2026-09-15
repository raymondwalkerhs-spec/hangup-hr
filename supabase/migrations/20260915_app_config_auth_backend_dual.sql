-- Fleet default: MFA/Google bridge on without per-PC AUTH_BACKEND=.env
INSERT INTO app_config (key, value, updated_at)
VALUES ('authBackend', '"dual"', now())
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at;

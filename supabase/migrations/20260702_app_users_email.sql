-- Optional contact email on app_users (for future forgot-password / self-service reset)
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email text;

COMMENT ON COLUMN app_users.email IS 'Contact email for password reset notifications (optional, set by system admin)';

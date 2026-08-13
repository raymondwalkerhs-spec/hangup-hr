-- Per-company role permission overrides.
-- HR in Main Hangup can now have different access control than HR in HS-2.
-- Existing rows are backfilled as company = 'hangup' (Main Hangup) so behavior is unchanged
-- until admins configure HS-2 overrides via the Access Control page.

ALTER TABLE app_role_permissions ADD COLUMN IF NOT EXISTS company text NOT NULL DEFAULT 'hangup';

ALTER TABLE app_role_permissions DROP CONSTRAINT IF EXISTS app_role_permissions_pkey;
ALTER TABLE app_role_permissions ADD PRIMARY KEY (company, role, permission_key);

DROP INDEX IF EXISTS idx_app_role_permissions_role;
CREATE INDEX IF NOT EXISTS idx_app_role_permissions_company_role
  ON app_role_permissions (company, role);

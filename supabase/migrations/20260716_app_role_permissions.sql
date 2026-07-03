-- App-wide role permission overrides (admin Access Control UI)
-- Empty table = hardcoded defaults in lib/roles.js apply unchanged.

CREATE TABLE IF NOT EXISTS app_role_permissions (
  role text NOT NULL,
  permission_key text NOT NULL,
  allowed boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  PRIMARY KEY (role, permission_key)
);

CREATE INDEX IF NOT EXISTS idx_app_role_permissions_role ON app_role_permissions (role);

ALTER TABLE app_role_permissions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'app_role_permissions' AND policyname = 'deny_all_app_role_permissions'
  ) THEN
    CREATE POLICY deny_all_app_role_permissions ON app_role_permissions
      FOR ALL TO anon, authenticated USING (false);
  END IF;
END $$;

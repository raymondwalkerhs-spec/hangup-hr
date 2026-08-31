-- Cloud update assets (Supabase patches) + OTHER placeholder agent.

CREATE TABLE IF NOT EXISTS app_update_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL,
  platform text NOT NULL DEFAULT 'win-x64',
  kind text NOT NULL CHECK (kind IN ('patch', 'installer')),
  from_version text NOT NULL DEFAULT '',
  storage_path text NOT NULL,
  sha256 text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version, platform, kind, from_version)
);

CREATE INDEX IF NOT EXISTS app_update_assets_version_idx
  ON app_update_assets (platform, version, kind);

ALTER TABLE app_update_assets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'app_update_assets' AND policyname = 'app_update_assets_deny_all'
  ) THEN
    CREATE POLICY app_update_assets_deny_all ON app_update_assets FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('app-updates', 'app-updates', true, 524288000)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit;

-- Public GET of known paths uses the public bucket URL. Do not grant listing via storage.objects.

INSERT INTO employees (
  id,
  american_name,
  arabic_name,
  status,
  position,
  unit,
  team,
  sales_mla_enabled,
  sales_rpm_enabled,
  payroll_exempt
)
VALUES (
  'OTHER',
  'Other',
  '',
  'Out',
  'Agent',
  NULL,
  NULL,
  true,
  true,
  true
)
ON CONFLICT (id) DO UPDATE SET
  american_name = EXCLUDED.american_name,
  status = 'Out',
  sales_mla_enabled = true,
  sales_rpm_enabled = true,
  payroll_exempt = true,
  team = NULL;

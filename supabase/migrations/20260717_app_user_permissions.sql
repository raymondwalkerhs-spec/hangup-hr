-- Per-user permission overrides (exception access on top of role defaults).
CREATE TABLE IF NOT EXISTS app_user_permissions (
  username TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  allowed BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT,
  PRIMARY KEY (username, permission_key)
);

CREATE INDEX IF NOT EXISTS idx_app_user_permissions_username ON app_user_permissions (username);

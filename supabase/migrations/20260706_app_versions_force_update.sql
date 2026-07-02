-- Optional: minimum version required for field HR roles (hr, quality, agent, tl, op, rtm).
-- Admins/CEO/finance may still run older builds until min_compatible_version blocks everyone.
ALTER TABLE app_versions
  ADD COLUMN IF NOT EXISTS force_update_min_version text;

COMMENT ON COLUMN app_versions.force_update_min_version IS
  'When set, hr/quality/agent/tl/op/rtm users below this version are blocked at login.';

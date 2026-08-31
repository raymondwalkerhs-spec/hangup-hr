-- Force HS3-54 (julia jason) into the sale agent picker on installed 2.3.22+.
-- Background: she was moved Daemon → Justin; desktops with a stale employee cache
-- still treated Daemon as non-dialing and hid her. sales_agent_picker=true is the
-- documented SQL override so she appears without waiting for a new app build.
-- Also re-assert live assignment fields so the next employee sync is correct.

UPDATE employees
SET
  status = 'Active',
  unit = 'HS-3',
  team = 'Justin',
  position = COALESCE(NULLIF(TRIM(position), ''), 'Agent'),
  sales_mla_enabled = true,
  sales_rpm_enabled = true,
  sales_agent_picker = true,
  updated_at = NOW()
WHERE id = 'HS3-54';

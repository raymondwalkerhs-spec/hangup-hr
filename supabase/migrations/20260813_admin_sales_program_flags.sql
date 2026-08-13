-- Enable MLA + RPM sales for system admin app users (raymond, mark).
UPDATE employees e
SET
  sales_mla_enabled = true,
  sales_rpm_enabled = true,
  updated_at = now()
FROM app_users u
WHERE u.employee_id = e.id
  AND lower(u.username) IN ('raymond', 'mark');

-- Backfill sales program flags (non-out employees only).
-- TL / OP / closers: MLA + RPM. Other dialing agents: RPM only.

WITH roster AS (
  SELECT id, unit, team, position, status
  FROM employees
  WHERE lower(trim(coalesce(status, ''))) NOT IN ('out', 'out but still get paid', 'out still paid', 'deleted')
),
leadership_ids AS (
  SELECT DISTINCT trim(tl_employee_id) AS id
  FROM org_teams
  WHERE tl_employee_id IS NOT NULL AND trim(tl_employee_id) <> ''
  UNION
  SELECT DISTINCT trim(employee_id) AS id
  FROM team_tls
  WHERE employee_id IS NOT NULL AND trim(employee_id) <> ''
  UNION
  SELECT DISTINCT trim(employee_id) AS id
  FROM team_closers
  WHERE employee_id IS NOT NULL AND trim(employee_id) <> ''
),
leadership_emp AS (
  SELECT a.id
  FROM roster a
  WHERE upper(trim(a.id)) ~ '^(TL|OP|CL)'
     OR a.id IN (SELECT id FROM leadership_ids)
),
dialing_emp AS (
  SELECT a.id
  FROM roster a
  WHERE a.id NOT IN (SELECT id FROM leadership_emp)
    AND upper(trim(a.id)) !~ '^(TL|CL|OP|HR|MG|OF|NW|RTM|QA|DEL)'
    AND coalesce(a.unit, '') NOT IN ('HS-Back-End', 'HS-MGMT', 'HR-MGMT', 'Management')
    AND coalesce(a.unit, '') !~ '-PT$'
    AND coalesce(a.team, '') NOT IN ('HR', 'Quality', 'Back-End', 'Daemon')
    AND lower(coalesce(a.position, '')) NOT LIKE '%team leader%'
    AND lower(coalesce(a.position, '')) NOT LIKE '%closer%'
    AND lower(coalesce(a.position, '')) NOT IN ('op', 'quality', 'rtm')
    AND lower(coalesce(a.position, '')) NOT LIKE 'hr %'
)
UPDATE employees e
SET
  sales_mla_enabled = true,
  sales_rpm_enabled = true,
  updated_at = now()
WHERE e.id IN (SELECT id FROM leadership_emp);

UPDATE employees e
SET
  sales_mla_enabled = false,
  sales_rpm_enabled = true,
  updated_at = now()
WHERE e.id IN (SELECT id FROM dialing_emp);

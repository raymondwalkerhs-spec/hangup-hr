-- HS-2 management roster: remove Kate team, add HS2-MGMT, assign Hazel/Robert as OP

DELETE FROM org_teams WHERE name = 'Kate';

INSERT INTO org_teams (name, unit, display_order, dials_sales)
VALUES ('HS2-MGMT', 'HS-2', 5, false)
ON CONFLICT (name) DO UPDATE SET unit = 'HS-2', dials_sales = false, display_order = 5;

-- Assign existing Hazel / Robert records to HS-2 OP management (idempotent by name)
UPDATE employees
SET unit = 'HS-2', position = 'OP', team = 'HS2-MGMT', updated_at = now()
WHERE (
  lower(trim(coalesce(american_name, ''))) LIKE '%hazel%'
  OR lower(trim(coalesce(arabic_name, ''))) LIKE '%hazel%'
  OR lower(trim(coalesce(american_name, ''))) LIKE '%robert%'
  OR lower(trim(coalesce(arabic_name, ''))) LIKE '%robert%'
)
AND unit IN ('HS-2', 'HS2-PT', 'HS-1', '', 'HS-MGMT')
AND coalesce(status, 'Active') NOT ILIKE '%out%';

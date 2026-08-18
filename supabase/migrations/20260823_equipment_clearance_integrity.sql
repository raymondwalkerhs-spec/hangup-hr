-- Equipment / clearance integrity
-- Backfill company from org_unit_managers (employees has no company column).
-- Enforce one open assignment per device. Index open assignments by employee.

UPDATE equipment e
SET company = COALESCE(
  NULLIF(btrim(e.company), ''),
  (
    SELECT oum.company
    FROM org_unit_managers oum
    WHERE oum.unit = e.unit
      AND NULLIF(btrim(oum.company), '') IS NOT NULL
    LIMIT 1
  ),
  'hangup'
)
WHERE e.company IS NULL OR btrim(e.company) = '';

ALTER TABLE equipment ALTER COLUMN company SET DEFAULT 'hangup';
ALTER TABLE equipment ALTER COLUMN company SET NOT NULL;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY equipment_id
           ORDER BY assigned_at ASC NULLS LAST, id
         ) AS rn
  FROM equipment_assignments
  WHERE returned_at IS NULL
)
UPDATE equipment_assignments ea
SET
  returned_at = now(),
  notes = CASE
    WHEN COALESCE(btrim(ea.notes), '') = '' THEN '[migration] closed duplicate open assignment'
    ELSE ea.notes || E'\n[migration] closed duplicate open assignment'
  END
FROM ranked r
WHERE ea.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS equipment_assignments_one_open_idx
  ON equipment_assignments (equipment_id)
  WHERE returned_at IS NULL;

CREATE INDEX IF NOT EXISTS equipment_assignments_open_emp_idx
  ON equipment_assignments (employee_id)
  WHERE returned_at IS NULL;

UPDATE clearance_items SET status = 'done' WHERE status = 'completed';

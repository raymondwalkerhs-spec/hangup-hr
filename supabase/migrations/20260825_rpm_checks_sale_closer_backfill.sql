-- Q Feedback rows auto-linked as Sale sometimes kept closer_id NULL.
-- Copy closer from the linked RPM sale when the check is a sale and closer is missing.
-- Fixes e.g. Elsa V Peacock / 8fq2qu7jh97 (check → sale closer HS3-46).

UPDATE rpm_checks AS c
SET
  closer_id = s.closer_id,
  updated_at = NOW()
FROM rpm_sales AS s
WHERE c.linked_rpm_sale_id = s.id
  AND c.deleted_at IS NULL
  AND c.check_status = 'q'
  AND c.feedback_status = 'sale'
  AND c.closer_id IS NULL
  AND s.closer_id IS NOT NULL
  AND TRIM(s.closer_id) <> '';

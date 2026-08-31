-- Q Feedback rows auto-linked as Sale must show the RPM sale closer.
-- One-shot backfill was not enough: linkSaleToCheck never copied closer_id,
-- so later submits still left Closer blank. Keep closer in sync via triggers.

CREATE OR REPLACE FUNCTION sync_rpm_check_closer_from_linked_sale()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  sale_closer text;
BEGIN
  IF NEW.linked_rpm_sale_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- When newly linked, or closer still empty while linked, take closer from the sale.
  IF TG_OP = 'UPDATE'
     AND NEW.linked_rpm_sale_id IS NOT DISTINCT FROM OLD.linked_rpm_sale_id
     AND COALESCE(NULLIF(TRIM(NEW.closer_id), ''), '') <> '' THEN
    RETURN NEW;
  END IF;

  SELECT NULLIF(TRIM(s.closer_id), '')
    INTO sale_closer
  FROM rpm_sales AS s
  WHERE s.id = NEW.linked_rpm_sale_id;

  IF sale_closer IS NOT NULL THEN
    NEW.closer_id := sale_closer;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rpm_check_closer_from_linked_sale ON rpm_checks;
CREATE TRIGGER trg_rpm_check_closer_from_linked_sale
  BEFORE INSERT OR UPDATE OF linked_rpm_sale_id, closer_id
  ON rpm_checks
  FOR EACH ROW
  EXECUTE PROCEDURE sync_rpm_check_closer_from_linked_sale();

-- If the sale closer is reassigned later, push to every linked Q Feedback row.
CREATE OR REPLACE FUNCTION sync_linked_rpm_checks_closer_from_sale()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.closer_id IS NOT DISTINCT FROM OLD.closer_id THEN
    RETURN NEW;
  END IF;

  UPDATE rpm_checks AS c
  SET
    closer_id = NEW.closer_id,
    updated_at = NOW()
  WHERE c.linked_rpm_sale_id = NEW.id
    AND c.deleted_at IS NULL
    AND c.closer_id IS DISTINCT FROM NEW.closer_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_linked_rpm_checks_closer_from_sale ON rpm_sales;
CREATE TRIGGER trg_linked_rpm_checks_closer_from_sale
  AFTER INSERT OR UPDATE OF closer_id
  ON rpm_sales
  FOR EACH ROW
  EXECUTE PROCEDURE sync_linked_rpm_checks_closer_from_sale();

-- Backfill existing sale-linked Q rows (and any other linked checks) missing closer.
UPDATE rpm_checks AS c
SET
  closer_id = s.closer_id,
  updated_at = NOW()
FROM rpm_sales AS s
WHERE c.linked_rpm_sale_id = s.id
  AND c.deleted_at IS NULL
  AND s.closer_id IS NOT NULL
  AND TRIM(s.closer_id) <> ''
  AND (
    c.closer_id IS NULL
    OR TRIM(c.closer_id) = ''
    OR c.closer_id IS DISTINCT FROM s.closer_id
  );

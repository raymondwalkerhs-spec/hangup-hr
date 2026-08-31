-- Sales log RPM tiles read workflow status (Passed = passed, Dropped = denied).
-- Client feedback is the source of truth: Approved → passed, Denied → denied.
-- Backfill existing rows and keep status in sync when form_data is written
-- (main edit can change clientFeedback without going through the quality ticket path).

CREATE OR REPLACE FUNCTION sync_rpm_sales_status_from_client_feedback()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  client text;
BEGIN
  NEW.form_data := COALESCE(NEW.form_data, '{}'::jsonb);
  client := lower(trim(COALESCE(
    NULLIF(NEW.form_data->>'clientFeedback', ''),
    NULLIF(NEW.form_data->>'Client Feedback', ''),
    NULLIF(NEW.form_data->>'Client feedback', ''),
    ''
  )));

  IF client IN ('denied', 'dropped') THEN
    NEW.status := 'denied';
    NEW.form_data := NEW.form_data || jsonb_build_object(
      'clientFeedback', 'Denied',
      'retransfer', false
    );
  ELSIF client IN ('approved', 'passed') THEN
    NEW.status := 'passed';
    NEW.form_data := NEW.form_data || jsonb_build_object(
      'clientFeedback', 'Approved',
      'retransfer', false
    );
  ELSIF client = 'retransfer' THEN
    NEW.status := 'callback';
    NEW.form_data := NEW.form_data || jsonb_build_object(
      'clientFeedback', 'Retransfer',
      'retransfer', true
    );
  ELSIF client = 'callback' THEN
    NEW.status := 'callback';
    NEW.form_data := NEW.form_data || jsonb_build_object(
      'clientFeedback', 'Callback',
      'retransfer', false
    );
  ELSIF client = 'pending' THEN
    NEW.status := 'pending';
    NEW.form_data := NEW.form_data || jsonb_build_object(
      'clientFeedback', 'Pending',
      'retransfer', false
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rpm_sales_status_from_client_feedback ON rpm_sales;
CREATE TRIGGER trg_rpm_sales_status_from_client_feedback
  BEFORE INSERT OR UPDATE OF form_data
  ON rpm_sales
  FOR EACH ROW
  EXECUTE PROCEDURE sync_rpm_sales_status_from_client_feedback();

UPDATE rpm_sales
SET form_data = COALESCE(form_data, '{}'::jsonb)
WHERE COALESCE(
  NULLIF(form_data->>'clientFeedback', ''),
  NULLIF(form_data->>'Client Feedback', ''),
  NULLIF(form_data->>'Client feedback', ''),
  ''
) <> '';

-- Optional 5-minute catch-up if a pg_net POST was dropped.
-- No-op when pg_cron is not available on the project.

CREATE OR REPLACE FUNCTION public.run_airtable_rpm_catchup()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg public._internal_airtable_rpm_config%ROWTYPE;
BEGIN
  SELECT * INTO cfg FROM public._internal_airtable_rpm_config WHERE id = 1;
  IF cfg.function_url IS NULL OR cfg.function_url = '' THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := cfg.function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', cfg.auth_header
    ),
    body := jsonb_build_object('type', 'CATCHUP', 'table', 'catchup'),
    timeout_milliseconds := 60000
  );
END;
$$;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available: %', SQLERRM;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(j.jobid)
    FROM cron.job j
    WHERE j.jobname = 'airtable-rpm-catchup';
    PERFORM cron.schedule(
      'airtable-rpm-catchup',
      '*/5 * * * *',
      'SELECT public.run_airtable_rpm_catchup()'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'could not schedule airtable-rpm-catchup: %', SQLERRM;
END
$$;

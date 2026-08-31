-- RPM1 Google Form sync: meta columns + INSERT-only trigger (RPM1 gate).
-- Edge Function URL/auth written by scripts/deploy-rpm-google-form-sync.js

CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'net') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA net TO postgres';
    EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA net TO postgres';
  END IF;
END
$$;

ALTER TABLE public.rpm_sales
  ADD COLUMN IF NOT EXISTS google_form_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS google_form_sync_error text;

CREATE TABLE IF NOT EXISTS public._internal_rpm_google_form_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  function_url text NOT NULL,
  auth_header text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public._internal_rpm_google_form_config ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = '_internal_rpm_google_form_config'
      AND policyname = 'deny_all_internal_rpm_google_form_config'
  ) THEN
    CREATE POLICY deny_all_internal_rpm_google_form_config
      ON public._internal_rpm_google_form_config
      FOR ALL TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.notify_rpm_google_form_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg public._internal_rpm_google_form_config%ROWTYPE;
  client_val text;
  payload jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF NEW.google_form_submitted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  client_val := upper(trim(coalesce(NEW.client, NEW.form_data->>'client', '')));
  IF client_val <> 'RPM1' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO cfg FROM public._internal_rpm_google_form_config WHERE id = 1;
  IF cfg.function_url IS NULL OR cfg.function_url = '' THEN
    RETURN NEW;
  END IF;

  payload := jsonb_build_object(
    'type', 'INSERT',
    'table', 'rpm_sales',
    'record', to_jsonb(NEW)
  );

  PERFORM net.http_post(
    url := cfg.function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', cfg.auth_header
    ),
    body := payload
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Fail-open: never block sale insert
    RAISE WARNING 'notify_rpm_google_form_sync: %', SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rpm_google_form_sync ON public.rpm_sales;
CREATE TRIGGER trg_rpm_google_form_sync
  AFTER INSERT ON public.rpm_sales
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_rpm_google_form_sync();

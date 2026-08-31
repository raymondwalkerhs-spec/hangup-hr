-- Supabase → Airtable RPM sync.
-- pg_net POSTs row changes to the airtable-rpm-sync Edge Function.
-- Config URL + auth header are written by scripts/deploy-airtable-rpm-sync.js
-- (not stored in git).

CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'net') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA net TO postgres';
    EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA net TO postgres';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public._internal_airtable_rpm_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  function_url text NOT NULL,
  auth_header text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public._internal_airtable_rpm_config ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = '_internal_airtable_rpm_config'
      AND policyname = 'deny_all_internal_airtable_rpm_config'
  ) THEN
    CREATE POLICY deny_all_internal_airtable_rpm_config
      ON public._internal_airtable_rpm_config
      FOR ALL TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.notify_airtable_rpm_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg public._internal_airtable_rpm_config%ROWTYPE;
  payload jsonb;
  rec jsonb;
  old_rec jsonb;
BEGIN
  SELECT * INTO cfg FROM public._internal_airtable_rpm_config WHERE id = 1;
  IF cfg.function_url IS NULL OR cfg.function_url = '' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    rec := to_jsonb(OLD);
    old_rec := to_jsonb(OLD);
  ELSE
    rec := to_jsonb(NEW);
    old_rec := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['airtable_record_id','airtable_synced_at','airtable_sync_error'])
       = (to_jsonb(OLD) - ARRAY['airtable_record_id','airtable_synced_at','airtable_sync_error'])
    THEN
      RETURN NEW;
    END IF;
  END IF;

  payload := jsonb_build_object(
    'type', TG_OP,
    'table', TG_TABLE_NAME,
    'schema', TG_TABLE_SCHEMA,
    'record', rec,
    'old_record', old_rec
  );

  PERFORM net.http_post(
    url := cfg.function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', cfg.auth_header
    ),
    body := payload,
    timeout_milliseconds := 60000
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_airtable_rpm_sales ON public.rpm_sales;
CREATE TRIGGER trg_airtable_rpm_sales
  AFTER INSERT OR UPDATE OR DELETE ON public.rpm_sales
  FOR EACH ROW
  EXECUTE PROCEDURE public.notify_airtable_rpm_sync();

DROP TRIGGER IF EXISTS trg_airtable_rpm_checks ON public.rpm_checks;
CREATE TRIGGER trg_airtable_rpm_checks
  AFTER INSERT OR UPDATE OR DELETE ON public.rpm_checks
  FOR EACH ROW
  EXECUTE PROCEDURE public.notify_airtable_rpm_sync();

DROP TRIGGER IF EXISTS trg_airtable_rpm_sale_attachments ON public.rpm_sales_attachments;
CREATE TRIGGER trg_airtable_rpm_sale_attachments
  AFTER INSERT OR UPDATE OR DELETE ON public.rpm_sales_attachments
  FOR EACH ROW
  EXECUTE PROCEDURE public.notify_airtable_rpm_sync();

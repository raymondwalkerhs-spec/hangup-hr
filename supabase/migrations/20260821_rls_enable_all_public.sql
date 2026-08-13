-- Security Advisor: "RLS Disabled in Public"
-- Safe for Hangup Portal: Express uses SUPABASE_SECRET_KEY (service_role), which bypasses RLS.
-- No app update required — apply this on Supabase only.
-- Idempotent: safe to re-run when new tables are added.

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    RAISE NOTICE 'Enabled RLS on public.%', t;
  END LOOP;

  -- Ensure deny-all for anon + authenticated on every public table (including ones that already had RLS).
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS deny_anon ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY deny_anon ON public.%I FOR ALL TO anon USING (false) WITH CHECK (false)',
      t
    );
    EXECUTE format('DROP POLICY IF EXISTS deny_authenticated ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY deny_authenticated ON public.%I FOR ALL TO authenticated USING (false) WITH CHECK (false)',
      t
    );
  END LOOP;
END $$;

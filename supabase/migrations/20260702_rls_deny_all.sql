-- AUTH-04: Block direct Supabase client access; Express service role bypasses RLS.

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
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

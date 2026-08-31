-- Add RPM Airtable source tables to supabase_realtime so Portal live-sync
-- receives every INSERT/UPDATE/DELETE (idempotent).
do $$
declare
  t text;
  arr text[] := array['rpm_sales', 'rpm_checks', 'rpm_sales_attachments'];
begin
  foreach t in array arr
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

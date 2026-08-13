-- Live cross-user sync (Supabase Realtime).
-- The live-sync module subscribes to postgres_changes on these tables.
-- Realtime only delivers events for tables added to the publication, so this
-- migration adds them. Idempotent: skips a table already in the publication.
--
-- No attendance status schema change is required: attendance_events.status is
-- free-text (no CHECK constraint), so the new "Not Approved Half Day" and
-- "Not Approved Quarter Day" statuses are accepted as-is.

do $$
declare
  t text;
  arr text[] := array['attendance_events', 'bonus_events', 'deduction_events', 'payroll_adjustments', 'employees'];
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

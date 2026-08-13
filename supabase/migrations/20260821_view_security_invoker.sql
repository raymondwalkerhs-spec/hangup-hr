-- Security Advisor: "Security Definer View"
-- Views default to SECURITY DEFINER (run as view owner), which can bypass RLS on base tables.
-- Hangup Portal uses service_role (bypasses RLS anyway); switching to SECURITY INVOKER is safe
-- and clears the advisor finding. No app update required.
-- Idempotent.

DO $$
DECLARE
  v text;
BEGIN
  FOR v IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'v'
  LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v);
  END LOOP;
END $$;

COMMENT ON VIEW public.vw_employee_month_attendance IS
  'Hybrid attendance month view (SECURITY INVOKER). Depart auto-OUT + weekend handling for payroll.';

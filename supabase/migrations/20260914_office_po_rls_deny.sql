-- Deny-all RLS policies for Office PO (service role bypasses RLS).
-- Idempotent: drop + recreate.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'office_po_items') THEN
    DROP POLICY IF EXISTS deny_all_office_po_items ON public.office_po_items;
    CREATE POLICY deny_all_office_po_items ON public.office_po_items
      FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'office_po_month_meta') THEN
    DROP POLICY IF EXISTS deny_all_office_po_month_meta ON public.office_po_month_meta;
    CREATE POLICY deny_all_office_po_month_meta ON public.office_po_month_meta
      FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'office_po_month_lines') THEN
    DROP POLICY IF EXISTS deny_all_office_po_month_lines ON public.office_po_month_lines;
    CREATE POLICY deny_all_office_po_month_lines ON public.office_po_month_lines
      FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'office_po_purchases') THEN
    DROP POLICY IF EXISTS deny_all_office_po_purchases ON public.office_po_purchases;
    CREATE POLICY deny_all_office_po_purchases ON public.office_po_purchases
      FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
  END IF;
END $$;

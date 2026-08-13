-- Isolate MLA vs RPM sales client catalogs (RPM1/RPM2 are RPM-only products).

UPDATE sales_clients
SET sale_program = 'rpm', updated_at = now()
WHERE lower(trim(name)) IN ('rpm1', 'rpm2');

-- Default unknown clients to MLA (historical Med Guard / Freedom etc.)
UPDATE sales_clients
SET sale_program = 'mla', updated_at = now()
WHERE sale_program IS NULL OR trim(sale_program) = '';

-- Ensure RPM-named clients never stay on MLA
UPDATE sales_clients
SET sale_program = 'rpm', updated_at = now()
WHERE lower(trim(name)) LIKE 'rpm%'
  AND sale_program <> 'rpm';

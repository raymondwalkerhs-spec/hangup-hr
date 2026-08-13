-- Sale submit agent-picker override (fix dialer list via SQL, no app release).
-- NULL  = infer from employees.id / unit / team / position + org_teams.tl_employee_id
-- true  = force include in sale agent picker
-- false = force exclude (e.g. HS* team lead who still dials IDs)
--
-- Examples:
--   UPDATE employees SET sales_agent_picker = true  WHERE id = 'HS3-20';
--   UPDATE employees SET sales_agent_picker = false WHERE id = 'HS1-05';
--   UPDATE employees SET sales_agent_picker = NULL  WHERE id = 'HS3-20';

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS sales_agent_picker boolean;

COMMENT ON COLUMN employees.sales_agent_picker IS
  'Sale submit agent picker override. NULL=infer dialing agent from org/id/position. true=include. false=exclude.';

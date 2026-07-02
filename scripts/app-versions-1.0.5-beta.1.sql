-- Mark 1.0.5-beta.1 as current (run in Supabase SQL editor after applying 20260702_sales_bonus_costs.sql)

INSERT INTO app_versions (version, channel, is_current, release_notes, released_at)
VALUES (
  '1.0.5-beta.1',
  'beta',
  true,
  'Sales management, bonus approval workflow, costs/petty cash, persistent notifications',
  now()
)
ON CONFLICT (version) DO UPDATE SET
  is_current = EXCLUDED.is_current,
  release_notes = EXCLUDED.release_notes,
  released_at = EXCLUDED.released_at;

UPDATE app_versions SET is_current = false WHERE version <> '1.0.5-beta.1';

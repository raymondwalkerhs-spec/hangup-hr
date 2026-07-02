-- Mark 1.0.4-beta.2 as current in app_versions (run in Supabase SQL editor)
UPDATE app_versions SET is_current = false WHERE is_current = true;

INSERT INTO app_versions (version, release_date, release_type, min_compatible_version, is_current, notes)
VALUES (
  '1.0.4-beta.2',
  CURRENT_DATE,
  'minor',
  '1.0.0',
  true,
  'HRMS advanced features: employment lifecycle, action plans, leave, holidays, payroll lock, auth hardening, reports, documents, notifications'
);

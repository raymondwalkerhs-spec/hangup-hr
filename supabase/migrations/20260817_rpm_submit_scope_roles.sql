-- Allow quality / RTM to submit RPM sales (parity with MLA submit-scope).

INSERT INTO rpm_sales_action_permissions (action_key, label, allowed_roles, updated_at)
VALUES (
  'submit_sale',
  'Submit new RPM sale',
  ARRAY['agent', 'tl', 'op', 'admin', 'ceo', 'hr', 'quality', 'rtm']::text[],
  now()
)
ON CONFLICT (action_key) DO UPDATE SET
  allowed_roles = EXCLUDED.allowed_roles,
  updated_at = now();

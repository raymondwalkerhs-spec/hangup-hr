-- v2.2.0: expense_requests.category with user-selectable categories

ALTER TABLE expense_requests
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'other';

UPDATE expense_requests
SET category = 'other'
WHERE category IS NULL OR trim(category) = '';

ALTER TABLE expense_requests
  DROP CONSTRAINT IF EXISTS expense_requests_category_check;

ALTER TABLE expense_requests
  ADD CONSTRAINT expense_requests_category_check
  CHECK (category IN (
    'office',
    'travel',
    'meals',
    'utilities',
    'equipment',
    'marketing',
    'rent',
    'supplies',
    'other'
  ));

CREATE INDEX IF NOT EXISTS idx_expense_requests_category ON expense_requests(category);

-- Add company column to sales_clients for HS2/Main Hangup client separation
ALTER TABLE sales_clients ADD COLUMN IF NOT EXISTS company TEXT DEFAULT 'hangup';

-- Add company column to registration_daily_pins for separate HS2/Main PINs
ALTER TABLE registration_daily_pins ADD COLUMN IF NOT EXISTS company TEXT DEFAULT 'hangup';

-- Add company column to agent_registration_requests
ALTER TABLE agent_registration_requests ADD COLUMN IF NOT EXISTS company TEXT DEFAULT 'hangup';

-- Drop old unique constraint on registration_daily_pins (pin_date only)
-- and create new one on (pin_date, company)
DO $$
BEGIN
  -- Try to drop the old constraint if it exists
  BEGIN
    ALTER TABLE registration_daily_pins DROP CONSTRAINT IF EXISTS registration_daily_pins_pin_date_key;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  BEGIN
    ALTER TABLE registration_daily_pins DROP CONSTRAINT IF EXISTS registration_daily_pins_pkey;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;

-- Create unique index on (pin_date, company) for registration PINs
CREATE UNIQUE INDEX IF NOT EXISTS idx_reg_pins_date_company ON registration_daily_pins (pin_date, company);

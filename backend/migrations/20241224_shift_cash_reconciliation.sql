-- Add cash reconciliation fields to shifts table
DO $$ 
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'shifts') THEN
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS expected_cash DECIMAL(10, 2);
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS actual_cash DECIMAL(10, 2);
  END IF;
END $$;

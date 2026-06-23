-- Add shift-level cash reconciliation fields
ALTER TABLE shifts
ADD COLUMN IF NOT EXISTS expected_cash DECIMAL(10, 2),
ADD COLUMN IF NOT EXISTS actual_cash DECIMAL(10, 2);

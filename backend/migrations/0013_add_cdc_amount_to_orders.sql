-- Add cdc_amount column to orders for recording CDC voucher redemptions (idempotent)
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS cdc_amount NUMERIC(10, 2) NOT NULL DEFAULT 0;

-- Ensure default is set for existing rows (defensive)
UPDATE orders SET cdc_amount = 0 WHERE cdc_amount IS NULL;
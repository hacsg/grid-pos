-- Add optional split-payment amount columns to orders (idempotent)
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS cash_amount DECIMAL(10, 2),
ADD COLUMN IF NOT EXISTS card_amount DECIMAL(10, 2),
ADD COLUMN IF NOT EXISTS voucher_amount DECIMAL(10, 2);

-- Add cash reconciliation fields to orders table
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS cash_tendered DECIMAL(10, 2),
ADD COLUMN IF NOT EXISTS cash_change DECIMAL(10, 2);

-- Add index for faster shift reconciliation queries
CREATE INDEX IF NOT EXISTS idx_orders_payment_method_shift 
ON orders(shift_id, payment_method) 
WHERE payment_method = 'cash';

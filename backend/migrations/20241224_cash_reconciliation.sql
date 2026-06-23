-- Add cash reconciliation fields to orders table
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS cash_tendered DECIMAL(10, 2),
ADD COLUMN IF NOT EXISTS cash_change DECIMAL(10, 2);

-- Add index for faster cash reconciliation queries
CREATE INDEX IF NOT EXISTS idx_orders_cash_reconciliation 
ON orders(staff_id, outlet_id, payment_method, created_at) 
WHERE payment_method = 'cash' AND status = 'paid';

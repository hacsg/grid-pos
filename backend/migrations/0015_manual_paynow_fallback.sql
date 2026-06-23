-- Manual PayNow fallback configuration and confirmation timestamp (idempotent)
ALTER TABLE outlets
ADD COLUMN IF NOT EXISTS paynow_qr_url TEXT;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS paynow_confirmed_at TIMESTAMP WITH TIME ZONE;

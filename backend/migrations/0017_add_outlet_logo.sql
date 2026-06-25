-- Add a shop logo (stored as a base64 data URL) to outlets for the customer
-- display, mirroring paynow_qr_url. Idempotent.
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS logo_url TEXT;

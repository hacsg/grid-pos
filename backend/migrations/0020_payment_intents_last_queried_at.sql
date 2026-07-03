-- Track when a timeout/failed intent was last queried on the terminal.
-- Required before allowing POST /kpay/start retry (prevents double-charge).
ALTER TABLE payment_intents ADD COLUMN last_queried_at TIMESTAMPTZ;
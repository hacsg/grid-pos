-- Add vouchers and order_vouchers tables for CDC and Acre Group voucher redemption (idempotent)

-- Create voucher type enum if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'voucher_type') THEN
        CREATE TYPE voucher_type AS ENUM ('cdc', 'acre_group');
    END IF;
END $$;

-- Create vouchers table
CREATE TABLE IF NOT EXISTS vouchers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    type voucher_type NOT NULL,
    amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
    redeemed_at TIMESTAMPTZ NULL,
    redeemed_by_staff_id UUID NULL REFERENCES staff(id) ON DELETE SET NULL,
    outlet_id UUID NULL REFERENCES outlets(id) ON DELETE SET NULL,
    order_id UUID NULL REFERENCES orders(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_vouchers_code ON vouchers (code);
CREATE INDEX IF NOT EXISTS ix_vouchers_type ON vouchers (type);
CREATE INDEX IF NOT EXISTS ix_vouchers_redeemed_at ON vouchers (redeemed_at);
CREATE INDEX IF NOT EXISTS ix_vouchers_outlet_id ON vouchers (outlet_id);
CREATE INDEX IF NOT EXISTS ix_vouchers_order_id ON vouchers (order_id);

-- Create order_vouchers junction table for stacking
CREATE TABLE IF NOT EXISTS order_vouchers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    voucher_id UUID NOT NULL REFERENCES vouchers(id) ON DELETE RESTRICT,
    amount_applied NUMERIC(10, 2) NOT NULL CHECK (amount_applied >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (order_id, voucher_id)
);

CREATE INDEX IF NOT EXISTS ix_order_vouchers_order_id ON order_vouchers (order_id);
CREATE INDEX IF NOT EXISTS ix_order_vouchers_voucher_id ON order_vouchers (voucher_id);

-- Seed 10 test CDC vouchers (S$5 each) if they do not already exist
DO $$
DECLARE
    i INTEGER;
    test_code TEXT;
BEGIN
    FOR i IN 1..10 LOOP
        test_code := 'CDC-TEST' || LPAD(i::text, 3, '0');
        IF NOT EXISTS (SELECT 1 FROM vouchers WHERE code = test_code) THEN
            INSERT INTO vouchers (code, type, amount)
            VALUES (test_code, 'cdc', 5.00);
        END IF;
    END LOOP;
END $$;
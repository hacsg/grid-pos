-- Add loyalty columns to orders table (idempotent)

ALTER TABLE orders ADD COLUMN IF NOT EXISTS loyalty_member_id UUID;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS loyalty_points_earned NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS loyalty_points_redeemed NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS loyalty_discount NUMERIC(10, 2) DEFAULT 0;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'loyalty_members'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_orders_loyalty_member_id_loyalty_members'
    ) THEN
        ALTER TABLE orders
            ADD CONSTRAINT fk_orders_loyalty_member_id_loyalty_members
            FOREIGN KEY (loyalty_member_id) REFERENCES loyalty_members(id) ON DELETE SET NULL;
    END IF;
END $$;
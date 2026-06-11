CREATE TABLE IF NOT EXISTS discounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    kind VARCHAR(20) NOT NULL DEFAULT 'percent',
    amount NUMERIC(10, 2) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    outlet_id UUID REFERENCES outlets(id) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discounts_outlet_id ON discounts(outlet_id);
CREATE INDEX IF NOT EXISTS idx_discounts_is_active ON discounts(is_active);

-- Seed default discounts
INSERT INTO discounts (name, kind, amount, is_active, sort_order) VALUES
    ('10% Staff Discount', 'percent', 10.00, true, 0),
    ('15% Staff Discount', 'percent', 15.00, true, 1),
    ('20% Staff Discount', 'percent', 20.00, true, 2),
    ('Birthday Treat', 'percent', 100.00, true, 3),
    ('$2 Off', 'fixed', 2.00, true, 4),
    ('$5 Off', 'fixed', 5.00, true, 5)
ON CONFLICT DO NOTHING;

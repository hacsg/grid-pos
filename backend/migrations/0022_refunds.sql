CREATE TABLE refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id),
    staff_id UUID NOT NULL REFERENCES staff(id),
    amount NUMERIC(10,2) NOT NULL,
    reason TEXT,
    kind VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refunds_order_id ON refunds(order_id);
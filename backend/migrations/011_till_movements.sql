-- Cash movements on a till session: cash in (float top-up), cash out (paid-out
-- / bank drop), and no-sale drawer opens. In/out adjust the expected drawer
-- cash at close; all are manager-authorized and audited.
CREATE TABLE IF NOT EXISTS till_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    till_session_id UUID NOT NULL REFERENCES till_sessions(id) ON DELETE CASCADE,
    direction TEXT NOT NULL,                         -- in | out | nosale
    amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
    reason TEXT,
    staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
    authorized_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_till_movements_session ON till_movements (till_session_id, created_at);

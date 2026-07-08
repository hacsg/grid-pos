-- Cash-drawer till sessions: one per outlet per SGT business day.
-- Opening float is entered at start of day; the drawer is blind-counted at close
-- (staff never see the expected figure), and the variance is reviewed by a
-- manager afterwards.
CREATE TABLE IF NOT EXISTS till_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
    business_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',            -- open | closed
    opening_float NUMERIC(10, 2) NOT NULL DEFAULT 0,
    opened_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    counted_cash NUMERIC(10, 2),                    -- entered at close (blind)
    expected_cash NUMERIC(10, 2),                   -- float + cash kept, computed at close
    variance NUMERIC(10, 2),                        -- counted - expected
    closed_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one OPEN till per outlet at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_till_open_per_outlet
    ON till_sessions (outlet_id) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS ix_till_outlet_date ON till_sessions (outlet_id, business_date DESC);

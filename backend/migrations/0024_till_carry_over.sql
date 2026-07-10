-- Overnight carry-over on till sessions: what the drawer should hold at open
-- (the previous close's counted cash, when no cash-out/in happened overnight)
-- and the variance between that and the float the cashier actually declared.
ALTER TABLE till_sessions ADD COLUMN IF NOT EXISTS expected_opening_float NUMERIC(10, 2);
ALTER TABLE till_sessions ADD COLUMN IF NOT EXISTS opening_variance NUMERIC(10, 2);

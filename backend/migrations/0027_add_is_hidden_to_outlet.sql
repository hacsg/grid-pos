-- Add is_hidden flag to outlets.
--
-- The flag shipped in the "hide outlets / month-end prediction" work as a
-- model-level change only. Production does not run alembic — app/migrations.py
-- applies these .sql files on startup — so the column never existed there and
-- every analytics query that reads Outlet.is_hidden 500'd on the deploy.
--
-- Idempotent so it is a no-op wherever the column already exists.
--
-- Index included because the analytics service filters on is_hidden in three
-- hot paths (list_outlets, month_end_prediction, dashboard breakdown).

ALTER TABLE outlets
    ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_outlets_is_hidden ON outlets (is_hidden);

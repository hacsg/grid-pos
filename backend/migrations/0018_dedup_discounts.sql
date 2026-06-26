-- Remove duplicate discount rows accumulated by the pre-ledger migration runner.
--
-- Until the schema_migrations ledger was introduced, every *.sql file re-ran on
-- each deploy. 0012_discounts.sql's seed INSERT has no unique constraint for its
-- ON CONFLICT to catch, so each boot re-inserted the seed rows, leaving 10-15
-- duplicate copies of each. This collapses exact duplicates to a single row.
--
-- "Duplicate" is defined conservatively as rows identical in their meaningful
-- columns (name, kind, amount, outlet_id). Genuinely distinct discounts -- e.g.
-- an outlet-specific override, or an admin-created discount that merely shares a
-- name -- differ in at least one of these columns and are never merged. We keep
-- the earliest row (by created_at, then id) so any later edits to a clone do not
-- silently win. No UNIQUE constraint is added: the app intentionally permits
-- duplicate discount names, and the ledger alone now prevents the seed re-running.

DELETE FROM discounts
WHERE id IN (
    SELECT id
    FROM (
        SELECT
            id,
            ROW_NUMBER() OVER (
                PARTITION BY name, kind, amount, outlet_id
                ORDER BY created_at ASC, id ASC
            ) AS rn
        FROM discounts
    ) ranked
    WHERE rn > 1
);

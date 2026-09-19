-- Import Tampines pre-cutover Qashier daily sales for early September 2026.
--
-- Tampines stayed on Qashier for the first days of September before its Grid
-- cutover on 2026-09-10. Migration 0028 only carried Tampines through
-- 2026-09-03; these rows fill 2026-09-05..09 so the month-end forecast counts
-- the whole month. (No Qashier report exists for 2026-09-04 — the store sent
-- none that day — so it stays absent rather than being invented as zero.)
--
-- Analytics-only: no orders, payments, stock, or accounting records are created.
-- Idempotent; deterministic UUIDs (uuid5) match the 0028 scheme.

INSERT INTO historical_daily_sales (id, outlet_id, sales_date, net_sales, transaction_count, source, source_ref)
VALUES
('c921740f-f4e7-5f05-8bdf-326192f28b56', 'b29fc9ca-ade6-4869-bb36-0db319092343', '2026-09-05', 1407.20, 88, 'qashier', '9e06d740d734d20ad8a2e8f8158590e8a05eaf1930f8adca60c0108f9c720ee5'),
('7178b2ff-f256-5929-a920-c11bfabae82d', 'b29fc9ca-ade6-4869-bb36-0db319092343', '2026-09-06', 1263.90, 83, 'qashier', '6040088fce223db892f16acd10659813339f9463d76d835c2028bd95df954f59'),
('9e48ec9f-bfd5-54de-bc13-b737fefa1f92', 'b29fc9ca-ade6-4869-bb36-0db319092343', '2026-09-07', 663.90, 48, 'qashier', '4282e670dea164f0968b737235a8614be882aaffde72439e5b95eac1a4485c5e'),
('636b36d5-b2c5-5fa4-b85d-041ef06aa32e', 'b29fc9ca-ade6-4869-bb36-0db319092343', '2026-09-08', 757.20, 64, 'qashier', '94936a2d6371d4a8adcca5bf096940e23fb5ee1eab292f48495a5f6d052fb8e6'),
('48b7b203-b75f-583c-a868-34a12812ba81', 'b29fc9ca-ade6-4869-bb36-0db319092343', '2026-09-09', 764.30, 55, 'qashier', 'c76871e63b4ee10fe559d854f5dbfafb67e65f9dacc7eeb345282ba3bdaf7f50')
ON CONFLICT (outlet_id, sales_date, source) DO NOTHING;

DO $$
DECLARE
    tamp_sept_rows INTEGER;
    tamp_sept_net NUMERIC(10, 2);
    tamp_sept_txns INTEGER;
BEGIN
    SELECT COUNT(*), COALESCE(SUM(net_sales), 0), COALESCE(SUM(transaction_count), 0)
    INTO tamp_sept_rows, tamp_sept_net, tamp_sept_txns
    FROM historical_daily_sales
    WHERE source = 'qashier'
      AND outlet_id = 'b29fc9ca-ade6-4869-bb36-0db319092343'
      AND sales_date BETWEEN '2026-09-05' AND '2026-09-09';

    IF tamp_sept_rows != 5 THEN
        RAISE EXCEPTION 'Integrity check failed: expected 5 Tampines Sep 5-9 rows, got %', tamp_sept_rows;
    END IF;
    IF tamp_sept_net != 4856.50 THEN
        RAISE EXCEPTION 'Integrity check failed: expected net 4856.50, got %', tamp_sept_net;
    END IF;
    IF tamp_sept_txns != 338 THEN
        RAISE EXCEPTION 'Integrity check failed: expected txns 338, got %', tamp_sept_txns;
    END IF;
END $$;

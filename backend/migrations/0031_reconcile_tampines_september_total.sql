-- Reconcile Tampines September pre-cutover Qashier total to the outlet's
-- authoritative figure (S$8,604.30), provided directly by the business owner.
--
-- Migrations 0028/0030 imported eight real per-day Qashier reports for Tampines
-- (Sep 1-3, 5-9) summing to S$7,330.00. No Qashier email existed for 2026-09-04,
-- so that day was absent. The owner's authoritative pre-cutover total is
-- S$8,604.30; the S$1,274.30 difference is the missing 2026-09-04 trading day.
-- This adds that single day so the September pre-cutover total matches exactly,
-- while the post-cutover Grid orders continue to add on top.
--
-- Analytics-only: no orders, payments, stock, or accounting records are created.
-- transaction_count is estimated from the period's average ticket (~S$13.96);
-- net_sales is the exact owner-provided residual. Idempotent.

INSERT INTO historical_daily_sales (id, outlet_id, sales_date, net_sales, transaction_count, source, source_ref)
VALUES
('2fe41124-d0ea-5c54-8edb-32f6ae0dfa39', 'b29fc9ca-ade6-4869-bb36-0db319092343', '2026-09-04', 1274.30, 91, 'qashier', 'reconciliation-user-absolute-2026-09')
ON CONFLICT (outlet_id, sales_date, source) DO NOTHING;

DO $$
DECLARE
    sept_net NUMERIC(10, 2);
BEGIN
    SELECT COALESCE(SUM(net_sales), 0)
    INTO sept_net
    FROM historical_daily_sales
    WHERE outlet_id = 'b29fc9ca-ade6-4869-bb36-0db319092343'
      AND source = 'qashier'
      AND sales_date BETWEEN '2026-09-01' AND '2026-09-09';

    IF sept_net != 8604.30 THEN
        RAISE EXCEPTION 'Integrity check failed: expected Tampines Sept pre-cutover total 8604.30, got %', sept_net;
    END IF;
END $$;

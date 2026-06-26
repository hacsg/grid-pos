-- Database-level idempotency for payment endpoints + a domain guard against
-- double-charging an order. (idempotent)
--
-- idempotency_keys stores the response of the first request carrying a given
-- (scope, Idempotency-Key); duplicates replay it instead of repeating the side
-- effect. Concurrent duplicates collide on the primary key, so exactly one wins.

CREATE TABLE IF NOT EXISTS idempotency_keys (
    scope           VARCHAR(80) NOT NULL,
    idem_key        VARCHAR(200) NOT NULL,
    request_hash    VARCHAR(64) NOT NULL,
    state           VARCHAR(20) NOT NULL DEFAULT 'in_progress',
    response_status INTEGER,
    response_body   JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, idem_key)
);

-- At most one active card payment intent per order. failed / timeout / cancelled
-- intents fall outside the index, so a genuine retry can still start a fresh
-- sale. This makes the double-charge guard atomic at the database level instead
-- of relying on a read-then-write check that two concurrent requests could both
-- pass.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_intents_active_per_order
    ON payment_intents (order_id)
    WHERE status IN ('pending', 'processing', 'success');

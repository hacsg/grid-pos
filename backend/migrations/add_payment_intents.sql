-- Migration: add_payment_intents table for KPay payment terminal integration
-- Created: 2026-06-20
-- Purpose: Track payment transactions for KPayPOS terminals via Go daemon

CREATE TABLE IF NOT EXISTS payment_intents (
    id VARCHAR(36) PRIMARY KEY,
    outlet_id VARCHAR(36) NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
    order_id VARCHAR(36) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    out_trade_no VARCHAR(64) UNIQUE NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    kpay_response JSONB,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_payment_intents_outlet_id ON payment_intents(outlet_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_order_id ON payment_intents(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_status ON payment_intents(status);
CREATE INDEX IF NOT EXISTS idx_payment_intents_out_trade_no ON payment_intents(out_trade_no);

-- Add is_gift_card flag to products for physical gift card SKUs.
--
-- The flag shipped in the "redeem and activate physical gift cards at the till"
-- work as an alembic revision (0009_product_is_gift_card). Production does not
-- run alembic — app/migrations.py applies these .sql files on startup — so the
-- column never existed there and every Product query 500'd on the deploy.
-- Idempotent so it is a no-op wherever the column already exists.

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS is_gift_card BOOLEAN NOT NULL DEFAULT false;

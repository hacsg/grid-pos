-- Product-targeted discount rules.
--
-- Extends discounts so a rule can be scoped to specific categories and/or
-- products, gated by a minimum quantity of qualifying items. Existing rows
-- default to scope='cart' (whole-cart behaviour, unchanged).
--
--   scope           'cart' (whole cart, current) or 'targeted' (only qualifying lines)
--   min_quantity    threshold N of qualifying units before the rule applies
--   threshold_mode  'gate'   -> N+ qualifying units => ALL qualifying units discounted
--                   'bundle' -> every complete group of N is discounted, remainder full price
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS scope VARCHAR(20) NOT NULL DEFAULT 'cart';
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS min_quantity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS threshold_mode VARCHAR(20) NOT NULL DEFAULT 'gate';

-- Link tables: a targeted rule points at any mix of categories and products.
CREATE TABLE IF NOT EXISTS discount_categories (
    discount_id UUID NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (discount_id, category_id)
);

CREATE TABLE IF NOT EXISTS discount_products (
    discount_id UUID NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    PRIMARY KEY (discount_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_discount_categories_category ON discount_categories(category_id);
CREATE INDEX IF NOT EXISTS idx_discount_products_product ON discount_products(product_id);

-- Snapshot of the discounts actually applied to an order (name, scope, amount off),
-- so receipts and reporting keep the breakdown even after rules change.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS applied_discounts JSONB;

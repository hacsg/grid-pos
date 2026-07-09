-- Open-price line items for ad-hoc upcharges (add ice, premium flavour, etc.).
-- A product flagged is_open_price takes the amount from the order line instead
-- of its own price. Seed a global "Extras" category + "Quick Charge" product.
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_open_price BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO categories (id, name, sort_order, outlet_id)
SELECT gen_random_uuid(), 'Extras', 900, NULL
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Extras' AND outlet_id IS NULL);

INSERT INTO products (id, name, price, category_id, is_available, is_open_price)
SELECT gen_random_uuid(), 'Quick Charge', 0, c.id, TRUE, TRUE
FROM categories c
WHERE c.name = 'Extras' AND c.outlet_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM products WHERE is_open_price = TRUE);

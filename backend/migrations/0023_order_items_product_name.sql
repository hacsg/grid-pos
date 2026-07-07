-- Denormalize product name onto order items for stable receipt/chit reprints.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_name TEXT;

UPDATE order_items
SET product_name = products.name
FROM products
WHERE products.id = order_items.product_id
  AND (order_items.product_name IS NULL OR order_items.product_name = '');

ALTER TABLE order_items ALTER COLUMN product_name SET NOT NULL;
# Task 005 — Grid admin: mark a product as a gift card

## Context

Physical gift cards are sold at the till like any other product: staff ring up a
"Gift Card S$50" item, take payment, and the POS then prompts them to scan the physical
card and activate it.

That flow keys off `Product.is_gift_card`. The backend already supports it end to end:

- `products.is_gift_card` column exists (migration `backend/migrations/0026_product_is_gift_card.sql`)
- `backend/app/models/product.py` has the field
- `backend/app/schemas/product.py` exposes it on read, create and update
- `pos-web` reads it and drives the activation step

**The only missing piece is the admin UI.** There is currently no way to set the flag, so
no gift card product can be created and the whole till flow is unreachable.

## Scope — one flag, three places

### 1. `admin/src/types/index.ts`

Add `is_gift_card: boolean` to the `Product` interface, and to `ProductFormData`.

### 2. `admin/src/components/products/ProductForm.tsx`

This form uses react-hook-form + zod. Follow the **existing `available` checkbox** at
roughly lines 197–202 exactly — same markup, same registration style.

- zod schema: `is_gift_card: z.boolean()`
- `defaultValues` and the `reset` effect: `is_gift_card: product?.is_gift_card ?? false`
  (both places — the form initialises in two spots and missing one makes edits silently
  drop the flag)
- Checkbox labelled **"Physical gift card"**
- Helper text under it, because the consequence is not obvious from the label:
  *"Selling this prompts staff to scan and activate a physical card after payment."*

### 3. `admin/src/pages/Products.tsx`

Show a small badge on any product row where `is_gift_card` is true, so it's visible at a
glance which SKUs trigger the activation flow. Match whatever badge/chip styling the page
already uses — do not invent a new one.

## Notes

- **No migration.** The column already exists. Do **not** add anything under
  `backend/alembic/` — alembic is vestigial in this repo and never runs in production;
  only `backend/migrations/*.sql` is applied on startup. This task needs no schema change
  at all.
- Default is `false` everywhere. This must be a no-op for every existing product.
- Do not touch the backend. It is done and tested.

## Verification

1. `npx tsc --noEmit` in `admin/` passes.
2. `npm run build` in `admin/` succeeds.
3. Confirm by reading your diff that a product saved **without** ticking the box still
   sends `is_gift_card: false` rather than omitting it, and that editing an existing gift
   card product and saving preserves the flag. State what you checked.

## Do NOT

- Do not modify anything under `backend/`.
- Do not add npm packages.
- Do not restyle or refactor the product form beyond adding this field.

import type { Discount as ApiDiscount } from '@/api/client';
import type { CartItem, Discount } from '@/types';
import { lineUnitPrice } from '@/utils/cart';

/** A discount actually applied to the current cart (for display, receipt, payload). */
export interface AppliedDiscountLine {
  id?: string;
  name: string;
  scope: 'cart' | 'targeted';
  amountOff: number;
}

export interface CartDiscounts {
  /** Auto-applied product-targeted rules, in the order they were claimed. */
  targeted: AppliedDiscountLine[];
  /** The manually-picked whole-cart discount, if any (applied to un-targeted lines). */
  cart: AppliedDiscountLine | null;
  targetedTotal: number;
  cartTotal: number;
  /** targetedTotal + cartTotal. */
  total: number;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Expand a set of cart lines into a flat list of per-unit prices. */
function unitPrices(items: CartItem[]): number[] {
  const prices: number[] = [];
  for (const item of items) {
    const price = lineUnitPrice(item);
    for (let i = 0; i < item.quantity; i += 1) {
      prices.push(price);
    }
  }
  return prices;
}

/**
 * Resolve which auto-applying targeted rules fire for the cart.
 *
 * Rules are considered in `sort_order`; each cart line is claimed by at most
 * one rule so a unit is never discounted twice. `claimed` collects the lineIds
 * a targeted rule touched, so the whole-cart discount can exclude them.
 */
export function computeTargetedDiscounts(
  items: CartItem[],
  discounts: ApiDiscount[],
  outletId?: string | null,
): { lines: AppliedDiscountLine[]; claimed: Set<string> } {
  const targeted = discounts
    .filter((d) => d.is_active && d.scope === 'targeted')
    .filter((d) => (d.target_category_ids.length > 0 || d.target_product_ids.length > 0))
    .filter((d) => !d.outlet_id || !outletId || d.outlet_id === outletId)
    .sort((a, b) => a.sort_order - b.sort_order);

  const claimed = new Set<string>();
  const lines: AppliedDiscountLine[] = [];

  for (const rule of targeted) {
    const cats = new Set(rule.target_category_ids);
    const prods = new Set(rule.target_product_ids);

    const qualifying = items.filter(
      (it) =>
        !claimed.has(it.lineId) &&
        (prods.has(it.product.id) || cats.has(it.product.category_id)),
    );
    const qty = qualifying.reduce((sum, it) => sum + it.quantity, 0);
    const minQty = Math.max(1, rule.min_quantity || 1);
    if (qty < minQty) {
      continue;
    }

    // How many units get discounted: all of them (gate), or only whole groups of
    // N (bundle), leaving the remainder at full price.
    const discountedUnits =
      rule.threshold_mode === 'bundle' ? Math.floor(qty / minQty) * minQty : qty;
    if (discountedUnits <= 0) {
      continue;
    }

    let amountOff = 0;
    if (rule.kind === 'percent') {
      // Discount the cheapest `discountedUnits` units (matters only in bundle
      // mode, where a remainder stays full price — the customer keeps the
      // pricier ones at full price, standard "cheapest discounted" behaviour).
      const prices = unitPrices(qualifying).sort((a, b) => a - b);
      const discountedValue = prices
        .slice(0, discountedUnits)
        .reduce((sum, p) => sum + p, 0);
      amountOff = discountedValue * (rule.amount / 100);
    } else {
      // Fixed amount is taken once per satisfied bundle (once in gate mode),
      // capped at the qualifying value so the cart never goes negative.
      const bundles =
        rule.threshold_mode === 'bundle' ? Math.floor(qty / minQty) : 1;
      const qualifyingValue = qualifying.reduce(
        (sum, it) => sum + lineUnitPrice(it) * it.quantity,
        0,
      );
      amountOff = Math.min(rule.amount * bundles, qualifyingValue);
    }

    amountOff = round2(amountOff);
    if (amountOff <= 0) {
      continue;
    }

    lines.push({ id: rule.id, name: rule.name, scope: 'targeted', amountOff });
    qualifying.forEach((it) => claimed.add(it.lineId));
  }

  return { lines, claimed };
}

/**
 * Whole-cart manual discount, applied to the value of lines NOT already claimed
 * by a targeted rule (targeted items are excluded from its base).
 */
export function computeCartDiscount(
  items: CartItem[],
  discount: Discount | null,
  claimed: Set<string>,
): AppliedDiscountLine | null {
  if (!discount) {
    return null;
  }
  const base = items
    .filter((it) => !claimed.has(it.lineId))
    .reduce((sum, it) => sum + lineUnitPrice(it) * it.quantity, 0);
  if (base <= 0) {
    return null;
  }
  const raw =
    discount.kind === 'percent'
      ? base * (discount.amount / 100)
      : Math.min(discount.amount, base);
  const amountOff = round2(raw);
  if (amountOff <= 0) {
    return null;
  }
  return { id: discount.id, name: discount.label, scope: 'cart', amountOff };
}

/** Compute all cart discounts (auto-applied targeted rules + manual cart discount). */
export function computeCartDiscounts(
  items: CartItem[],
  discount: Discount | null,
  discounts: ApiDiscount[],
  outletId?: string | null,
): CartDiscounts {
  const { lines: targeted, claimed } = computeTargetedDiscounts(items, discounts, outletId);
  const cart = computeCartDiscount(items, discount, claimed);
  const targetedTotal = round2(targeted.reduce((sum, l) => sum + l.amountOff, 0));
  const cartTotal = cart?.amountOff ?? 0;
  return {
    targeted,
    cart,
    targetedTotal,
    cartTotal,
    total: round2(targetedTotal + cartTotal),
  };
}

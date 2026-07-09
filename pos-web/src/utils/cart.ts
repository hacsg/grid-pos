import { money } from '@/api/client';
import type { CartItem } from '@/types';

/** Per-unit price of a cart line: the custom amount for an open-price line,
 * otherwise product price + modifier adjustments. */
export function lineUnitPrice(item: CartItem): number {
  if (item.customPrice != null) {
    return item.customPrice;
  }
  const mods = item.modifiers.reduce((sum, m) => sum + m.price_adjustment, 0);
  return money(item.product.price) + mods;
}

export function lineTotal(item: CartItem): number {
  return lineUnitPrice(item) * item.quantity;
}

/** Display name for a cart line — the custom label for an ad-hoc charge. */
export function lineLabel(item: CartItem): string {
  return item.customLabel ?? item.product.name;
}

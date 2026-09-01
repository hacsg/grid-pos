import type { CartItem } from '@/types';
import { money } from '@/api/client';

export function calculateRequiredGiftCards(items: CartItem[]) {
  return items
    .filter((i) => i.product.is_gift_card)
    .flatMap((item) =>
      Array.from({ length: item.quantity }, () => ({
        price: money(item.customPrice ?? item.product.price),
      }))
    );
}

/**
 * How the Scanner should offer redemption for a scanned voucher.
 *
 * A gift card carries cash value and is single-use with no change given, so
 * redeeming one from the Scanner — where there is no order to apply it against
 * — spends the whole card and forfeits any unspent balance. Outlets not yet
 * running Grid still need to redeem them exactly this way (same as a CDC
 * coupon), so it is allowed, but behind a confirmation rather than one tap.
 */
export function getScannerVoucherAffordance(
  isGiftCard: boolean | undefined
): 'confirm_then_redeem' | 'redeem_on_scan' {
  // The Scanner is a dedicated redemption screen: scanning an ordinary
  // single-use voucher should consume it. Cash-value gift cards remain behind
  // confirmation because a scanner redemption forfeits any unused balance.
  return isGiftCard ? 'confirm_then_redeem' : 'redeem_on_scan';
}

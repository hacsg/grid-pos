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

export function getScannerVoucherAffordance(isGiftCard: boolean | undefined): 'instruction' | 'redeem_button' {
  if (isGiftCard) {
    return 'instruction';
  }
  return 'redeem_button';
}

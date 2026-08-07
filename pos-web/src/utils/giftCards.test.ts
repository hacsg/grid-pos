import { describe, it, expect } from 'vitest';
import { calculateRequiredGiftCards, getScannerVoucherAffordance } from './giftCards';
import type { CartItem } from '@/types';

describe('giftCards pure logic', () => {
  it('required-card-count = sum of quantities across gift card lines (quantity-3-on-one-line case)', () => {
    const items: CartItem[] = [
      {
        lineId: '1',
        product: {
          id: 'p1',
          name: 'Normal Item',
          price: 10,
          category_id: 'c1',
          is_available: true,
          modifier_groups: [],
          is_gift_card: false,
          image_url: null,
        },
        quantity: 2,
        modifiers: [],
      },
      {
        lineId: '2',
        product: {
          id: 'p2',
          name: 'Gift Card S$50',
          price: 50,
          category_id: 'c1',
          is_available: true,
          modifier_groups: [],
          is_gift_card: true,
          image_url: null,
        },
        quantity: 3,
        modifiers: [],
      },
      {
        lineId: '3',
        product: {
          id: 'p3',
          name: 'Gift Card S$10',
          price: 10,
          category_id: 'c1',
          is_available: true,
          modifier_groups: [],
          is_gift_card: true,
          image_url: null,
        },
        quantity: 1,
        modifiers: [],
      }
    ];

    const required = calculateRequiredGiftCards(items);
    
    // sum of quantities across gift card lines: 3 + 1 = 4
    expect(required).toHaveLength(4);
    
    // verify the prices match the quantity expansion
    expect(required.map(r => r.price)).toEqual([50, 50, 50, 10]);
  });

  it('a gift card is redeemable from the Scanner, but only behind a confirmation', () => {
    // Outlets not yet running Grid redeem gift cards here like a CDC coupon,
    // so this must not be blocked — but it spends the whole card with no
    // change, so it must never be a single reflex tap either.
    expect(getScannerVoucherAffordance(true)).toBe('confirm_then_redeem');
    expect(getScannerVoucherAffordance(false)).toBe('redeem_button');
    expect(getScannerVoucherAffordance(undefined)).toBe('redeem_button');
  });
});

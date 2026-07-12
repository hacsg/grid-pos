import { describe, expect, it } from 'vitest';
import type { Discount as ApiDiscount } from '@/api/client';
import type { CartItem, Discount } from '@/types';
import { computeCartDiscounts, computeTargetedDiscounts } from './discounts';

const CAT_PINTS = 'cat-pints';
const CAT_OTHER = 'cat-other';

function line(id: string, categoryId: string, price: number, quantity: number): CartItem {
  return {
    lineId: id,
    quantity,
    modifiers: [],
    product: {
      id: `prod-${id}`,
      name: id,
      price,
      category_id: categoryId,
      image_url: null,
      is_available: true,
      modifier_groups: [],
    } as unknown as CartItem['product'],
  };
}

function rule(overrides: Partial<ApiDiscount>): ApiDiscount {
  return {
    id: 'rule-1',
    name: 'Pints promo',
    kind: 'percent',
    amount: 10,
    is_active: true,
    sort_order: 0,
    outlet_id: null,
    scope: 'targeted',
    min_quantity: 3,
    threshold_mode: 'gate',
    target_category_ids: [CAT_PINTS],
    target_product_ids: [],
    ...overrides,
  };
}

describe('computeTargetedDiscounts', () => {
  it('does not fire below the minimum quantity', () => {
    const items = [line('a', CAT_PINTS, 10, 2)];
    const { lines } = computeTargetedDiscounts(items, [rule({})]);
    expect(lines).toHaveLength(0);
  });

  it('gate mode discounts all qualifying units once the threshold is met', () => {
    const items = [line('a', CAT_PINTS, 10, 4)];
    const { lines } = computeTargetedDiscounts(items, [rule({})]);
    // 4 pints * $10 * 10% = $4.00
    expect(lines).toHaveLength(1);
    expect(lines[0].amountOff).toBe(4);
  });

  it('bundle mode only discounts whole groups of N', () => {
    const items = [line('a', CAT_PINTS, 10, 4)];
    const { lines } = computeTargetedDiscounts(items, [rule({ threshold_mode: 'bundle' })]);
    // 4 pints -> 1 bundle of 3 discounted, cheapest 3 units * $10 * 10% = $3.00
    expect(lines[0].amountOff).toBe(3);
  });

  it('ignores non-qualifying categories', () => {
    const items = [line('a', CAT_OTHER, 10, 5)];
    const { lines } = computeTargetedDiscounts(items, [rule({})]);
    expect(lines).toHaveLength(0);
  });

  it('respects outlet scoping', () => {
    const items = [line('a', CAT_PINTS, 10, 3)];
    const { lines } = computeTargetedDiscounts(items, [rule({ outlet_id: 'outlet-x' })], 'outlet-y');
    expect(lines).toHaveLength(0);
  });

  it('fixed amount is taken once per satisfied bundle', () => {
    const items = [line('a', CAT_PINTS, 10, 6)];
    const { lines } = computeTargetedDiscounts(items, [
      rule({ kind: 'fixed', amount: 2, threshold_mode: 'bundle' }),
    ]);
    // 6 / 3 = 2 bundles * $2 = $4
    expect(lines[0].amountOff).toBe(4);
  });
});

describe('computeCartDiscounts', () => {
  it('excludes targeted lines from the whole-cart discount base', () => {
    const items = [line('pints', CAT_PINTS, 10, 4), line('cone', CAT_OTHER, 20, 1)];
    const cartDiscount: Discount = { label: '10% off', amount: 10, kind: 'percent' };
    const result = computeCartDiscounts(items, cartDiscount, [rule({})]);

    // Targeted: 4 pints discounted 10% = $4.00
    expect(result.targetedTotal).toBe(4);
    // Cart discount base excludes the claimed pints line: only the $20 cone -> $2.00
    expect(result.cartTotal).toBe(2);
    expect(result.total).toBe(6);
  });

  it('applies the cart discount to the full cart when no targeted rule fires', () => {
    const items = [line('cone', CAT_OTHER, 20, 1)];
    const cartDiscount: Discount = { label: '10% off', amount: 10, kind: 'percent' };
    const result = computeCartDiscounts(items, cartDiscount, []);
    expect(result.targetedTotal).toBe(0);
    expect(result.cartTotal).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';
import { buildChit, buildReceiptText, type PrintableOrder } from './receipt';

const FIXED_ORDER: PrintableOrder = {
  orderNumber: '0042',
  createdAt: '2026-07-07T02:30:00.000Z',
  usePrintTime: false,
  items: [
    {
      quantity: 2,
      name: 'Coconut Pandan Waffle',
      modifiers: ['Extra crispy'],
      unitPrice: 9.99,
    },
    {
      quantity: 1,
      name: 'Iced Latte',
      modifiers: [],
      unitPrice: 5.5,
    },
  ],
  totals: {
    total: 25.48,
    discount: 2.0,
    voucherDiscount: 3.0,
  },
  payment: {
    method: 'split',
    cashAmount: 10.0,
    cardAmount: 9.48,
    voucherAmount: 3.0,
    cdcAmount: 0,
    changeDue: 1.5,
    manualPayNow: false,
    terminalPaymentMethod: 'card',
  },
  outlet: {
    name: 'Grid Test Outlet',
    brandName: 'Grid Waffles',
    companyDetails: 'Grid Pte Ltd\nUEN 202600001A',
  },
  vouchers: [
    { code: 'ACRE-10', type: 'acre_group', amount: 3.0 },
  ],
};

describe('buildReceiptText', () => {
  it('produces deterministic output for a fixed PrintableOrder', () => {
    const text = buildReceiptText(FIXED_ORDER);
    expect(text).toContain('GRID WAFFLES');
    expect(text).toContain('Grid Pte Ltd');
    expect(text).toContain('Order 0042');
    expect(text).toContain('2 x Coconut Pandan Waffle');
    expect(text).toContain('  Extra crispy');
    expect(text).toContain('1 x Iced Latte');
    expect(text).toContain('Discount');
    expect(text).toContain('Vouchers');
    expect(text).toContain('TOTAL');
    expect(text).toContain('Payment: Split');
    expect(text).toContain('  Cash:');
    expect(text).toContain('  Card:');
    expect(text).toContain('Change');
    expect(text).toContain('Thank you');
    expect(text).toMatchSnapshot();
  });
});

describe('buildChit', () => {
  it('produces deterministic prep-only chit for a fixed PrintableOrder', () => {
    const chit = buildChit(FIXED_ORDER);
    expect(chit).toEqual({
      orderNumber: '0042',
      time: '10:30',
      items: [
        {
          quantity: 2,
          name: 'Coconut Pandan Waffle',
          modifiers: ['Extra crispy'],
        },
        {
          quantity: 1,
          name: 'Iced Latte',
          modifiers: [],
        },
      ],
    });
  });
});
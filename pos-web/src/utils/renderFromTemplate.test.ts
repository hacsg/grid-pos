import { describe, expect, it } from 'vitest';
import { renderKitchenChitFromTemplate, renderReceiptFromTemplate } from '@/utils/renderFromTemplate';
import { buildChit, buildReceiptText, type PrintableOrder } from '@/utils/receipt';

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
  vouchers: [{ code: 'ACRE-10', type: 'acre_group', amount: 3.0 }],
};

const DEFAULT_RECEIPT = {
  documentType: 'receipt',
  pageSize: { widthMM: 58, charWidth: 32 },
  blocks: [
    { type: 'header', visible: true, fields: { showBrandName: true, showCompanyDetails: true, showOutletName: true } },
    { type: 'orderMeta', visible: true, fields: { showOrderNumber: true, showDate: true } },
    { type: 'itemsTable', visible: true, fields: { columns: ['qty', 'name', 'price'], showModifiers: true } },
    { type: 'totals', visible: true, fields: { showDiscounts: true, showVouchers: true, showGrandTotal: true } },
    { type: 'payment', visible: true, fields: { showMethod: true, showChange: true } },
    { type: 'footer', visible: true, fields: { line1: 'Thank you' } },
    { type: 'feedCut', visible: true, fields: { lines: 0 } },
  ],
};

const DEFAULT_CHIT = {
  documentType: 'kitchen_chit',
  pageSize: { widthMM: 58, charWidth: 32 },
  blocks: [
    { type: 'kitchenHeader', visible: true, fields: { title: 'KITCHEN', showOrderNumber: true, showTime: true } },
    { type: 'kitchenItems', visible: true, fields: { showModifiers: true } },
    { type: 'feedCut', visible: true, fields: { lines: 0 } },
  ],
};

describe('renderReceiptFromTemplate', () => {
  it('matches the legacy renderer for the default receipt template', () => {
    expect(renderReceiptFromTemplate(DEFAULT_RECEIPT, FIXED_ORDER)).toBe(buildReceiptText(FIXED_ORDER));
  });

  it('applies custom columns, visibility, text, and feed spacing', () => {
    const text = renderReceiptFromTemplate({
      documentType: 'receipt',
      pageSize: { widthMM: 80, charWidth: 48 },
      blocks: [
        { type: 'itemsTable', visible: true, fields: { columns: ['name'], showModifiers: false } },
        { type: 'totals', visible: true, fields: { showDiscounts: false, showVouchers: false, showGrandTotal: false } },
        { type: 'text', visible: true, fields: { content: 'Collection copy', align: 'center', uppercase: true } },
        { type: 'feedCut', visible: true, fields: { lines: 2 } },
      ],
    }, FIXED_ORDER);

    expect(text).toContain('Coconut Pandan Waffle');
    expect(text).not.toContain('2 x Coconut');
    expect(text).not.toContain('$19.98');
    expect(text).not.toContain('TOTAL');
    expect(text).not.toContain('Vouchers redeemed');
    expect(text).toContain('COLLECTION COPY');
    expect(text.endsWith('\n\n')).toBe(true);
  });
});

describe('renderKitchenChitFromTemplate', () => {
  it('matches the legacy renderer for the default kitchen template', () => {
    expect(renderKitchenChitFromTemplate(DEFAULT_CHIT, FIXED_ORDER)).toEqual(buildChit(FIXED_ORDER));
  });

  it('applies custom heading, section visibility, width, and feed spacing', () => {
    const chit = renderKitchenChitFromTemplate({
      documentType: 'kitchen_chit',
      pageSize: { widthMM: 80, charWidth: 48 },
      blocks: [
        { type: 'kitchenHeader', visible: true, fields: { title: 'BAR', showOrderNumber: false, showTime: false } },
        { type: 'kitchenItems', visible: false, fields: { showModifiers: true } },
        { type: 'feedCut', visible: true, fields: { lines: 2 } },
      ],
    }, FIXED_ORDER);

    expect(chit).toMatchObject({ orderNumber: '', title: 'BAR', time: '', items: [], width: 48, feedLines: 2 });
  });
});

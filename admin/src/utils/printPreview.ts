import type { PrintTemplateConfig } from '@/types';

const RECEIPT_WIDTH = 32;

const money = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const currency = (value: unknown): string => `$${money(value).toFixed(2)}`;

const center = (text: string, width: number) => `${' '.repeat(Math.max(0, Math.floor((width - text.length) / 2)))}${text}`;

const row = (left: string, right = '', width = RECEIPT_WIDTH): string => {
  if (!right) {
    return left;
  }
  const space = width - right.length - 1;
  if (left.length > space) {
    return `${left}\n${right.padStart(width)}`;
  }
  return `${left.padEnd(space)} ${right}`;
};

export const DEFAULT_SAMPLE_ORDER = {
  documentType: 'receipt',
  orderNumber: '0042',
  createdAt: '2026-07-07T02:30:00.000Z',
  usePrintTime: false,
  items: [
    { quantity: 2, name: 'Coconut Pandan Waffle', modifiers: ['Extra crispy'], unitPrice: 9.99, notes: null },
    { quantity: 1, name: 'Iced Latte', modifiers: [], unitPrice: 5.5, notes: null },
  ],
  totals: { total: 25.48, discount: 2, voucherDiscount: 3 },
  discounts: [{ name: 'Discount', amountOff: 2 }],
  payment: {
    method: 'split',
    cashAmount: 10,
    cardAmount: 9.48,
    voucherAmount: 3,
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
  vouchers: [{ code: 'ACRE-10', type: 'acre_group', amount: 3 }],
};

function formatTime(value?: string | null): string {
  const parsed = value ? new Date(value) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return date.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatTimestamp(value?: string | null): string {
  const parsed = value ? new Date(value) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return date.toLocaleString('en-SG');
}

function paymentLines(orderData: typeof DEFAULT_SAMPLE_ORDER): string[] {
  const payment = orderData.payment;
  if (!payment) {
    return [];
  }
  if (payment.method !== 'split') {
    return [`Payment: ${payment.method === 'paynow' ? 'PayNow' : payment.method}`];
  }
  const lines = ['Payment: Split'];
  if (money(payment.cashAmount) > 0) lines.push(`  Cash: ${currency(payment.cashAmount)}`);
  if (money(payment.cardAmount) > 0) lines.push(`  Card: ${currency(payment.cardAmount)}`);
  if (money(payment.voucherAmount) > 0) lines.push(`  Voucher: ${currency(payment.voucherAmount)}`);
  if (money(payment.cdcAmount) > 0) lines.push(`  CDC voucher: ${currency(payment.cdcAmount)}`);
  return lines;
}

export function renderPrintPreview(config: PrintTemplateConfig, orderData = DEFAULT_SAMPLE_ORDER): string {
  const width = config.pageSize?.charWidth || RECEIPT_WIDTH;
  const lines: string[] = [];
  let showVoucherDetails = false;
  config.blocks.forEach((block) => {
    if (!block.visible) {
      return;
    }
    const fields = block.fields || {};
    if (block.type === 'header') {
      const brand = orderData.outlet.brandName?.trim() || orderData.outlet.name;
      if (fields.showBrandName !== false) lines.push(center(brand.toUpperCase(), width));
      if (fields.showCompanyDetails !== false) {
        orderData.outlet.companyDetails.split('\n').filter(Boolean).forEach((line) => lines.push(center(line, width)));
      }
      if (fields.showOutletName !== false) lines.push(center(orderData.outlet.name, width));
      lines.push('-'.repeat(width));
    }
    if (block.type === 'orderMeta') {
      if (fields.showOrderNumber !== false) lines.push(row(`Order ${orderData.orderNumber}`, '', width));
      if (fields.showDate !== false) lines.push(row(formatTimestamp(orderData.createdAt), '', width));
      lines.push('-'.repeat(width));
    }
    if (block.type === 'itemsTable') {
      const columns = Array.isArray(fields.columns) ? fields.columns : ['qty', 'name', 'price'];
      orderData.items.forEach((item) => {
        const left = columns.includes('qty') ? `${item.quantity} x ${item.name}` : item.name;
        const right = columns.includes('price') ? currency(item.unitPrice * item.quantity) : '';
        lines.push(row(left, right, width));
        if (fields.showModifiers !== false) item.modifiers.forEach((modifier) => lines.push(`  ${modifier}`));
        if (fields.showNotes && item.notes) lines.push(`  Note: ${item.notes}`);
      });
      lines.push('-'.repeat(width));
    }
    if (block.type === 'totals') {
      orderData.discounts.forEach((discount) => lines.push(row(discount.name, `-${currency(discount.amountOff)}`, width)));
      if (fields.showVouchers !== false && money(orderData.totals.voucherDiscount) > 0) {
        lines.push(row('Vouchers', `-${currency(orderData.totals.voucherDiscount)}`, width));
      }
      showVoucherDetails = fields.showVouchers !== false;
      if (fields.showGrandTotal !== false) lines.push(row('TOTAL', currency(orderData.totals.total), width));
    }
    if (block.type === 'payment') {
      if (fields.showMethod !== false) lines.push(...paymentLines(orderData));
      if (fields.showChange !== false && money(orderData.payment.changeDue) > 0) {
        lines.push(row('Change', currency(orderData.payment.changeDue), width));
      }
    }
    if (block.type === 'footer') {
      if (fields.line1) lines.push(center(String(fields.line1), width));
      if (fields.line2) lines.push(center(String(fields.line2), width));
    }
    if (block.type === 'text') {
      let content = String(fields.content || '');
      if (fields.uppercase) content = content.toUpperCase();
      content.split('\n').filter(Boolean).forEach((line) => lines.push(fields.align === 'center' ? center(line, width) : line));
    }
    if (block.type === 'kitchenHeader') {
      if (fields.showOrderNumber !== false) lines.push(`#${orderData.orderNumber}`);
      lines.push(String(fields.title || 'KITCHEN'));
      if (fields.showTime !== false) lines.push(formatTime(orderData.createdAt));
      lines.push('-'.repeat(width));
    }
    if (block.type === 'kitchenItems') {
      orderData.items.forEach((item) => {
        lines.push(`${item.quantity} x ${item.name.toUpperCase()}`);
        if (fields.showModifiers !== false) item.modifiers.forEach((modifier) => lines.push(`   - ${modifier}`));
        lines.push('');
      });
      lines.push('-'.repeat(width));
    }
    if (block.type === 'feedCut') {
      const count = Math.max(0, Number(fields.lines || 0));
      for (let index = 0; index < count; index += 1) {
        lines.push('');
      }
    }
  });

  if ((config.documentType || 'receipt') === 'receipt' && showVoucherDetails && orderData.vouchers.length > 0) {
    lines.push('');
    lines.push(row('Vouchers redeemed', currency(orderData.totals.voucherDiscount), width));
    orderData.vouchers.forEach((voucher) => {
      lines.push(row(`  ${voucher.type === 'cdc' ? 'CDC' : 'Acre Group'} ${voucher.code}`, `-${currency(voucher.amount)}`, width));
    });
  }

  return lines.join('\n').trimEnd();
}

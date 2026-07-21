import { api, type PrintablePrintTemplate } from '@/api/client';
import { buildChit, buildReceiptText, type PrintableOrder } from '@/utils/receipt';
import type { KitchenChit } from '@/utils/printer';

const DEFAULT_RECEIPT_CONFIG = {
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

const DEFAULT_CHIT_CONFIG = {
  documentType: 'kitchen_chit',
  pageSize: { widthMM: 58, charWidth: 32 },
  blocks: [
    { type: 'kitchenHeader', visible: true, fields: { title: 'KITCHEN', showOrderNumber: true, showTime: true } },
    { type: 'kitchenItems', visible: true, fields: { showModifiers: true } },
    { type: 'feedCut', visible: true, fields: { lines: 0 } },
  ],
};

const TEMPLATE_CACHE_MS = 60_000;
const templateCache = new Map<string, { value: PrintablePrintTemplate; expiresAt: number }>();

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function row(left: string, right = '', width = 32): string {
  if (!right) {
    return left;
  }
  const space = width - right.length - 1;
  if (left.length > space) {
    return `${left}\n${right.padStart(width)}`;
  }
  return `${left.padEnd(space)} ${right}`;
}

function center(text: string, width = 32): string {
  return `${' '.repeat(Math.max(0, Math.floor((width - text.length) / 2)))}${text}`;
}

function currency(value: number): string {
  return new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency: 'SGD',
  }).format(value);
}

function kitchenTime(order: PrintableOrder): string {
  const parsed = order.createdAt ? new Date(order.createdAt) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return date.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function receiptTime(order: PrintableOrder): string {
  const parsed = order.createdAt ? new Date(order.createdAt) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return date.toLocaleString('en-SG');
}

export async function getCachedActivePrintTemplate(
  outletId: string,
  documentType: 'receipt' | 'kitchen_chit',
): Promise<PrintablePrintTemplate | null> {
  const key = `${outletId}:${documentType}`;
  const cached = templateCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  templateCache.delete(key);
  try {
    const { data } = await api.get<PrintablePrintTemplate>('/print-templates/active', {
      params: { outlet_id: outletId, document_type: documentType },
      silent: true,
    } as any);
    templateCache.set(key, { value: data, expiresAt: Date.now() + TEMPLATE_CACHE_MS });
    return data;
  } catch {
    return null;
  }
}

export function renderReceiptFromTemplate(config: Record<string, unknown> | null | undefined, order: PrintableOrder): string {
  if (!config || sameJson(config, DEFAULT_RECEIPT_CONFIG)) {
    return buildReceiptText(order);
  }

  const width = Number((config as { pageSize?: { charWidth?: number } }).pageSize?.charWidth || 32);
  const blocks = Array.isArray((config as { blocks?: unknown[] }).blocks) ? ((config as { blocks: Array<Record<string, any>> }).blocks) : [];
  const lines: string[] = [];
  let showVoucherDetails = false;

  blocks.forEach((block) => {
    if (!block?.visible) {
      return;
    }
    const fields = block.fields || {};
    if (block.type === 'header') {
      const brand = order.outlet.brandName?.trim() || order.outlet.name;
      if (fields.showBrandName !== false) lines.push(center(brand.toUpperCase(), width));
      if (fields.showCompanyDetails !== false) {
        (order.outlet.companyDetails || '').split('\n').filter(Boolean).forEach((line) => lines.push(center(line.trim(), width)));
      }
      if (fields.showOutletName !== false) lines.push(center(order.outlet.name, width));
      lines.push('-'.repeat(width));
    }
    if (block.type === 'orderMeta') {
      if (fields.showOrderNumber !== false) lines.push(`Order ${order.orderNumber}`);
      if (fields.showDate !== false) lines.push(receiptTime(order));
      lines.push('-'.repeat(width));
    }
    if (block.type === 'itemsTable') {
      const columns = Array.isArray(fields.columns) ? fields.columns : ['qty', 'name', 'price'];
      order.items.forEach((item) => {
        const left = columns.includes('qty') ? `${item.quantity} x ${item.name}` : item.name;
        const right = columns.includes('price') ? currency(item.unitPrice * item.quantity) : '';
        lines.push(row(left, right, width));
        if (fields.showModifiers !== false) item.modifiers.forEach((modifier) => lines.push(`  ${modifier}`));
      });
      lines.push('-'.repeat(width));
    }
    if (block.type === 'totals') {
      if (fields.showDiscounts !== false) {
        if (order.discounts?.length) {
          order.discounts.forEach((discount) => lines.push(row(discount.name, `-${currency(discount.amountOff)}`, width)));
        } else if (order.totals.discount > 0) {
          lines.push(row('Discount', `-${currency(order.totals.discount)}`, width));
        }
      }
      if (fields.showVouchers !== false && order.totals.voucherDiscount > 0) {
        lines.push(row('Vouchers', `-${currency(order.totals.voucherDiscount)}`, width));
      }
      showVoucherDetails = fields.showVouchers !== false;
      if (fields.showGrandTotal !== false) {
        lines.push(row('TOTAL', currency(order.totals.total), width));
      }
    }
    if (block.type === 'payment') {
      if (order.payment) {
        if (fields.showMethod !== false) {
          lines.push(`Payment: ${order.payment.method === 'paynow' ? 'PayNow' : order.payment.method === 'split' ? 'Split' : order.payment.method}`);
          if (order.payment.method === 'split') {
            if (order.payment.cashAmount > 0) lines.push(`  Cash: ${currency(order.payment.cashAmount)}`);
            if (order.payment.cardAmount > 0) lines.push(`  Card: ${currency(order.payment.cardAmount)}`);
            if (order.payment.voucherAmount > 0) lines.push(`  Voucher: ${currency(order.payment.voucherAmount)}`);
            if (order.payment.cdcAmount > 0) lines.push(`  CDC voucher: ${currency(order.payment.cdcAmount)}`);
          }
        }
        if (fields.showChange !== false && order.payment.changeDue > 0) {
          lines.push(row('Change', currency(order.payment.changeDue), width));
        }
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
    if (block.type === 'feedCut') {
      const count = Math.max(0, Math.min(10, Number(fields.lines || 0)));
      for (let index = 0; index < count; index += 1) lines.push('');
    }
  });

  if (showVoucherDetails && order.vouchers?.length) {
    lines.push('');
    lines.push(row('Vouchers redeemed', currency(order.totals.voucherDiscount), width));
    order.vouchers.forEach((voucher) => {
      lines.push(row(`  ${voucher.type === 'cdc' ? 'CDC' : 'Acre Group'} ${voucher.code}`, `-${currency(voucher.amount)}`, width));
    });
  }

  return lines.join('\n');
}

export function renderKitchenChitFromTemplate(config: Record<string, unknown> | null | undefined, order: PrintableOrder): KitchenChit {
  if (!config || sameJson(config, DEFAULT_CHIT_CONFIG)) {
    return buildChit(order);
  }

  const blocks = Array.isArray((config as { blocks?: unknown[] }).blocks) ? ((config as { blocks: Array<Record<string, any>> }).blocks) : [];
  const width = Number((config as { pageSize?: { charWidth?: number } }).pageSize?.charWidth || 32);
  let orderNumber = '';
  let title = '';
  let time = '';
  let feedLines = 0;
  let items: KitchenChit['items'] = [];

  blocks.forEach((block) => {
    if (!block?.visible) {
      return;
    }
    if (block.type === 'kitchenHeader') {
      orderNumber = block.fields?.showOrderNumber === false ? '' : order.orderNumber;
      title = String(block.fields?.title || 'KITCHEN');
      time = block.fields?.showTime === false ? '' : kitchenTime(order);
    }
    if (block.type === 'kitchenItems') {
      items = order.items.map((item) => ({
        quantity: item.quantity,
        name: item.name,
        modifiers: block.fields?.showModifiers === false ? [] : item.modifiers,
      }));
    }
    if (block.type === 'feedCut') {
      feedLines += Math.max(0, Math.min(10, Number(block.fields?.lines || 0)));
    }
  });

  return {
    orderNumber,
    title,
    time,
    items,
    width,
    feedLines,
  };
}

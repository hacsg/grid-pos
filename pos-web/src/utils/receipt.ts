import { formatCurrency, money, type OrderRead } from '@/api/client';
import type { KitchenChit } from '@/utils/printer';
import { MANUAL_PAYNOW_REFERENCE } from '@/utils/paynow';
import type { AppliedVoucher, CartItem, StaffSession, Totals } from '@/types';
import type { AppliedDiscountLine } from '@/utils/discounts';
import { formatSgtDateTime, formatSgtTime } from '@/utils/datetime';

export interface PrintableOrderItem {
  quantity: number;
  name: string;
  modifiers: string[];
  /** Per-unit price including modifiers — used for receipt line totals. */
  unitPrice: number;
}

export interface PrintableVoucher {
  code: string;
  type: 'cdc' | 'acre_group';
  amount: number;
}

export interface PrintableOrderPayment {
  method: string;
  cashAmount: number;
  cardAmount: number;
  voucherAmount: number;
  cdcAmount: number;
  changeDue: number;
  paynowConfirmedAt?: string | null;
  manualPayNow?: boolean;
  terminalPaymentMethod?: 'card' | 'paynow';
}

export interface PrintableOrder {
  orderNumber: string;
  createdAt?: string;
  /** When true, receipt/chit timestamps use the current clock (checkout default). */
  usePrintTime?: boolean;
  items: PrintableOrderItem[];
  totals: { total: number; discount: number; voucherDiscount: number };
  /** Itemised discount lines (targeted rules, cart discount, loyalty). When
   * present these are printed instead of the single collapsed Discount row. */
  discounts?: { name: string; amountOff: number }[];
  payment: PrintableOrderPayment | null;
  outlet: { name: string; brandName?: string | null; companyDetails?: string | null };
  vouchers?: PrintableVoucher[];
}

type PaymentMode = 'cash' | 'card' | 'paynow' | 'split';
type TerminalPaymentMethod = 'card' | 'paynow';

export interface ReceiptSnapshotLike {
  order: Pick<OrderRead, 'order_number'>;
  items: CartItem[];
  totals: Totals;
  appliedDiscounts?: AppliedDiscountLine[];
  vouchers: AppliedVoucher[];
  paymentMode: PaymentMode;
  terminalPaymentMethod?: TerminalPaymentMethod;
  cashAmount: number;
  cardAmount: number;
  voucherAmount: number;
  cdcAmount: number;
  changeDue: number;
  manualPayNow: boolean;
  paynowConfirmedAt?: string | null;
}

// 58mm thermal paper prints 32 columns in the default ESC/POS font.
export const RECEIPT_WIDTH = 32;
export const RECEIPT_DIVIDER = '-'.repeat(RECEIPT_WIDTH);

function paymentModeLabel(mode: string): string {
  if (mode === 'paynow') {
    return 'PayNow';
  }
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function terminalMethodLabel(method: TerminalPaymentMethod): string {
  return method === 'paynow' ? 'PayNow' : 'Card';
}

export function formatReceiptTime(value?: string | null): string {
  return formatSgtTime(value, { hour: 'numeric', minute: '2-digit' });
}

function receiptTimestamp(order: PrintableOrder): string {
  return formatSgtDateTime(order.usePrintTime ? null : order.createdAt);
}

function chitTimestamp(order: PrintableOrder): string {
  return formatSgtTime(order.usePrintTime ? null : order.createdAt);
}

export function receiptCenter(text: string): string {
  const pad = Math.max(0, Math.floor((RECEIPT_WIDTH - text.length) / 2));
  return ' '.repeat(pad) + text;
}

/** Left text with the amount right-aligned; long lines push the amount to its own row. */
export function receiptRow(left: string, right = ''): string {
  if (!right) {
    return left;
  }
  const space = RECEIPT_WIDTH - right.length - 1;
  if (left.length > space) {
    return `${left}\n${right.padStart(RECEIPT_WIDTH)}`;
  }
  return `${left.padEnd(space)} ${right}`;
}

export function receiptPaymentLines(order: PrintableOrder): string[] {
  const payment = order.payment;
  if (!payment) {
    return [];
  }

  if (payment.method !== 'split') {
    if (payment.method === 'paynow' && payment.manualPayNow) {
      return [
        'Payment: PayNow (Manual)',
        `Amount: ${formatCurrency(payment.cardAmount)}`,
        `Confirmed: ${formatReceiptTime(payment.paynowConfirmedAt)}`,
      ];
    }
    return [`Payment: ${paymentModeLabel(payment.method)}`];
  }

  const lines = ['Payment: Split'];
  if (payment.cashAmount > 0) {
    lines.push(`  Cash: ${formatCurrency(payment.cashAmount)}`);
  }
  if (payment.cdcAmount > 0) {
    lines.push(`  CDC voucher: ${formatCurrency(payment.cdcAmount)}`);
  }
  if (payment.cardAmount > 0) {
    const label =
      payment.manualPayNow && payment.terminalPaymentMethod === 'paynow'
        ? 'PayNow (Manual)'
        : terminalMethodLabel(payment.terminalPaymentMethod ?? 'card');
    lines.push(`  ${label}: ${formatCurrency(payment.cardAmount)}`);
  }
  if (payment.voucherAmount > 0) {
    lines.push(`  Voucher: ${formatCurrency(payment.voucherAmount)}`);
  }
  if (payment.manualPayNow) {
    lines.push(`Confirmed: ${formatReceiptTime(payment.paynowConfirmedAt)}`);
  }
  return lines;
}

export function buildReceiptText(order: PrintableOrder): string {
  const rows = order.items.flatMap((item) => {
    const modifierRows = item.modifiers.map((modifier) => `  ${modifier}`);
    return [
      receiptRow(`${item.quantity} x ${item.name}`, formatCurrency(item.unitPrice * item.quantity)),
      ...modifierRows,
    ];
  });

  const voucherLines: string[] = [];
  if (order.vouchers && order.vouchers.length > 0) {
    voucherLines.push(
      receiptRow(
        'Vouchers redeemed',
        formatCurrency(
          order.totals.voucherDiscount || order.vouchers.reduce((sum, voucher) => sum + voucher.amount, 0)
        )
      )
    );
    order.vouchers.forEach((voucher) => {
      voucherLines.push(
        receiptRow(
          `  ${voucher.type === 'cdc' ? 'CDC' : 'Acre Group'} ${voucher.code}`,
          `-${formatCurrency(voucher.amount)}`
        )
      );
    });
  }

  const brand = order.outlet.brandName?.trim() || order.outlet.name;
  const companyLines = (order.outlet.companyDetails ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(receiptCenter);

  // Optional REPRINT marker — confirm with owner before enabling:
  // const REPRINT_MARKER = '*** REPRINT ***';
  // ...(order.isReprint ? [receiptCenter(REPRINT_MARKER)] : []),

  return [
    receiptCenter(brand.toUpperCase()),
    ...companyLines,
    receiptCenter(order.outlet.name),
    RECEIPT_DIVIDER,
    receiptRow(`Order ${order.orderNumber}`),
    receiptRow(receiptTimestamp(order)),
    RECEIPT_DIVIDER,
    ...rows,
    RECEIPT_DIVIDER,
    ...(order.discounts && order.discounts.length > 0
      ? order.discounts
          .filter((d) => d.amountOff > 0)
          .map((d) => receiptRow(d.name, `-${formatCurrency(d.amountOff)}`))
      : order.totals.discount > 0
        ? [receiptRow('Discount', `-${formatCurrency(order.totals.discount)}`)]
        : []),
    ...(order.totals.voucherDiscount > 0 ? [receiptRow('Vouchers', `-${formatCurrency(order.totals.voucherDiscount)}`)] : []),
    receiptRow('TOTAL', formatCurrency(order.totals.total)),
    ...receiptPaymentLines(order),
    order.payment && order.payment.changeDue > 0
      ? receiptRow('Change', formatCurrency(order.payment.changeDue))
      : '',
    '',
    ...voucherLines,
    '',
    receiptCenter('Thank you'),
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildChit(order: PrintableOrder): KitchenChit {
  return {
    orderNumber: order.orderNumber,
    time: chitTimestamp(order),
    items: order.items.map((item) => ({
      quantity: item.quantity,
      name: item.name,
      modifiers: item.modifiers,
    })),
  };
}

export function receiptSnapshotToPrintableOrder(receipt: ReceiptSnapshotLike, session: StaffSession): PrintableOrder {
  return {
    orderNumber: receipt.order.order_number,
    usePrintTime: true,
    items: receipt.items.map((item) => ({
      quantity: item.quantity,
      name: item.customLabel ?? item.product.name,
      modifiers: item.modifiers.map((modifier) => modifier.modifier_name),
      unitPrice:
        item.customPrice ??
        money(item.product.price) + item.modifiers.reduce((sum, modifier) => sum + modifier.price_adjustment, 0),
    })),
    totals: {
      total: receipt.totals.total,
      discount:
        receipt.totals.discount + receipt.totals.targetedDiscount + receipt.totals.loyaltyDiscount,
      voucherDiscount: receipt.totals.voucherDiscount,
    },
    discounts: [
      ...(receipt.appliedDiscounts ?? []).map((d) => ({ name: d.name, amountOff: d.amountOff })),
      ...(receipt.totals.loyaltyDiscount > 0
        ? [{ name: 'Loyalty', amountOff: receipt.totals.loyaltyDiscount }]
        : []),
    ],
    payment: {
      method: receipt.paymentMode,
      cashAmount: receipt.cashAmount,
      cardAmount: receipt.cardAmount,
      voucherAmount: receipt.voucherAmount,
      cdcAmount: receipt.cdcAmount,
      changeDue: receipt.changeDue,
      paynowConfirmedAt: receipt.paynowConfirmedAt,
      manualPayNow: receipt.manualPayNow,
      terminalPaymentMethod: receipt.terminalPaymentMethod,
    },
    outlet: {
      name: session.outlet.name,
      brandName: session.outlet.receipt_brand_name,
      companyDetails: session.outlet.receipt_company_details,
    },
    vouchers: receipt.vouchers?.map((voucher) => ({
      code: voucher.code,
      type: voucher.type,
      amount: voucher.amount,
    })),
  };
}

export function orderReadToPrintableOrder(
  order: OrderRead,
  session: StaffSession,
  options?: {
    loyaltyDiscount?: number;
    voucherDiscount?: number;
    changeDue?: number;
    manualPayNow?: boolean;
    terminalPaymentMethod?: 'card' | 'paynow';
  }
): PrintableOrder {
  const paymentMethod = order.payment_method ?? 'cash';
  const isManualPayNow =
    options?.manualPayNow ??
    (paymentMethod === 'paynow' && order.payment_reference === MANUAL_PAYNOW_REFERENCE);
  const terminalMethod: 'card' | 'paynow' =
    options?.terminalPaymentMethod ??
    (paymentMethod === 'paynow' || isManualPayNow ? 'paynow' : 'card');

  const loyaltyDiscount = options?.loyaltyDiscount ?? money(order.loyalty_discount);
  const voucherDiscount = options?.voucherDiscount ?? money(order.voucher_discount);
  const changeDue = options?.changeDue ?? money(order.cash_change);

  return {
    orderNumber: order.order_number,
    createdAt: order.created_at,
    usePrintTime: false,
    items: order.items.map((item) => ({
      quantity: item.quantity,
      name: item.product_name,
      modifiers: item.modifiers.map((modifier) => modifier.modifier_name),
      unitPrice: money(item.unit_price),
    })),
    totals: {
      total: money(order.total),
      discount: loyaltyDiscount,
      voucherDiscount,
    },
    payment: {
      method: paymentMethod,
      cashAmount: money(order.cash_amount),
      cardAmount: money(order.card_amount),
      voucherAmount: money(order.voucher_amount),
      cdcAmount: money(order.cdc_amount),
      changeDue,
      paynowConfirmedAt: order.paynow_confirmed_at,
      manualPayNow: isManualPayNow,
      terminalPaymentMethod: terminalMethod,
    },
    outlet: {
      name: session.outlet.name,
      brandName: session.outlet.receipt_brand_name,
      companyDetails: session.outlet.receipt_company_details,
    },
    vouchers: order.applied_vouchers?.map((voucher) => ({
      code: voucher.code,
      type: voucher.type,
      amount: money(voucher.amount_applied),
    })),
  };
}
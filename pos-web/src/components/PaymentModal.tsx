import { useEffect, useState } from 'react';
import { Banknote, CheckCircle2, CreditCard, Loader2, Printer, QrCode, Receipt, Split, Undo2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  applyVouchersToOrder,
  createOrder,
  formatCurrency,
  getPayNowQr,
  money,
  redeemLoyalty,
  updateOrderStatus,
  type OrderRead,
} from '@/api/client';
import {
  getPaymentStatus,
  getTerminalConnection,
  queryPaymentIntent,
  startCardPayment,
  voidCardPayment,
  type PaymentIntent,
} from '@/api/kpayClient';
import type { AppliedVoucher, CartItem, Discount, LoyaltySelection, StaffSession, Totals } from '@/types';
import { tapFeedback } from '@/utils/haptics';
import { newIdempotencyKey } from '@/utils/idempotency';
import { printReceipt as printReceiptUsb } from '@/utils/printer';
import { broadcast } from '@/display/channel';

interface PaymentModalProps {
  open: boolean;
  session: StaffSession;
  items: CartItem[];
  totals: Totals;
  discount: Discount | null;
  loyalty: LoyaltySelection | null;
  vouchers: AppliedVoucher[];
  onClose: () => void;
  onOrderComplete: () => void;
}

type PaymentMode = 'cash' | 'card' | 'paynow' | 'split';
type TerminalPaymentMethod = 'card' | 'paynow';
type PaymentStep = 'payment' | 'processing' | 'complete';

const CARD_POLL_INTERVAL_MS = 2000;
const CARD_POLL_TIMEOUT_MS = 95000;
const QUERY_POLL_INTERVAL_MS = 5000;
const QUERY_POLL_MAX_MS = 30000;

interface ReceiptSnapshot {
  order: OrderRead;
  items: CartItem[];
  totals: Totals;
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

interface CardPaymentSession {
  order: OrderRead;
  intentId: string;
  paymentReference: string;
  paymentMode: 'card' | 'paynow' | 'split';
  terminalPaymentMethod: TerminalPaymentMethod;
  cashAmount: number;
  cardAmount: number;
  voucherAmount: number;
  cdcAmount: number;
  cashTendered?: number;
  startedAt: number;
}

interface FinalizationPending {
  order: OrderRead;
  statusPayload: Parameters<typeof updateOrderStatus>[1];
  paymentMode: PaymentMode;
  paymentDetails?: {
    terminalPaymentMethod?: TerminalPaymentMethod;
    cashAmount?: number;
    cardAmount?: number;
    voucherAmount?: number;
    cdcAmount?: number;
    changeDue?: number;
    manualPayNow?: boolean;
    paynowConfirmedAt?: string | null;
  };
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function paymentModeLabel(mode: PaymentMode): string {
  if (mode === 'paynow') {
    return 'PayNow';
  }
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function terminalMethodLabel(method: TerminalPaymentMethod): string {
  return method === 'paynow' ? 'PayNow' : 'Card';
}

function formatReceiptTime(value?: string | null): string {
  const parsed = value ? new Date(value) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return date.toLocaleTimeString('en-SG', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function receiptPaymentLines(receipt: ReceiptSnapshot): string[] {
  if (receipt.paymentMode !== 'split') {
    if (receipt.paymentMode === 'paynow' && receipt.manualPayNow) {
      return [
        'Payment: PayNow (Manual)',
        `Amount: ${formatCurrency(receipt.cardAmount)}`,
        `Confirmed: ${formatReceiptTime(receipt.paynowConfirmedAt)}`,
      ];
    }
    return [`Payment: ${paymentModeLabel(receipt.paymentMode)}`];
  }

  const lines = ['Payment: Split'];
  if (receipt.cashAmount > 0) {
    lines.push(`  Cash: ${formatCurrency(receipt.cashAmount)}`);
  }
  if (receipt.cdcAmount > 0) {
    lines.push(`  CDC voucher: ${formatCurrency(receipt.cdcAmount)}`);
  }
  if (receipt.cardAmount > 0) {
    const label =
      receipt.manualPayNow && receipt.terminalPaymentMethod === 'paynow'
        ? 'PayNow (Manual)'
        : terminalMethodLabel(receipt.terminalPaymentMethod ?? 'card');
    lines.push(`  ${label}: ${formatCurrency(receipt.cardAmount)}`);
  }
  if (receipt.voucherAmount > 0) {
    lines.push(`  Voucher: ${formatCurrency(receipt.voucherAmount)}`);
  }
  if (receipt.manualPayNow) {
    lines.push(`Confirmed: ${formatReceiptTime(receipt.paynowConfirmedAt)}`);
  }
  return lines;
}

function getHttpStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

function getErrorMessage(err: unknown, fallback = 'Payment failed'): string {
  const detail =
    (err as { response?: { data?: { detail?: unknown; message?: unknown } } })?.response?.data?.detail ??
    (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message ??
    (err as Error)?.message ??
    fallback;
  return typeof detail === 'string' ? detail : fallback;
}

function cardFailureMessage(status: PaymentIntent['status'], errorMessage?: string): string {
  if (status === 'timeout') {
    return 'Payment is still settling on the terminal. Checking status…';
  }
  if (status === 'cancelled') {
    return 'Payment cancelled.';
  }
  if (status === 'terminal_failed' || status === 'failed') {
    return errorMessage || 'Payment failed. You may retry once the terminal confirms no charge.';
  }
  return errorMessage || 'Payment failed.';
}

function buildReceiptText(receipt: ReceiptSnapshot, session: StaffSession): string {
  const rows = receipt.items.flatMap((item) => {
    const modifierRows = item.modifiers.map(
      (modifier) => `  ${modifier.modifier_name} ${modifier.price_adjustment > 0 ? formatCurrency(modifier.price_adjustment) : ''}`
    );
    return [
      `${item.quantity} x ${item.product.name} ${formatCurrency((money(item.product.price) + item.modifiers.reduce((sum, modifier) => sum + modifier.price_adjustment, 0)) * item.quantity)}`,
      ...modifierRows,
    ];
  });

  const voucherLines: string[] = [];
  if (receipt.vouchers && receipt.vouchers.length > 0) {
    voucherLines.push(`Vouchers redeemed: ${formatCurrency(receipt.totals.voucherDiscount || receipt.vouchers.reduce((s, v) => s + v.amount, 0))}`);
    receipt.vouchers.forEach((v) => {
      voucherLines.push(`  ${v.type === 'cdc' ? 'CDC' : 'Acre Group'} ${v.code} -${formatCurrency(v.amount)}`);
    });
  }

  return [
    'Grid POS',
    session.outlet.name,
    `Order ${receipt.order.order_number}`,
    new Date().toLocaleString('en-SG'),
    '',
    ...rows,
    '',
    `Subtotal ${formatCurrency(receipt.totals.subtotal)}`,
    `Discount -${formatCurrency(receipt.totals.discount + receipt.totals.loyaltyDiscount)}`,
    ...(receipt.totals.voucherDiscount > 0 ? [`Vouchers -${formatCurrency(receipt.totals.voucherDiscount)}`] : []),
    `Total ${formatCurrency(receipt.totals.total)}`,
    ...receiptPaymentLines(receipt),
    receipt.changeDue > 0 ? `Change ${formatCurrency(receipt.changeDue)}` : '',
    '',
    ...voucherLines,
    '',
    'Thank you',
  ]
    .filter(Boolean)
    .join('\n');
}

export default function PaymentModal({
  open,
  session,
  items,
  totals,
  discount,
  loyalty,
  vouchers,
  onClose,
  onOrderComplete,
}: PaymentModalProps) {
  const [step, setStep] = useState<PaymentStep>('payment');
  const [mode, setMode] = useState<PaymentMode>('cash');

  // Close the modal. If payment never completed (cashier backed out of
  // checkout), tell the customer display to drop the "Processing payment…"
  // screen — otherwise it stays stuck there for the next order.
  function handleClose() {
    if (step !== 'complete') {
      try {
        broadcast({ type: 'PAYMENT_CANCEL' });
      } catch {
        // Customer display is optional.
      }
    }
    onClose();
  }
  const [splitSecondMethod, setSplitSecondMethod] = useState<TerminalPaymentMethod>('card');
  const [cashAmount, setCashAmount] = useState('');
  const [cdcAmount, setCdcAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptSnapshot | null>(null);
  const [error, setError] = useState('');
  const [terminalConnected, setTerminalConnected] = useState<boolean | null>(null);
  const [cardPayment, setCardPayment] = useState<CardPaymentSession | null>(null);
  const [payNowQrUrl, setPayNowQrUrl] = useState<string | null>(null);
  const [payNowQrLoading, setPayNowQrLoading] = useState(false);
  const [payNowQrError, setPayNowQrError] = useState('');
  const [voidState, setVoidState] = useState<'idle' | 'voiding' | 'voided'>('idle');
  const [pendingOrder, setPendingOrder] = useState<OrderRead | null>(null);
  const [checkoutIdempotencyKey, setCheckoutIdempotencyKey] = useState(() => newIdempotencyKey());
  const [markPaidIdempotencyKey, setMarkPaidIdempotencyKey] = useState(() => newIdempotencyKey());
  const [kpayAttemptNumber, setKpayAttemptNumber] = useState(0);
  const [finalizationPending, setFinalizationPending] = useState<FinalizationPending | null>(null);

  useEffect(() => {
    if (!open) {
      setStep('payment');
      setMode('cash');
      setSplitSecondMethod('card');
      setCashAmount('');
      setCdcAmount('');
      setSubmitting(false);
      setReceipt(null);
      setError('');
      setTerminalConnected(null);
      setCardPayment(null);
      setPayNowQrUrl(null);
      setPayNowQrLoading(false);
      setPayNowQrError('');
      setVoidState('idle');
      setPendingOrder(null);
      setCheckoutIdempotencyKey(newIdempotencyKey());
      setMarkPaidIdempotencyKey(newIdempotencyKey());
      setKpayAttemptNumber(0);
      setFinalizationPending(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    setTerminalConnected(null);
    getTerminalConnection()
      .then((connection) => {
        if (!cancelled) {
          setTerminalConnected(connection.connected);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTerminalConnected(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const payableTotal = totals.total;
  const totalDue = roundMoney(payableTotal);
  const voucherAmount = roundMoney(totals.voucherDiscount);
  const cashTendered = roundMoney(money(cashAmount));
  // Raw split components for the server; display values are rounded separately.
  const splitCdcAmountRaw =
    mode === 'split' ? Math.min(Math.max(money(cdcAmount), 0), payableTotal) : 0;
  const splitCashAmountRaw =
    mode === 'split'
      ? Math.min(Math.max(money(cashAmount), 0), Math.max(0, payableTotal - splitCdcAmountRaw))
      : 0;
  const splitTerminalAmountRaw =
    mode === 'split' ? Math.max(0, payableTotal - splitCashAmountRaw - splitCdcAmountRaw) : 0;
  const splitCdcAmount = mode === 'split' ? roundMoney(splitCdcAmountRaw) : 0;
  const splitCashAmount = mode === 'split' ? roundMoney(splitCashAmountRaw) : 0;
  const splitTerminalAmount = mode === 'split' ? roundMoney(splitTerminalAmountRaw) : 0;
  const splitCashInputValid = cashTendered >= 0 && money(cdcAmount) >= 0;
  const terminalMethod: TerminalPaymentMethod =
    mode === 'paynow' ? 'paynow' : mode === 'split' ? splitSecondMethod : 'card';
  const manualPayNowAmount =
    mode === 'paynow'
      ? totalDue
      : mode === 'split' && splitSecondMethod === 'paynow' && splitTerminalAmount > 0
        ? splitTerminalAmount
        : 0;
  const manualPayNowEligible = manualPayNowAmount > 0;
  const manualPayNowActive = terminalConnected === false && manualPayNowEligible;
  const manualPayNowReady = manualPayNowActive && !payNowQrLoading && Boolean(payNowQrUrl);
  const terminalUnavailable =
    terminalConnected === false &&
    (mode === 'card' || (mode === 'split' && splitSecondMethod === 'card' && splitTerminalAmount > 0));
  const requiresTerminal =
    mode === 'card' ||
    (mode === 'paynow' && !manualPayNowActive) ||
    (mode === 'split' &&
      splitTerminalAmount > 0 &&
      (splitSecondMethod === 'card' || !manualPayNowActive));
  const changeDue = mode === 'cash' ? roundMoney(Math.max(0, cashTendered - totalDue)) : 0;
  const cashDue = mode === 'cash' ? totalDue : splitCashAmount;

  const canComplete =
    items.length > 0 &&
    !submitting &&
    ((mode === 'card' && terminalConnected !== false) ||
      (mode === 'paynow' && (terminalConnected !== false || manualPayNowReady)) ||
      (mode === 'cash' && cashTendered >= totalDue) ||
      (mode === 'split' &&
        splitCashInputValid &&
        (splitCashAmount > 0 || splitTerminalAmount > 0 || splitCdcAmount > 0 || voucherAmount > 0) &&
        (splitTerminalAmount <= 0 ||
          (splitSecondMethod === 'card'
            ? terminalConnected !== false
            : terminalConnected !== false || manualPayNowReady))));

  useEffect(() => {
    if (mode === 'split' && !splitCashInputValid) {
      setError('Cash and CDC amounts cannot be negative');
      return;
    }
    if (terminalUnavailable) {
      setError('Payment terminal offline');
      return;
    }
    if (manualPayNowActive && !payNowQrLoading && !payNowQrUrl) {
      setError(payNowQrError || 'Manual PayNow QR code is not configured');
      return;
    }
    setError('');
  }, [
    manualPayNowActive,
    mode,
    payNowQrError,
    payNowQrLoading,
    payNowQrUrl,
    splitCashInputValid,
    terminalUnavailable,
  ]);

  useEffect(() => {
    if (!open || step !== 'payment' || !manualPayNowActive) {
      setPayNowQrLoading(false);
      setPayNowQrError('');
      return;
    }

    let cancelled = false;
    setPayNowQrLoading(true);
    setPayNowQrError('');

    getPayNowQr(session.outlet.id)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setPayNowQrUrl(response.paynow_qr_url);
        if (!response.paynow_qr_url) {
          setPayNowQrError('Manual PayNow QR code is not configured');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPayNowQrUrl(null);
          setPayNowQrError('Manual PayNow QR code could not be loaded');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPayNowQrLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [manualPayNowActive, open, session.outlet.id, step]);

  useEffect(() => {
    if (!open || step !== 'payment' || !manualPayNowActive || !payNowQrUrl) {
      return;
    }

    try {
      broadcast({
        type: 'PAYNOW_QR',
        payload: {
          qrUrl: payNowQrUrl,
          total: manualPayNowAmount,
        },
      });
    } catch {
      // Customer display is optional.
    }
  }, [manualPayNowActive, manualPayNowAmount, open, payNowQrUrl, step]);

  async function redeemPostPayment(orderId: string, voucherCodes: string[] | null): Promise<void> {
    if (loyalty?.reward) {
      await redeemLoyalty(loyalty.customer.member_id, orderId, loyalty.reward.points);
    }
    if (voucherCodes && voucherCodes.length > 0) {
      try {
        await applyVouchersToOrder(orderId, voucherCodes);
      } catch {
        // Vouchers were likely applied at order creation on the first attempt.
      }
    }
  }

  async function createPendingOrder(
    paymentReference: string,
    voucherCodes: string[] | null,
    paymentMethod: PaymentMode
  ): Promise<OrderRead> {
    return createOrder(
      {
        outlet_id: session.outlet.id,
        staff_id: session.staff.id,
        status: 'pending',
        payment_method: paymentMethod,
        payment_reference: paymentReference,
        loyalty_member_id: loyalty?.customer.member_id ?? null,
        loyalty_points_redeemed: loyalty?.reward?.points ?? null,
        loyalty_discount: totals.discount + totals.loyaltyDiscount > 0 ? totals.discount + totals.loyaltyDiscount : null,
        customer_id: loyalty?.customer.customer_id ?? null,
        voucher_codes: voucherCodes,
        items: items.map((item) => ({
          product_id: item.product.id,
          quantity: item.quantity,
          modifiers: item.modifiers.map((modifier) => ({
            modifier_name: modifier.modifier_name,
            price_adjustment: modifier.price_adjustment,
          })),
        })),
      },
      { idempotencyKey: checkoutIdempotencyKey }
    );
  }

  async function ensurePendingOrder(
    paymentReference: string,
    voucherCodes: string[] | null,
    paymentMethod: PaymentMode
  ): Promise<OrderRead> {
    if (pendingOrder) {
      return pendingOrder;
    }
    const order = await createPendingOrder(paymentReference, voucherCodes, paymentMethod);
    setPendingOrder(order);
    return order;
  }

  function completePaidOrder(
    paidOrder: OrderRead,
    paidMode: PaymentMode,
    paymentDetails?: {
      terminalPaymentMethod?: TerminalPaymentMethod;
      cashAmount?: number;
      cardAmount?: number;
      voucherAmount?: number;
      cdcAmount?: number;
      changeDue?: number;
      manualPayNow?: boolean;
      paynowConfirmedAt?: string | null;
    }
  ) {
    const snapshot: ReceiptSnapshot = {
      order: paidOrder,
      items,
      totals,
      vouchers,
      paymentMode: paidMode,
      terminalPaymentMethod:
        paymentDetails?.terminalPaymentMethod ??
        (paidMode === 'paynow' ? 'paynow' : paidMode === 'card' ? 'card' : undefined),
      cashAmount: paymentDetails?.cashAmount ?? (paidMode === 'cash' ? cashDue : 0),
      cardAmount: paymentDetails?.cardAmount ?? (paidMode === 'card' || paidMode === 'paynow' ? totalDue : 0),
      voucherAmount: paymentDetails?.voucherAmount ?? 0,
      cdcAmount: paymentDetails?.cdcAmount ?? 0,
      changeDue: paymentDetails?.changeDue ?? (paidMode === 'cash' ? changeDue : 0),
      manualPayNow: paymentDetails?.manualPayNow ?? false,
      paynowConfirmedAt: paymentDetails?.paynowConfirmedAt ?? paidOrder.paynow_confirmed_at ?? null,
    };
    setReceipt(snapshot);
    setStep('complete');
    setCardPayment(null);
    setSubmitting(false);
    setPendingOrder(null);
    setCheckoutIdempotencyKey(newIdempotencyKey());
    setMarkPaidIdempotencyKey(newIdempotencyKey());
    setKpayAttemptNumber(0);
    setFinalizationPending(null);

    try {
      broadcast({
        type: 'PAYMENT_COMPLETE',
        payload: {
          total: totals.total,
          pointsEarned: paidOrder.loyalty_points_earned ?? null,
        },
      });
      broadcast({ type: 'ORDER_COMPLETE' });
    } catch {
      // Customer display is optional.
    }

    onOrderComplete();
  }

  function buildCardStatusPayload(cardSession: CardPaymentSession): Parameters<typeof updateOrderStatus>[1] {
    if (cardSession.paymentMode === 'split') {
      return {
        status: 'paid',
        payment_method: 'split',
        payment_reference: cardSession.paymentReference,
        cash_tendered: cardSession.cashTendered,
        cash_amount: cardSession.cashAmount,
        voucher_amount: cardSession.voucherAmount,
        cdc_amount: cardSession.cdcAmount,
      };
    }
    return {
      status: 'paid',
      payment_method: cardSession.paymentMode,
      payment_reference: cardSession.paymentReference,
    };
  }

  async function finalizeCardPayment(
    cardSession: CardPaymentSession,
    voucherCodes: string[] | null
  ): Promise<void> {
    const statusPayload = buildCardStatusPayload(cardSession);
    const paymentDetails = {
      terminalPaymentMethod: cardSession.terminalPaymentMethod,
      cashAmount: cardSession.cashAmount,
      cardAmount: cardSession.cardAmount,
      voucherAmount: cardSession.voucherAmount,
      cdcAmount: cardSession.cdcAmount,
      changeDue: 0,
    };
    try {
      await redeemPostPayment(cardSession.order.id, voucherCodes);
      const paidOrder = await updateOrderStatus(cardSession.order.id, statusPayload, {
        idempotencyKey: markPaidIdempotencyKey,
      });
      completePaidOrder(paidOrder, cardSession.paymentMode, paymentDetails);
      toast.success(`${terminalMethodLabel(cardSession.terminalPaymentMethod)} payment successful`);
    } catch (err: unknown) {
      setFinalizationPending({
        order: cardSession.order,
        statusPayload,
        paymentMode: cardSession.paymentMode,
        paymentDetails,
      });
      setError(`Payment approved, but order finalization failed: ${getErrorMessage(err, 'Order finalization failed')}`);
      setCardPayment(null);
      setStep('payment');
      setSubmitting(false);
      toast.error('Payment approved, but order finalization failed');
    }
  }

  async function reconcileTimedOutPayment(
    cardSession: CardPaymentSession,
    voucherCodes: string[] | null,
    onFail: (message: string) => void
  ): Promise<boolean> {
    const queryStartedAt = Date.now();
    while (Date.now() - queryStartedAt <= QUERY_POLL_MAX_MS) {
      try {
        const result = await queryPaymentIntent(cardSession.intentId);
        if (result.terminal_status === 'success') {
          await finalizeCardPayment(cardSession, voucherCodes);
          return true;
        }
        if (result.terminal_status === 'failed') {
          onFail(cardFailureMessage(result.status, result.error_message));
          return true;
        }
        setError('Still processing on the terminal. Please wait…');
      } catch (err: unknown) {
        onFail(getErrorMessage(err, 'Payment status check failed.'));
        return true;
      }
      await new Promise((resolve) => window.setTimeout(resolve, QUERY_POLL_INTERVAL_MS));
    }
    onFail('Payment is still processing on the terminal. Wait a moment, then retry.');
    return true;
  }

  useEffect(() => {
    if (!open || step !== 'processing' || !cardPayment) {
      return;
    }

    const voucherCodes = vouchers.length > 0 ? vouchers.map((v) => v.code) : null;
    let cancelled = false;
    let inFlight = false;
    let intervalId: number | undefined;

    const clearPolling = () => {
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };

    const stopPolling = () => {
      cancelled = true;
      clearPolling();
    };

    const failCardPayment = (message: string) => {
      if (cancelled) {
        return;
      }
      stopPolling();
      setError(message);
      setCardPayment(null);
      setStep('payment');
      setSubmitting(false);
    };

    const poll = async () => {
      if (cancelled || inFlight) {
        return;
      }

      if (Date.now() - cardPayment.startedAt > CARD_POLL_TIMEOUT_MS) {
        inFlight = true;
        try {
          await reconcileTimedOutPayment(cardPayment, voucherCodes, failCardPayment);
        } finally {
          inFlight = false;
        }
        return;
      }

      inFlight = true;
      try {
        const latest = await getPaymentStatus(cardPayment.intentId);
        if (cancelled) {
          return;
        }

        if (latest.status === 'success') {
          stopPolling();
          await finalizeCardPayment(cardPayment, voucherCodes);
          return;
        }

        if (latest.status === 'timeout') {
          stopPolling();
          await reconcileTimedOutPayment(cardPayment, voucherCodes, failCardPayment);
          return;
        }

        if (latest.status === 'failed' || latest.status === 'terminal_failed' || latest.status === 'cancelled') {
          toast.error('Payment failed');
          failCardPayment(cardFailureMessage(latest.status, latest.error_message));
        }
      } catch (err: unknown) {
        if (!cancelled) {
          toast.error('Payment status check failed');
          failCardPayment(getErrorMessage(err, 'Payment status check failed.'));
        }
      } finally {
        inFlight = false;
      }
    };

    void poll();
    intervalId = window.setInterval(() => {
      void poll();
    }, CARD_POLL_INTERVAL_MS);

    return stopPolling;
  }, [cardPayment, open, step, vouchers, markPaidIdempotencyKey]);

  if (!open) {
    return null;
  }

  const terminalStatusText =
    manualPayNowActive
      ? 'Terminal offline – Manual PayNow'
      : terminalConnected === null
      ? 'Checking terminal…'
      : terminalConnected
        ? 'Terminal connected'
        : 'Terminal offline';
  const paymentActionLabel = submitting
    ? step === 'processing'
      ? 'Processing payment…'
      : 'Processing…'
    : manualPayNowActive
      ? 'Payment received'
    : requiresTerminal && error && terminalConnected !== false
      ? `Retry ${mode === 'split' ? 'split' : mode === 'paynow' ? 'PayNow' : paymentModeLabel(mode).toLowerCase()} payment`
      : requiresTerminal
        ? terminalMethod === 'paynow'
          ? 'Charge via PayNow'
          : 'Charge to terminal'
        : 'Complete payment';

  function renderManualPayNowPanel(amount: number) {
    return (
      <div className="manual-paynow-panel">
        <div className="manual-paynow-banner">
          <QrCode size={18} aria-hidden="true" />
          <span>Terminal offline – Manual PayNow</span>
        </div>
        <strong>{formatCurrency(amount)}</strong>
        <div className="manual-paynow-qr">
          {payNowQrLoading ? (
            <Loader2 className="spin-icon" size={34} aria-hidden="true" />
          ) : payNowQrUrl ? (
            <img src={payNowQrUrl} alt="Manual PayNow QR code" />
          ) : (
            <QrCode size={54} aria-hidden="true" />
          )}
        </div>
        <span>{payNowQrUrl ? 'Scan and pay, then confirm below' : payNowQrError || 'No QR code configured'}</span>
      </div>
    );
  }

  async function handleRetryFinalization() {
    if (!finalizationPending) {
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const voucherCodes = vouchers.length > 0 ? vouchers.map((v) => v.code) : null;
      await redeemPostPayment(finalizationPending.order.id, voucherCodes);
      const paidOrder = await updateOrderStatus(
        finalizationPending.order.id,
        finalizationPending.statusPayload,
        { idempotencyKey: markPaidIdempotencyKey }
      );
      completePaidOrder(
        paidOrder,
        finalizationPending.paymentMode,
        finalizationPending.paymentDetails
      );
      toast.success('Order finalized');
    } catch (err: unknown) {
      setError(`Order finalization failed: ${getErrorMessage(err, 'Order finalization failed')}`);
      setSubmitting(false);
      toast.error('Order finalization failed');
    }
  }

  async function completePayment() {
    if (!canComplete) {
      return;
    }
    if (terminalUnavailable) {
      setError('Payment terminal offline');
      toast.error('Payment terminal offline');
      return;
    }
    if (manualPayNowActive && !payNowQrUrl) {
      setError(payNowQrError || 'Manual PayNow QR code is not configured');
      return;
    }

    setSubmitting(true);
    setError('');
    setFinalizationPending(null);

    try {
      const paymentReference = manualPayNowActive ? 'MANUAL' : `POS-${checkoutIdempotencyKey.slice(0, 8)}`;
      const voucherCodes = vouchers.length > 0 ? vouchers.map((v) => v.code) : null;

      const order = await ensurePendingOrder(paymentReference, voucherCodes, mode);

      if (manualPayNowActive) {
        const confirmedAt = new Date().toISOString();
        await redeemPostPayment(order.id, voucherCodes);
        const paidOrder =
          mode === 'split'
            ? await updateOrderStatus(
                order.id,
                {
                  status: 'paid',
                  payment_method: 'split',
                  payment_reference: paymentReference,
                  cash_tendered: splitCashAmountRaw > 0 ? splitCashAmountRaw : undefined,
                  cash_amount: splitCashAmountRaw,
                  voucher_amount: voucherAmount,
                  cdc_amount: splitCdcAmountRaw,
                  paynow_confirmed_at: confirmedAt,
                },
                { idempotencyKey: markPaidIdempotencyKey }
              )
            : await updateOrderStatus(
                order.id,
                {
                  status: 'paid',
                  payment_method: 'paynow',
                  payment_reference: paymentReference,
                  paynow_confirmed_at: confirmedAt,
                },
                { idempotencyKey: markPaidIdempotencyKey }
              );

        completePaidOrder(paidOrder, mode, {
          terminalPaymentMethod: 'paynow',
          cashAmount: mode === 'split' ? splitCashAmount : 0,
          cardAmount: mode === 'split' ? splitTerminalAmount : totalDue,
          voucherAmount: mode === 'split' ? voucherAmount : 0,
          cdcAmount: mode === 'split' ? splitCdcAmount : 0,
          changeDue: 0,
          manualPayNow: true,
          paynowConfirmedAt: paidOrder.paynow_confirmed_at ?? confirmedAt,
        });
        toast.success('Manual PayNow confirmed');
        return;
      }

      if (requiresTerminal && (mode === 'card' || mode === 'paynow' || (mode === 'split' && splitTerminalAmount > 0))) {
        const paymentAmount = mode === 'split' ? splitTerminalAmountRaw : payableTotal;
        const kpayPaymentType = terminalMethod === 'paynow' ? 13 : 1;
        const nextAttempt = kpayAttemptNumber + 1;
        try {
          const intent = await startCardPayment(order.id, paymentAmount, kpayPaymentType, {
            idempotencyKey: `${order.id}-kpay-${nextAttempt}`,
            cashAmount: mode === 'split' ? splitCashAmountRaw : undefined,
            cdcAmount: mode === 'split' ? splitCdcAmountRaw : undefined,
          });
          setKpayAttemptNumber(nextAttempt);
          setTerminalConnected(true);
          setCardPayment({
            order,
            intentId: intent.id,
            paymentReference,
            paymentMode: mode === 'split' ? 'split' : mode,
            terminalPaymentMethod: terminalMethod,
            cashAmount: mode === 'split' ? splitCashAmountRaw : 0,
            cardAmount: paymentAmount,
            voucherAmount: mode === 'split' ? voucherAmount : 0,
            cdcAmount: mode === 'split' ? splitCdcAmountRaw : 0,
            cashTendered: mode === 'split' && splitCashAmountRaw > 0 ? splitCashAmountRaw : undefined,
            startedAt: Date.now(),
          });
          setStep('processing');
        } catch (err: unknown) {
          if (getHttpStatus(err) === 503) {
            setTerminalConnected(false);
            setError('Payment terminal offline');
            toast.error('Payment terminal offline');
          } else {
            setError(getErrorMessage(err));
          }
          setSubmitting(false);
        }
        return;
      }

      await redeemPostPayment(order.id, voucherCodes);
      const paidOrder =
        mode === 'split'
          ? await updateOrderStatus(
              order.id,
              {
                status: 'paid',
                payment_method: 'split',
                payment_reference: paymentReference,
                cash_tendered: splitCashAmountRaw > 0 ? splitCashAmountRaw : undefined,
                cash_amount: splitCashAmountRaw,
                voucher_amount: voucherAmount,
                cdc_amount: splitCdcAmountRaw,
              },
              { idempotencyKey: markPaidIdempotencyKey }
            )
          : await updateOrderStatus(
              order.id,
              {
                status: 'paid',
                payment_method: mode,
                payment_reference: paymentReference,
                cash_tendered: mode === 'cash' ? cashTendered : undefined,
              },
              { idempotencyKey: markPaidIdempotencyKey }
            );

      completePaidOrder(
        paidOrder,
        mode,
        mode === 'split'
          ? {
              terminalPaymentMethod: splitSecondMethod,
              cashAmount: splitCashAmount,
              cardAmount: 0,
              voucherAmount,
              cdcAmount: splitCdcAmount,
              changeDue: 0,
            }
          : undefined
      );
      toast.success('Order paid');
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      setSubmitting(false);
    }
  }

  async function handleVoid() {
    if (!receipt) {
      return;
    }
    tapFeedback();
    setVoidState('voiding');
    try {
      const res = await voidCardPayment(receipt.order.id);
      if (res.result === 'ok') {
        setVoidState('voided');
        toast.success('Payment voided');
      } else {
        setVoidState('idle');
        toast.error(res.message || 'Void failed');
      }
    } catch (err: unknown) {
      setVoidState('idle');
      toast.error(getErrorMessage(err, 'Void failed'));
    }
  }

  async function printReceipt() {
    if (!receipt) {
      return;
    }
    tapFeedback();
    const text = buildReceiptText(receipt, session);
    const printed = await printReceiptUsb(text);
    if (!printed) {
      toast.error('Receipt print failed — receipt preview is below');
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="payment-modal" role="dialog" aria-modal="true" aria-labelledby="payment-title">
        <header className="sheet-header">
          <div>
            <p>
              {step === 'complete'
                ? 'Complete'
                : step === 'processing'
                  ? `${terminalMethodLabel(cardPayment?.terminalPaymentMethod ?? 'card')} payment`
                  : 'Payment'}
            </p>
            <h2 id="payment-title">
              {step === 'complete'
                ? 'Order complete'
                : step === 'processing'
                  ? 'Processing payment'
                  : formatCurrency(totals.total)}
            </h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close payment"
            title="Close"
            disabled={submitting}
            onPointerDown={() => tapFeedback()}
            onClick={handleClose}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        {step === 'payment' ? (
          <>
            <div className="payment-modes" role="radiogroup" aria-label="Payment mode">
              {[
                { value: 'cash' as const, label: 'Cash', Icon: Banknote },
                { value: 'card' as const, label: 'Card', Icon: CreditCard },
                { value: 'paynow' as const, label: 'PayNow', Icon: QrCode },
                { value: 'split' as const, label: 'Split', Icon: Split },
              ].map(({ value, label, Icon }) => (
                <button
                  key={value}
                  className={mode === value ? 'active' : ''}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  disabled={submitting}
                  onPointerDown={() => tapFeedback()}
                  onClick={() => setMode(value)}
                >
                  <Icon size={18} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>

            <div
              className={`terminal-status ${terminalConnected === true ? 'connected' : terminalConnected === false ? 'offline' : ''}`}
              role="status"
            >
              {terminalConnected === true && !manualPayNowActive && <CheckCircle2 size={14} aria-hidden="true" />}
              {terminalStatusText}
            </div>

            <div className="payment-body">
              {error && <div className="payment-error">{error}</div>}

              {mode === 'cash' && (
                <label className="amount-field">
                  Cash received
                  <input
                    value={cashAmount}
                    onChange={(event) => setCashAmount(event.target.value)}
                    inputMode="decimal"
                    autoFocus
                  />
                </label>
              )}

              {(mode === 'card' || mode === 'paynow') && (
                mode === 'paynow' && manualPayNowActive ? (
                  renderManualPayNowPanel(totalDue)
                ) : (
                  <div className="terminal-panel">
                    {mode === 'paynow' ? <QrCode size={32} aria-hidden="true" /> : <CreditCard size={32} aria-hidden="true" />}
                    <strong>{formatCurrency(totalDue)}</strong>
                    <span>
                      {terminalConnected === false
                        ? 'Terminal offline'
                        : mode === 'paynow'
                          ? 'PayNow QR'
                          : 'Ready to charge'}
                    </span>
                  </div>
                )
              )}

              {mode === 'split' && (
                <div className="split-payment-panel">
                  <div className="split-fields">
                    <label className="amount-field">
                      Cash amount
                      <input
                        value={cashAmount}
                        onChange={(event) => setCashAmount(event.target.value)}
                        inputMode="decimal"
                        autoFocus
                      />
                    </label>
                    <label className="amount-field">
                      CDC voucher
                      <input
                        value={cdcAmount}
                        onChange={(event) => setCdcAmount(event.target.value)}
                        inputMode="decimal"
                        placeholder="0.00"
                      />
                    </label>
                  </div>
                  <div className="split-card-due">
                    <span>{terminalMethodLabel(splitSecondMethod)} remainder</span>
                    <strong>{formatCurrency(splitTerminalAmount)}</strong>
                  </div>
                  <div className="split-method-toggle" role="radiogroup" aria-label="Split terminal method">
                    {(['card', 'paynow'] as const).map((method) => (
                      <button
                        key={method}
                        className={splitSecondMethod === method ? 'active' : ''}
                        type="button"
                        role="radio"
                        aria-checked={splitSecondMethod === method}
                        disabled={submitting}
                        onPointerDown={() => tapFeedback()}
                        onClick={() => setSplitSecondMethod(method)}
                      >
                        {method === 'paynow' ? <QrCode size={16} aria-hidden="true" /> : <CreditCard size={16} aria-hidden="true" />}
                        {terminalMethodLabel(method)}
                      </button>
                    ))}
                  </div>
                  <div className="split-breakdown">
                    <div>
                      <span>Cash</span>
                      <strong>{formatCurrency(splitCashAmount)}</strong>
                    </div>
                    {splitCdcAmount > 0 && (
                      <div>
                        <span>CDC voucher</span>
                        <strong>{formatCurrency(splitCdcAmount)}</strong>
                      </div>
                    )}
                    <div>
                      <span>{manualPayNowActive ? 'PayNow (Manual)' : terminalMethodLabel(splitSecondMethod)}</span>
                      <strong>{formatCurrency(splitTerminalAmount)}</strong>
                    </div>
                    {voucherAmount > 0 && (
                      <div>
                        <span>Voucher</span>
                        <strong>{formatCurrency(voucherAmount)}</strong>
                      </div>
                    )}
                  </div>
                  {manualPayNowActive && renderManualPayNowPanel(splitTerminalAmount)}
                </div>
              )}

              <section className="payment-summary" aria-label="Payment summary">
                <div>
                  <span>Subtotal</span>
                  <strong>{formatCurrency(totals.subtotal)}</strong>
                </div>
                {discount && (
                  <div>
                    <span>{discount.label}</span>
                    <strong>-{formatCurrency(totals.discount)}</strong>
                  </div>
                )}
                {loyalty?.reward && (
                  <div>
                    <span>{loyalty.reward.name}</span>
                    <strong>-{formatCurrency(totals.loyaltyDiscount)}</strong>
                  </div>
                )}
                {vouchers.length > 0 && (
                  <div>
                    <span>Vouchers ({vouchers.length})</span>
                    <strong>-{formatCurrency(totals.voucherDiscount)}</strong>
                  </div>
                )}
                <div>
                  <span>Total</span>
                  <strong>{formatCurrency(totals.total)}</strong>
                </div>
                {mode === 'cash' && (
                  <div>
                    <span>Change</span>
                    <strong>{formatCurrency(changeDue)}</strong>
                  </div>
                )}
                {mode === 'split' && (
                  <>
                    <div>
                      <span>Cash</span>
                      <strong>{formatCurrency(splitCashAmount)}</strong>
                    </div>
                    {splitCdcAmount > 0 && (
                      <div>
                        <span>CDC voucher</span>
                        <strong>{formatCurrency(splitCdcAmount)}</strong>
                      </div>
                    )}
                    <div>
                      <span>{manualPayNowActive ? 'PayNow (Manual)' : terminalMethodLabel(splitSecondMethod)}</span>
                      <strong>{formatCurrency(splitTerminalAmount)}</strong>
                    </div>
                    {voucherAmount > 0 && (
                      <div>
                        <span>Voucher</span>
                        <strong>{formatCurrency(voucherAmount)}</strong>
                      </div>
                    )}
                  </>
                )}
              </section>
            </div>

            <footer className="sheet-actions">
              <button className="secondary-button" type="button" onClick={handleClose} disabled={submitting}>
                Cancel
              </button>
              {finalizationPending ? (
                <button
                  className="primary-button"
                  type="button"
                  disabled={submitting}
                  onClick={handleRetryFinalization}
                >
                  {submitting ? 'Finalizing…' : 'Retry finalization'}
                </button>
              ) : (
                <button className="primary-button" type="button" disabled={!canComplete} onClick={completePayment}>
                  {paymentActionLabel}
                </button>
              )}
            </footer>
          </>
        ) : step === 'processing' ? (
          <>
            <div className="payment-body">
              {error && <div className="payment-error">{error}</div>}
              <div className="processing-panel" role="status">
                {error ? (
                  <CreditCard size={38} aria-hidden="true" />
                ) : (
                  <Loader2 className="spin-icon" size={38} aria-hidden="true" />
                )}
                <div>
                  <strong>{error ? 'Payment needs attention' : 'Processing payment…'}</strong>
                  <span>{error ? 'Do not retry terminal payment until this order is checked.' : cardPayment?.terminalPaymentMethod === 'paynow' ? 'Customer scans the PayNow QR on the terminal' : 'Tap or insert the card on the terminal'}</span>
                </div>
              </div>
              <section className="payment-summary" aria-label="Terminal payment summary">
                <div>
                  <span>Total</span>
                  <strong>{formatCurrency(totalDue)}</strong>
                </div>
                {cardPayment?.paymentMode === 'split' && (
                  <div>
                    <span>Cash</span>
                    <strong>{formatCurrency(cardPayment.cashAmount)}</strong>
                  </div>
                )}
                {cardPayment?.paymentMode === 'split' && cardPayment.cdcAmount > 0 && (
                  <div>
                    <span>CDC voucher</span>
                    <strong>{formatCurrency(cardPayment.cdcAmount)}</strong>
                  </div>
                )}
                <div>
                  <span>{cardPayment?.paymentMode === 'split' ? terminalMethodLabel(cardPayment.terminalPaymentMethod) : 'Payment'}</span>
                  <strong>
                    {cardPayment?.paymentMode === 'split'
                      ? formatCurrency(cardPayment.cardAmount)
                      : terminalMethodLabel(cardPayment?.terminalPaymentMethod ?? 'card')}
                  </strong>
                </div>
                {cardPayment?.paymentMode === 'split' && cardPayment.voucherAmount > 0 && (
                  <div>
                    <span>Voucher</span>
                    <strong>{formatCurrency(cardPayment.voucherAmount)}</strong>
                  </div>
                )}
              </section>
            </div>

            <footer className="sheet-actions">
              <button className="secondary-button" type="button" disabled>
                Cancel
              </button>
              <button className="primary-button" type="button" disabled>
                Processing payment…
              </button>
            </footer>
          </>
        ) : (
          receipt && (
            <>
              <div className="complete-panel">
                <CheckCircle2 size={40} aria-hidden="true" />
                <div>
                  <h3>Order {receipt.order.order_number}</h3>
                  <p>{formatCurrency(receipt.totals.total)}</p>
                </div>
              </div>

              <section className="receipt-preview" aria-label="Receipt preview" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                <header>
                  <Receipt size={18} aria-hidden="true" />
                  <h3>Receipt</h3>
                </header>
                <div className="receipt-lines">
                  {receipt.items.map((item) => (
                    <div className="receipt-line" key={item.lineId}>
                      <span>{item.quantity} × {item.product.name}</span>
                      <strong>
                        {formatCurrency(
                          (money(item.product.price) +
                            item.modifiers.reduce((sum, modifier) => sum + modifier.price_adjustment, 0)) *
                            item.quantity
                        )}
                      </strong>
                    </div>
                  ))}
                </div>
                <div className="receipt-total">
                  <span>Total</span>
                  <strong>{formatCurrency(receipt.totals.total)}</strong>
                </div>
                <div className="receipt-payment">
                  {receipt.paymentMode === 'split' ? (
                    <>
                      <div>
                        <span>Payment</span>
                        <strong>Split</strong>
                      </div>
                      {receipt.cashAmount > 0 && (
                        <div>
                          <span>Cash</span>
                          <strong>{formatCurrency(receipt.cashAmount)}</strong>
                        </div>
                      )}
                      {receipt.cdcAmount > 0 && (
                        <div>
                          <span>CDC voucher</span>
                          <strong>{formatCurrency(receipt.cdcAmount)}</strong>
                        </div>
                      )}
                      {receipt.cardAmount > 0 && (
                        <div>
                          <span>
                            {receipt.manualPayNow && receipt.terminalPaymentMethod === 'paynow'
                              ? 'PayNow (Manual)'
                              : terminalMethodLabel(receipt.terminalPaymentMethod ?? 'card')}
                          </span>
                          <strong>{formatCurrency(receipt.cardAmount)}</strong>
                        </div>
                      )}
                      {receipt.voucherAmount > 0 && (
                        <div>
                          <span>Voucher</span>
                          <strong>{formatCurrency(receipt.voucherAmount)}</strong>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div>
                        <span>Payment</span>
                        <strong>
                          {receipt.paymentMode === 'paynow' && receipt.manualPayNow
                            ? 'PayNow (Manual)'
                            : paymentModeLabel(receipt.paymentMode)}
                        </strong>
                      </div>
                      {receipt.paymentMode === 'paynow' && receipt.manualPayNow && (
                        <div>
                          <span>Amount</span>
                          <strong>{formatCurrency(receipt.cardAmount)}</strong>
                        </div>
                      )}
                    </>
                  )}
                  {receipt.manualPayNow && (
                    <div>
                      <span>Confirmed</span>
                      <strong>{formatReceiptTime(receipt.paynowConfirmedAt)}</strong>
                    </div>
                  )}
                  {receipt.changeDue > 0 && (
                    <div>
                      <span>Change</span>
                      <strong>{formatCurrency(receipt.changeDue)}</strong>
                    </div>
                  )}
                </div>
                {receipt.vouchers && receipt.vouchers.length > 0 && (
                  <div className="receipt-vouchers" style={{ marginTop: 8, fontSize: '12px', opacity: 0.85 }}>
                    Vouchers redeemed: {formatCurrency(receipt.totals.voucherDiscount || 0)}
                  </div>
                )}
              </section>

              <footer className="sheet-actions">
                {receipt.cardAmount > 0 && voidState !== 'voided' && (
                  <button
                    className="secondary-button danger-text"
                    type="button"
                    onClick={handleVoid}
                    disabled={voidState === 'voiding'}
                  >
                    <Undo2 size={18} aria-hidden="true" />
                    {voidState === 'voiding' ? 'Voiding…' : 'Void payment'}
                  </button>
                )}
                <button className="secondary-button" type="button" onClick={printReceipt}>
                  <Printer size={18} aria-hidden="true" />
                  Print receipt
                </button>
                <button className="primary-button" type="button" onClick={handleClose}>
                  {voidState === 'voided' ? 'Close' : 'New sale'}
                </button>
              </footer>
            </>
          )
        )}
      </section>
    </div>
  );
}

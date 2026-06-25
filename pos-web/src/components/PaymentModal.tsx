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
import { getPaymentStatus, getTerminalConnection, startCardPayment, voidCardPayment, type PaymentIntent } from '@/api/kpayClient';
import type { AppliedVoucher, CartItem, Discount, LoyaltySelection, StaffSession, Totals } from '@/types';
import { tapFeedback } from '@/utils/haptics';
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
    return 'Payment timed out. Try again or choose another payment method.';
  }
  if (status === 'cancelled') {
    return 'Payment cancelled. Try again or choose another payment method.';
  }
  return errorMessage || 'Payment failed. Try again or choose another payment method.';
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

async function tryWebUsbPrint(text: string): Promise<boolean> {
  const usb = (navigator as Navigator & { usb?: any }).usb;
  if (!usb) {
    return false;
  }

  try {
    const device = await usb.requestDevice({ filters: [{ classCode: 7 }] });
    await device.open();
    if (!device.configuration) {
      await device.selectConfiguration(1);
    }
    const selectedInterface = device.configuration.interfaces.find((usbInterface: any) =>
      usbInterface.alternates.some((alternate: any) =>
        alternate.endpoints.some((endpoint: any) => endpoint.direction === 'out')
      )
    );
    const alternate = selectedInterface?.alternates.find((entry: any) =>
      entry.endpoints.some((endpoint: any) => endpoint.direction === 'out')
    );
    const endpoint = alternate?.endpoints.find((entry: any) => entry.direction === 'out');
    if (!selectedInterface || !endpoint) {
      await device.close();
      return false;
    }
    await device.claimInterface(selectedInterface.interfaceNumber);
    const encoder = new TextEncoder();
    const payload = encoder.encode(`${text}\n\n\x1dV\x00`);
    await device.transferOut(endpoint.endpointNumber, payload);
    await device.releaseInterface(selectedInterface.interfaceNumber);
    await device.close();
    return true;
  } catch {
    return false;
  }
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

  const totalDue = roundMoney(totals.total);
  const voucherAmount = roundMoney(totals.voucherDiscount);
  const cashTendered = roundMoney(money(cashAmount));
  // CDC vouchers are a cashier-entered tender; cap at the payable total.
  const splitCdcAmount = mode === 'split' ? roundMoney(Math.min(Math.max(money(cdcAmount), 0), totalDue)) : 0;
  const splitCashCap = roundMoney(Math.max(0, totalDue - splitCdcAmount));
  const splitCashAmount = mode === 'split' ? roundMoney(Math.min(Math.max(cashTendered, 0), splitCashCap)) : 0;
  const splitTerminalAmount = mode === 'split' ? roundMoney(Math.max(0, totalDue - splitCashAmount - splitCdcAmount)) : 0;
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

  useEffect(() => {
    if (!open || step !== 'processing' || !cardPayment) {
      return;
    }

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
        toast.error('Payment timed out');
        failCardPayment('Payment timed out. Try again or choose another payment method.');
        return;
      }

      inFlight = true;
      try {
        const latest = await getPaymentStatus(cardPayment.intentId);
        if (cancelled) {
          return;
        }

        if (latest.status === 'success') {
          clearPolling();
          try {
            const statusPayload =
              cardPayment.paymentMode === 'split'
                ? {
                    status: 'paid' as const,
                    payment_method: 'split',
                    payment_reference: cardPayment.paymentReference,
                    cash_tendered: cardPayment.cashTendered,
                    cash_amount: cardPayment.cashAmount,
                    card_amount: cardPayment.cardAmount,
                    voucher_amount: cardPayment.voucherAmount,
                    cdc_amount: cardPayment.cdcAmount,
                  }
                : {
                    status: 'paid' as const,
                    payment_method: cardPayment.paymentMode,
                    payment_reference: cardPayment.paymentReference,
                  };
            const paidOrder = await updateOrderStatus(cardPayment.order.id, {
              ...statusPayload,
            });
            if (cancelled) {
              return;
            }
            completePaidOrder(paidOrder, cardPayment.paymentMode, {
              terminalPaymentMethod: cardPayment.terminalPaymentMethod,
              cashAmount: cardPayment.cashAmount,
              cardAmount: cardPayment.cardAmount,
              voucherAmount: cardPayment.voucherAmount,
              cdcAmount: cardPayment.cdcAmount,
              changeDue: 0,
            });
            toast.success(`${terminalMethodLabel(cardPayment.terminalPaymentMethod)} payment successful`);
          } catch (err: unknown) {
            if (!cancelled) {
              setError(`Payment approved, but order finalization failed: ${getErrorMessage(err, 'Order finalization failed')}`);
              setCardPayment(null);
              setSubmitting(false);
              toast.error('Payment approved, but order finalization failed');
            }
          }
          return;
        }

        if (latest.status === 'failed' || latest.status === 'timeout' || latest.status === 'cancelled') {
          toast.error(latest.status === 'timeout' ? 'Payment timed out' : 'Payment failed');
          failCardPayment(cardFailureMessage(latest.status, latest.error_message));
        }
      } catch (err: unknown) {
        if (!cancelled) {
          toast.error('Payment status check failed');
          failCardPayment(getErrorMessage(err, 'Payment status check failed. Try again.'));
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
  }, [cardPayment, open, step]);

  if (!open) {
    return null;
  }

  const terminalStatusText =
    manualPayNowActive
      ? 'Terminal offline - Manual PayNow'
      : terminalConnected === null
      ? 'Checking terminal...'
      : terminalConnected
        ? 'Terminal connected ✓'
        : 'Terminal offline';
  const paymentActionLabel = submitting
    ? step === 'processing'
      ? 'Processing payment...'
      : 'Processing...'
    : manualPayNowActive
      ? 'Payment received'
    : requiresTerminal && error && terminalConnected !== false
      ? `Retry ${mode === 'split' ? 'split' : mode === 'paynow' ? 'PayNow' : paymentModeLabel(mode).toLowerCase()} payment`
        : 'Complete payment';

  async function createPendingOrder(
    paymentReference: string,
    voucherCodes: string[] | null,
    paymentMethod: PaymentMode
  ): Promise<OrderRead> {
    const pendingOrder = await createOrder({
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
    });

    if (loyalty?.reward) {
      await redeemLoyalty(loyalty.customer.member_id, pendingOrder.id, loyalty.reward.points);
    }

    // If backend didn't apply via create (older path), ensure applied. Safe no-op if already applied.
    if (voucherCodes && voucherCodes.length > 0 && (!pendingOrder.applied_vouchers || pendingOrder.applied_vouchers.length === 0)) {
      try {
        await applyVouchersToOrder(pendingOrder.id, voucherCodes);
      } catch {
        // ignore - creation path should have handled it
      }
    }

    return pendingOrder;
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

    // Notify customer display (non-blocking)
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
      // ignore - display is optional
    }

    onOrderComplete();
  }

  function renderManualPayNowPanel(amount: number) {
    return (
      <div className="manual-paynow-panel">
        <div className="manual-paynow-banner">
          <QrCode size={18} aria-hidden="true" />
          <span>Terminal offline - Manual PayNow</span>
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

    try {
      const paymentReference = manualPayNowActive ? 'MANUAL' : `POS-${Date.now()}`;
      const voucherCodes = vouchers.length > 0 ? vouchers.map((v) => v.code) : null;

      const pendingOrder = await createPendingOrder(paymentReference, voucherCodes, mode);

      if (manualPayNowActive) {
        const confirmedAt = new Date().toISOString();
        const paidOrder =
          mode === 'split'
            ? await updateOrderStatus(pendingOrder.id, {
                status: 'paid',
                payment_method: 'split',
                payment_reference: paymentReference,
                cash_tendered: splitCashAmount > 0 ? splitCashAmount : undefined,
                cash_amount: splitCashAmount,
                card_amount: splitTerminalAmount,
                voucher_amount: voucherAmount,
                cdc_amount: splitCdcAmount,
                paynow_confirmed_at: confirmedAt,
              })
            : await updateOrderStatus(pendingOrder.id, {
                status: 'paid',
                payment_method: 'paynow',
                payment_reference: paymentReference,
                paynow_confirmed_at: confirmedAt,
              });

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
        const paymentAmount = mode === 'split' ? splitTerminalAmount : totalDue;
        try {
          const intent = await startCardPayment(pendingOrder.id, paymentAmount);
          setTerminalConnected(true);
          setCardPayment({
            order: pendingOrder,
            intentId: intent.id,
            paymentReference,
            paymentMode: mode === 'split' ? 'split' : mode,
            terminalPaymentMethod: terminalMethod,
            cashAmount: mode === 'split' ? splitCashAmount : 0,
            cardAmount: paymentAmount,
            voucherAmount: mode === 'split' ? voucherAmount : 0,
            cdcAmount: mode === 'split' ? splitCdcAmount : 0,
            cashTendered: mode === 'split' && splitCashAmount > 0 ? splitCashAmount : undefined,
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

      const paidOrder =
        mode === 'split'
          ? await updateOrderStatus(pendingOrder.id, {
              status: 'paid',
              payment_method: 'split',
              payment_reference: paymentReference,
              cash_tendered: splitCashAmount > 0 ? splitCashAmount : undefined,
              cash_amount: splitCashAmount,
              card_amount: 0,
              voucher_amount: voucherAmount,
              cdc_amount: splitCdcAmount,
            })
          : await updateOrderStatus(pendingOrder.id, {
              status: 'paid',
              payment_method: mode,
              payment_reference: paymentReference,
              cash_tendered: mode === 'cash' ? cashTendered : undefined,
            });

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
    const printed = await tryWebUsbPrint(text);
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
            onClick={onClose}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        {step === 'payment' ? (
          <>
            <div className="payment-modes" role="tablist" aria-label="Payment mode">
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
                  role="tab"
                  aria-selected={mode === value}
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
                          : 'Tap to pay'}
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
              <button className="secondary-button" type="button" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button className="primary-button" type="button" disabled={!canComplete} onClick={completePayment}>
                {paymentActionLabel}
              </button>
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
                  <strong>{error ? 'Payment needs attention' : 'Processing payment...'}</strong>
                  <span>{error ? 'Do not retry terminal payment until this order is checked.' : 'Waiting for terminal approval'}</span>
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
                Processing payment...
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
                      <span>{item.quantity} x {item.product.name}</span>
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
                    {voidState === 'voiding' ? 'Voiding...' : 'Void payment'}
                  </button>
                )}
                <button className="secondary-button" type="button" onClick={printReceipt}>
                  <Printer size={18} aria-hidden="true" />
                  Print receipt
                </button>
                <button className="primary-button" type="button" onClick={onClose}>
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

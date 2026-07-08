import { useEffect, useRef, useState } from 'react';
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
import QRCode from 'qrcode';
import CashTenderPad from '@/components/CashTenderPad';
import { tapFeedback } from '@/utils/haptics';
import { buildPayNowPayload, MANUAL_PAYNOW_REFERENCE } from '@/utils/paynow';
import { newIdempotencyKey } from '@/utils/idempotency';
import { isPrintingSupported, openCashDrawer, printKitchenChit, printReceipt as printReceiptUsb } from '@/utils/printer';
import {
  buildChit,
  buildReceiptText,
  formatReceiptTime,
  receiptSnapshotToPrintableOrder,
} from '@/utils/receipt';
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

/** Plan B: POS doesn't drive the KPay terminal; staff key card amounts in
 * manually and confirm. Toggle in Settings. */
export function manualTerminalEnabled(): boolean {
  try {
    return localStorage.getItem('grid_pos_manual_terminal') === '1';
  } catch {
    return false;
  }
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
  // Forces the direct-to-bank PayNow QR even when the terminal is online — the
  // explicit "Manual PayNow" fallback the cashier can pick at will.
  const [forceManualPayNow, setForceManualPayNow] = useState(false);

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
  // Lets the cashier abort a terminal payment (during the blocking /start call
  // or while polling) instead of being trapped on the processing screen. The
  // backend retry-gate + daemon reconciliation loop make an abort safe: the
  // intent self-heals to its true state and blocks a double-charge on retry.
  const cardAbortRef = useRef<AbortController | null>(null);
  const [canAbortTerminal, setCanAbortTerminal] = useState(false);
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
      setForceManualPayNow(false);
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
  // Manual terminal mode (Plan B / go-live without KPay API integration): the
  // POS does NOT drive the terminal. Staff key the amount into the KPay terminal
  // themselves and confirm; PayNow uses our self-generated QR. Toggle in
  // Settings (localStorage 'grid_pos_manual_terminal').
  const manualTerminal = manualTerminalEnabled();
  // Manual PayNow (direct-to-bank QR) is used when the terminal is offline, when
  // the cashier picks Manual QR, or whenever manual terminal mode is on.
  const manualPayNowActive =
    manualPayNowEligible && (terminalConnected === false || forceManualPayNow || manualTerminal);
  const manualPayNowReady = manualPayNowActive && !payNowQrLoading && Boolean(payNowQrUrl);
  // Manual card: staff enter the amount on the terminal, then confirm here.
  const manualCardActive =
    manualTerminal &&
    (mode === 'card' || (mode === 'split' && splitSecondMethod === 'card' && splitTerminalAmount > 0));
  const terminalUnavailable =
    !manualTerminal &&
    terminalConnected === false &&
    (mode === 'card' || (mode === 'split' && splitSecondMethod === 'card' && splitTerminalAmount > 0));
  const requiresTerminal =
    !manualTerminal &&
    (mode === 'card' ||
      (mode === 'paynow' && !manualPayNowActive) ||
      (mode === 'split' &&
        splitTerminalAmount > 0 &&
        (splitSecondMethod === 'card' || !manualPayNowActive)));
  const changeDue = mode === 'cash' ? roundMoney(Math.max(0, cashTendered - totalDue)) : 0;
  const cashDue = mode === 'cash' ? totalDue : splitCashAmount;

  const canComplete =
    items.length > 0 &&
    !submitting &&
    ((mode === 'card' && (manualTerminal || terminalConnected !== false)) ||
      (mode === 'paynow' && (manualPayNowActive ? manualPayNowReady : terminalConnected !== false)) ||
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

    // Preferred: generate a dynamic PayNow QR with the exact amount and a
    // fixed reference, so the customer cannot mistype the amount. Falls back
    // to the outlet's uploaded static QR image when no UEN is configured.
    const uen = session.outlet.paynow_uen?.trim();
    if (uen && manualPayNowAmount > 0) {
      const payload = buildPayNowPayload({
        uen,
        amount: manualPayNowAmount,
        merchantName: session.outlet.receipt_brand_name || session.outlet.name,
        reference: MANUAL_PAYNOW_REFERENCE,
      });
      QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 2, width: 480 })
        .then((dataUrl) => {
          if (!cancelled) {
            setPayNowQrUrl(dataUrl);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setPayNowQrUrl(null);
            setPayNowQrError('Manual PayNow QR code could not be generated');
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
    }

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
  }, [manualPayNowActive, manualPayNowAmount, open, session.outlet, step]);

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
    if (snapshot.cashAmount > 0 || snapshot.changeDue > 0 || paidMode === 'cash') {
      void openCashDrawer().then((ok) => {
        if (!ok) {
          toast.error('Cash drawer did not open');
        }
      });
    }
    // Auto-send the kitchen chit on completion (kitchen starts prep immediately).
    // Disable per-till with localStorage grid_pos_auto_chit = '0'.
    let autoChit = true;
    try {
      autoChit = localStorage.getItem('grid_pos_auto_chit') !== '0';
    } catch {
      autoChit = true;
    }
    if (autoChit && snapshot.items.length > 0) {
      void printKitchenChit(buildChit(receiptSnapshotToPrintableOrder(snapshot, session)));
    }
    setStep('complete');
    setCardPayment(null);
    setSubmitting(false);
    setCanAbortTerminal(false);
    cardAbortRef.current = null;
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

  function abortTerminalPayment() {
    tapFeedback();
    cardAbortRef.current?.abort();
    cardAbortRef.current = null;
    setCanAbortTerminal(false);
    setCardPayment(null);
    setStep('payment');
    setSubmitting(false);
    setError('Terminal payment cancelled. If the customer may have been charged, query the terminal before retrying.');
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
      setCanAbortTerminal(false);
      cardAbortRef.current = null;
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
    manualTerminal
      ? 'Manual terminal mode — key amount into the KPay terminal'
      : manualPayNowActive
      ? forceManualPayNow
        ? 'Manual PayNow – pay to bank QR'
        : 'Terminal offline – Manual PayNow'
      : terminalConnected === null
      ? 'Checking terminal…'
      : terminalConnected
        ? 'Terminal connected'
        : 'Terminal offline';
  const paymentActionLabel = submitting
    ? step === 'processing'
      ? 'Processing payment…'
      : 'Processing…'
    : manualCardActive
      ? 'Card received'
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
          <span>{forceManualPayNow ? 'Manual PayNow' : 'Terminal offline – Manual PayNow'}</span>
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
      const paymentReference =
        manualPayNowActive || manualCardActive ? 'MANUAL' : `POS-${checkoutIdempotencyKey.slice(0, 8)}`;
      const voucherCodes = vouchers.length > 0 ? vouchers.map((v) => v.code) : null;

      const order = await ensurePendingOrder(paymentReference, voucherCodes, mode);

      // Manual-confirm tender: manual PayNow (self-QR) or manual card (staff key
      // the amount into the terminal). Either way we mark the order paid with no
      // daemon/terminal call.
      if (manualPayNowActive || manualCardActive) {
        const isPayNow = manualPayNowActive;
        const confirmedAt = isPayNow ? new Date().toISOString() : null;
        const singleMethod = mode === 'paynow' ? 'paynow' : 'card';
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
                  ...(confirmedAt ? { paynow_confirmed_at: confirmedAt } : {}),
                },
                { idempotencyKey: markPaidIdempotencyKey }
              )
            : await updateOrderStatus(
                order.id,
                {
                  status: 'paid',
                  payment_method: singleMethod,
                  payment_reference: paymentReference,
                  ...(confirmedAt ? { paynow_confirmed_at: confirmedAt } : {}),
                },
                { idempotencyKey: markPaidIdempotencyKey }
              );

        completePaidOrder(paidOrder, mode, {
          terminalPaymentMethod: isPayNow ? 'paynow' : 'card',
          cashAmount: mode === 'split' ? splitCashAmount : 0,
          cardAmount: mode === 'split' ? splitTerminalAmount : totalDue,
          voucherAmount: mode === 'split' ? voucherAmount : 0,
          cdcAmount: mode === 'split' ? splitCdcAmount : 0,
          changeDue: 0,
          manualPayNow: isPayNow,
          paynowConfirmedAt: confirmedAt ?? undefined,
        });
        toast.success(isPayNow ? 'Manual PayNow confirmed' : 'Card payment recorded');
        return;
      }

      if (requiresTerminal && (mode === 'card' || mode === 'paynow' || (mode === 'split' && splitTerminalAmount > 0))) {
        const paymentAmount = mode === 'split' ? splitTerminalAmountRaw : payableTotal;
        const kpayPaymentType = terminalMethod === 'paynow' ? 13 : 1;
        const nextAttempt = kpayAttemptNumber + 1;
        const controller = new AbortController();
        cardAbortRef.current = controller;
        setCanAbortTerminal(true);
        try {
          const intent = await startCardPayment(order.id, paymentAmount, kpayPaymentType, {
            idempotencyKey: `${order.id}-kpay-${nextAttempt}`,
            cashAmount: mode === 'split' ? splitCashAmountRaw : undefined,
            cdcAmount: mode === 'split' ? splitCdcAmountRaw : undefined,
            signal: controller.signal,
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
          // Cashier hit Cancel mid-request — abortTerminalPayment already
          // reset the UI; don't clobber it with an error banner.
          if (controller.signal.aborted) {
            return;
          }
          if (getHttpStatus(err) === 503) {
            setTerminalConnected(false);
            setError('Payment terminal offline');
            toast.error('Payment terminal offline');
          } else {
            setError(getErrorMessage(err));
          }
          setSubmitting(false);
          setCanAbortTerminal(false);
          cardAbortRef.current = null;
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
    const text = buildReceiptText(receiptSnapshotToPrintableOrder(receipt, session));
    const printed = await printReceiptUsb(text);
    if (printed) {
      toast.success('Receipt sent to printer');
    } else {
      toast.error('Receipt print failed — receipt preview is below');
    }
  }

  async function printChit() {
    if (!receipt) {
      return;
    }
    tapFeedback();
    const printed = await printKitchenChit(buildChit(receiptSnapshotToPrintableOrder(receipt, session)));
    if (printed) {
      toast.success('Kitchen chit sent');
    } else {
      toast.error('Kitchen chit print failed');
    }
  }

  function handleOpenDrawer() {
    tapFeedback();
    void openCashDrawer().then((ok) => {
      if (!ok) {
        toast.error('Cash drawer did not open');
      }
    });
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
                { key: 'cash', label: 'Cash', Icon: Banknote, active: mode === 'cash', select: () => { setMode('cash'); setForceManualPayNow(false); } },
                { key: 'card', label: 'Card', Icon: CreditCard, active: mode === 'card', select: () => { setMode('card'); setForceManualPayNow(false); } },
                { key: 'paynow', label: 'PayNow', Icon: QrCode, active: mode === 'paynow' && (manualTerminal || !forceManualPayNow), select: () => { setMode('paynow'); setForceManualPayNow(false); } },
                // In manual terminal mode PayNow already IS the self-generated QR,
                // so the separate "Manual QR" mode is a duplicate — hide it.
                ...(manualTerminal
                  ? []
                  : [{ key: 'manual_paynow', label: 'Manual QR', Icon: QrCode, active: mode === 'paynow' && forceManualPayNow, select: () => { setMode('paynow'); setForceManualPayNow(true); } }]),
                { key: 'split', label: 'Split', Icon: Split, active: mode === 'split', select: () => { setMode('split'); setForceManualPayNow(false); } },
              ].map(({ key, label, Icon, active, select }) => (
                <button
                  key={key}
                  className={active ? 'active' : ''}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={submitting}
                  onPointerDown={() => tapFeedback()}
                  onClick={select}
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
                <CashTenderPad
                  value={cashAmount}
                  totalDue={totalDue}
                  changeDue={changeDue}
                  disabled={submitting}
                  onChange={setCashAmount}
                />
              )}

              {(mode === 'card' || mode === 'paynow') && (
                mode === 'paynow' && manualPayNowActive ? (
                  renderManualPayNowPanel(totalDue)
                ) : manualCardActive ? (
                  <div className="terminal-panel">
                    <CreditCard size={32} aria-hidden="true" />
                    <strong>{formatCurrency(totalDue)}</strong>
                    <span>Enter this amount on the KPay terminal, then press “Card received”.</span>
                  </div>
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
              <button
                className={canAbortTerminal ? 'secondary-button danger-text' : 'secondary-button'}
                type="button"
                onClick={canAbortTerminal ? abortTerminalPayment : handleClose}
                disabled={submitting && !canAbortTerminal}
              >
                {canAbortTerminal ? 'Cancel payment' : 'Cancel'}
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
              <button className="secondary-button danger-text" type="button" onClick={abortTerminalPayment}>
                Cancel payment
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
                {isPrintingSupported() && (
                  <button className="secondary-button" type="button" onClick={handleOpenDrawer}>
                    <Banknote size={18} aria-hidden="true" />
                    Open drawer
                  </button>
                )}
                <button className="secondary-button" type="button" onClick={printChit}>
                  <Receipt size={18} aria-hidden="true" />
                  Kitchen chit
                </button>
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

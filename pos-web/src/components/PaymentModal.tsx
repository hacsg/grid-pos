import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CreditCard, Loader2, Printer, Receipt, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  applyVouchersToOrder,
  createOrder,
  formatCurrency,
  money,
  redeemLoyalty,
  updateOrderStatus,
  type OrderRead,
} from '@/api/client';
import { getPaymentStatus, getTerminalConnection, startCardPayment, type PaymentIntent } from '@/api/kpayClient';
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

type PaymentMode = 'cash' | 'card' | 'split';
type PaymentStep = 'payment' | 'processing' | 'complete';

const CARD_POLL_INTERVAL_MS = 2000;
const CARD_POLL_TIMEOUT_MS = 95000;

interface ReceiptSnapshot {
  order: OrderRead;
  items: CartItem[];
  totals: Totals;
  vouchers: AppliedVoucher[];
  paymentMode: PaymentMode;
  cashAmount: number;
  cardAmount: number;
  changeDue: number;
}

interface CardPaymentSession {
  order: OrderRead;
  intentId: string;
  paymentReference: string;
  startedAt: number;
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
    `Payment ${receipt.paymentMode}`,
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
  const [cashAmount, setCashAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptSnapshot | null>(null);
  const [error, setError] = useState('');
  const [terminalConnected, setTerminalConnected] = useState<boolean | null>(null);
  const [cardPayment, setCardPayment] = useState<CardPaymentSession | null>(null);

  useEffect(() => {
    if (!open) {
      setStep('payment');
      setMode('cash');
      setCashAmount('');
      setSubmitting(false);
      setReceipt(null);
      setError('');
      setTerminalConnected(null);
      setCardPayment(null);
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

  useEffect(() => {
    if (mode === 'split') {
      setError('Split payment coming soon');
      return;
    }
    if (mode === 'card' && terminalConnected === false) {
      setError('Payment terminal offline');
      return;
    }
    setError('');
  }, [mode, cashAmount, terminalConnected]);

  const cashTendered = money(cashAmount);
  const cardAmount = useMemo(() => {
    if (mode === 'card') {
      return totals.total;
    }
    return 0;
  }, [mode, totals.total]);
  const changeDue = mode === 'cash' ? Math.max(0, cashTendered - totals.total) : 0;
  const cashDue = mode === 'cash' ? totals.total : Math.min(cashTendered, totals.total);

  const canComplete =
    items.length > 0 &&
    !submitting &&
    (mode === 'card' ||
      (mode === 'cash' && cashTendered >= totals.total));

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
            const paidOrder = await updateOrderStatus(cardPayment.order.id, {
              status: 'paid',
              payment_method: 'card',
              payment_reference: cardPayment.paymentReference,
            });
            if (cancelled) {
              return;
            }
            completePaidOrder(paidOrder, 'card');
            toast.success('Payment successful');
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
    terminalConnected === null
      ? 'Checking terminal...'
      : terminalConnected
        ? 'Terminal connected ✓'
        : 'Terminal offline';
  const paymentActionLabel = submitting
    ? step === 'processing'
      ? 'Processing payment...'
      : 'Processing...'
    : mode === 'split'
      ? 'Split coming soon'
      : mode === 'card' && error && terminalConnected !== false
        ? 'Retry card payment'
        : 'Complete payment';

  async function createPendingOrder(paymentReference: string, voucherCodes: string[] | null): Promise<OrderRead> {
    const pendingOrder = await createOrder({
      outlet_id: session.outlet.id,
      staff_id: session.staff.id,
      status: 'pending',
      payment_method: mode,
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

  function completePaidOrder(paidOrder: OrderRead, paidMode: PaymentMode) {
    const snapshot: ReceiptSnapshot = {
      order: paidOrder,
      items,
      totals,
      vouchers,
      paymentMode: paidMode,
      cashAmount: paidMode === 'cash' ? cashDue : 0,
      cardAmount: paidMode === 'card' ? totals.total : cardAmount,
      changeDue: paidMode === 'cash' ? changeDue : 0,
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

  async function completePayment() {
    if (mode === 'split') {
      setError('Split payment coming soon');
      return;
    }
    if (!canComplete) {
      return;
    }
    if (mode === 'card' && terminalConnected === false) {
      setError('Payment terminal offline');
      toast.error('Payment terminal offline');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const paymentReference = `POS-${Date.now()}`;
      const voucherCodes = vouchers.length > 0 ? vouchers.map((v) => v.code) : null;

      const pendingOrder = await createPendingOrder(paymentReference, voucherCodes);

      if (mode === 'card') {
        try {
          const intent = await startCardPayment(pendingOrder.id, totals.total);
          setTerminalConnected(true);
          setCardPayment({
            order: pendingOrder,
            intentId: intent.id,
            paymentReference,
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

      const paidOrder = await updateOrderStatus(pendingOrder.id, {
        status: 'paid',
        payment_method: mode,
        payment_reference: paymentReference,
        cash_tendered: mode === 'cash' ? cashTendered : undefined,
      });

      completePaidOrder(paidOrder, mode);
      toast.success('Order paid');
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      setSubmitting(false);
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
            <p>{step === 'complete' ? 'Complete' : step === 'processing' ? 'Card payment' : 'Payment'}</p>
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
              {(['cash', 'card', 'split'] as const).map((paymentMode) => (
                <button
                  key={paymentMode}
                  className={mode === paymentMode ? 'active' : ''}
                  type="button"
                  role="tab"
                  aria-selected={mode === paymentMode}
                  disabled={submitting}
                  onPointerDown={() => tapFeedback()}
                  onClick={() => setMode(paymentMode)}
                >
                  {paymentMode === 'card' && <CreditCard size={18} aria-hidden="true" />}
                  {paymentMode}
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

              {mode === 'card' && (
                <div className="terminal-panel">
                  <CreditCard size={32} aria-hidden="true" />
                  <strong>{formatCurrency(totals.total)}</strong>
                  <span>{terminalConnected === false ? 'Terminal offline' : 'Tap to pay'}</span>
                </div>
              )}

              {mode === 'split' && (
                <div className="split-coming-soon">
                  <strong>Split payment coming soon</strong>
                  <span>Use cash or card for this order.</span>
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
                  <span>{error ? 'Do not retry card payment until this order is checked.' : 'Waiting for terminal approval'}</span>
                </div>
              </div>
              <section className="payment-summary" aria-label="Card payment summary">
                <div>
                  <span>Total</span>
                  <strong>{formatCurrency(totals.total)}</strong>
                </div>
                <div>
                  <span>Payment</span>
                  <strong>Card</strong>
                </div>
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
                {receipt.vouchers && receipt.vouchers.length > 0 && (
                  <div className="receipt-vouchers" style={{ marginTop: 8, fontSize: '12px', opacity: 0.85 }}>
                    Vouchers redeemed: {formatCurrency(receipt.totals.voucherDiscount || 0)}
                  </div>
                )}
              </section>

              <footer className="sheet-actions">
                <button className="secondary-button" type="button" onClick={printReceipt}>
                  <Printer size={18} aria-hidden="true" />
                  Print receipt
                </button>
                <button className="primary-button" type="button" onClick={onClose}>
                  New sale
                </button>
              </footer>
            </>
          )
        )}
      </section>
    </div>
  );
}

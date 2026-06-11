import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CreditCard, Printer, Receipt, X } from 'lucide-react';
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
type PaymentStep = 'payment' | 'complete';

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
  const [splitCashAmount, setSplitCashAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptSnapshot | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setStep('payment');
      setMode('cash');
      setCashAmount('');
      setSplitCashAmount('');
      setSubmitting(false);
      setReceipt(null);
      setError('');
    }
  }, [open]);

  useEffect(() => {
    setError('');
  }, [mode, cashAmount, splitCashAmount]);

  const cashTendered = mode === 'split' ? money(splitCashAmount) : money(cashAmount);
  const cardAmount = useMemo(() => {
    if (mode === 'card') {
      return totals.total;
    }
    if (mode === 'split') {
      return Math.max(0, totals.total - cashTendered);
    }
    return 0;
  }, [cashTendered, mode, totals.total]);
  const changeDue = mode === 'cash' ? Math.max(0, cashTendered - totals.total) : 0;
  const cashDue = mode === 'cash' ? totals.total : Math.min(cashTendered, totals.total);
  const splitCashPortion = mode === 'split' ? totals.total - cardAmount : 0;
  const splitChangeDue = mode === 'split' ? Math.max(0, cashTendered - splitCashPortion) : 0;

  if (!open) {
    return null;
  }

  const canComplete =
    items.length > 0 &&
    !submitting &&
    (mode === 'card' ||
      (mode === 'cash' && cashTendered >= totals.total) ||
      (mode === 'split' && cashTendered > 0 && cashTendered < totals.total));

  async function completePayment() {
    if (!canComplete) {
      return;
    }
    try {
      setSubmitting(true);
      const paymentReference = `POS-${Date.now()}`;
      const voucherCodes = vouchers.length > 0 ? vouchers.map((v) => v.code) : null;

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
          // ignore — creation path should have handled it
        }
      }

      const paidOrder = await updateOrderStatus(pendingOrder.id, {
        status: 'paid',
        payment_method: mode,
        payment_reference: paymentReference,
      });

      const snapshot: ReceiptSnapshot = {
        order: paidOrder,
        items,
        totals,
        vouchers,
        paymentMode: mode,
        cashAmount: cashDue,
        cardAmount,
        changeDue,
      };
      setReceipt(snapshot);
      setStep('complete');

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
        // ignore — display is optional
      }

      onOrderComplete();
      toast.success('Order paid');
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail ??
        (err as Error)?.message ??
        'Payment failed';
      setError(typeof detail === 'string' ? detail : 'Payment failed');
    } finally {
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
            <p>{step === 'complete' ? 'Complete' : 'Payment'}</p>
            <h2 id="payment-title">{step === 'complete' ? 'Order complete' : formatCurrency(totals.total)}</h2>
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
                  onPointerDown={() => tapFeedback()}
                  onClick={() => setMode(paymentMode)}
                >
                  {paymentMode === 'card' && <CreditCard size={18} aria-hidden="true" />}
                  {paymentMode}
                </button>
              ))}
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
                  <span>Tap to pay</span>
                </div>
              )}

              {mode === 'split' && (
                <div className="split-fields">
                  <label className="amount-field">
                    Cash
                    <input
                      value={splitCashAmount}
                      onChange={(event) => setSplitCashAmount(event.target.value)}
                      inputMode="decimal"
                      autoFocus
                    />
                  </label>
                  <div className="split-card-due">
                    <span>Card</span>
                    <strong>{formatCurrency(cardAmount)}</strong>
                  </div>
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
                {mode === 'split' && cashTendered > splitCashPortion && (
                  <div>
                    <span>Change due</span>
                    <strong>{formatCurrency(splitChangeDue)}</strong>
                  </div>
                )}
              </section>
            </div>

            <footer className="sheet-actions">
              <button className="secondary-button" type="button" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button className="primary-button" type="button" disabled={!canComplete} onClick={completePayment}>
                {submitting ? 'Processing...' : 'Complete payment'}
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

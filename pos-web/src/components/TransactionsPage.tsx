import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2, Printer, Receipt, RotateCcw, Undo2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  formatCurrency,
  getOrder,
  getOrderRefunds,
  getTodayOrders,
  listOrders,
  money,
  type OrderRead,
  type OrderSummaryRead,
  type RefundRead,
  type StaffRole,
} from '@/api/client';
import { refundCardPayment, voidCardPayment } from '@/api/kpayClient';
import type { StaffSession } from '@/types';
import { tapFeedback } from '@/utils/haptics';
import { MANUAL_PAYNOW_REFERENCE } from '@/utils/paynow';
import { printKitchenChit, printReceipt } from '@/utils/printer';
import { buildChit, buildReceiptText, orderReadToPrintableOrder } from '@/utils/receipt';

const MANAGER_ROLES: StaffRole[] = ['admin', 'manager', 'supervisor'];

interface TransactionsPageProps {
  session: StaffSession;
}

type ConfirmAction = 'void' | 'refund' | null;

function todaySgtDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

function formatOrderTime(createdAt: string): string {
  return new Date(createdAt).toLocaleTimeString('en-SG', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Singapore',
  });
}

function paymentMethodLabel(method: string | null): string {
  if (!method) return '—';
  if (method === 'paynow') return 'PayNow';
  if (method === 'split') return 'Split';
  return method.charAt(0).toUpperCase() + method.slice(1);
}

function statusBadgeClass(status: string): string {
  if (status === 'paid') return 'txn-status txn-status-paid';
  if (status === 'refunded') return 'txn-status txn-status-refunded';
  if (status === 'cancelled') return 'txn-status txn-status-cancelled';
  return 'txn-status txn-status-pending';
}

function isManager(role: StaffRole): boolean {
  return MANAGER_ROLES.includes(role);
}

function isTerminalReversible(order: OrderSummaryRead | OrderRead): boolean {
  const method = order.payment_method;
  if (!method || method === 'cash') return false;
  if (method === 'paynow' && order.payment_reference === MANUAL_PAYNOW_REFERENCE) return false;
  if (method === 'card') return true;
  if (method === 'paynow') return true;
  if (method === 'split') return money(order.card_amount) > 0;
  return false;
}

function isPaidToday(createdAt: string): boolean {
  const orderDay = new Date(createdAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
  return orderDay === todaySgtDate();
}

function getErrorDetail(err: unknown, fallback: string): string {
  const detail =
    (err as { response?: { data?: { detail?: unknown; message?: unknown } } })?.response?.data?.detail ??
    (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message ??
    (err as Error)?.message ??
    fallback;
  return typeof detail === 'string' ? detail : fallback;
}

export default function TransactionsPage({ session }: TransactionsPageProps) {
  const [orders, setOrders] = useState<OrderSummaryRead[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState('');
  const [dateFrom, setDateFrom] = useState(todaySgtDate());
  const [dateTo, setDateTo] = useState(todaySgtDate());
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderRead | null>(null);
  const [refunds, setRefunds] = useState<RefundRead[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const manager = isManager(session.staff.role);

  const loadOrders = useCallback(async () => {
    setLoadingList(true);
    setListError('');
    try {
      const isTodayOnly = dateFrom === todaySgtDate() && dateTo === todaySgtDate();
      const data = isTodayOnly
        ? await getTodayOrders(session.outlet.id)
        : await listOrders({
            date_from: dateFrom,
            date_to: dateTo,
            outlet_id: session.outlet.id,
            limit: 500,
          });
      setOrders(data);
    } catch (err) {
      setListError(getErrorDetail(err, 'Could not load orders'));
      setOrders([]);
    } finally {
      setLoadingList(false);
    }
  }, [dateFrom, dateTo, session.outlet.id]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const filteredOrders = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return orders;
    return orders.filter((order) => order.order_number.toLowerCase().includes(query));
  }, [orders, searchQuery]);

  const refreshDetail = useCallback(async (orderId: string) => {
    const [order, refundList] = await Promise.all([getOrder(orderId), getOrderRefunds(orderId)]);
    setDetail(order);
    setRefunds(refundList);
    return order;
  }, []);

  async function openDetail(orderId: string) {
    tapFeedback();
    setSelectedId(orderId);
    setLoadingDetail(true);
    setDetail(null);
    setRefunds([]);
    try {
      await refreshDetail(orderId);
    } catch (err) {
      toast.error(getErrorDetail(err, 'Could not load order'));
      setSelectedId(null);
    } finally {
      setLoadingDetail(false);
    }
  }

  function closeDetail() {
    tapFeedback();
    setSelectedId(null);
    setDetail(null);
    setRefunds([]);
    setConfirmAction(null);
    setRefundAmount('');
  }

  async function handleReprintChit() {
    if (!detail) return;
    tapFeedback();
    try {
      const printable = orderReadToPrintableOrder(detail, session);
      const printed = await printKitchenChit(buildChit(printable));
      if (printed) {
        toast.success('Kitchen chit sent');
      } else {
        toast.error('Kitchen chit print failed');
      }
    } catch (err) {
      toast.error(getErrorDetail(err, 'Kitchen chit print failed'));
    }
  }

  async function handleReprintReceipt() {
    if (!detail) return;
    tapFeedback();
    try {
      const text = buildReceiptText(orderReadToPrintableOrder(detail, session));
      const printed = await printReceipt(text);
      if (printed) {
        toast.success('Receipt sent to printer');
      } else {
        toast.error('Receipt print failed');
      }
    } catch (err) {
      toast.error(getErrorDetail(err, 'Receipt print failed'));
    }
  }

  function openConfirm(action: ConfirmAction) {
    tapFeedback();
    if (!detail) return;
    setConfirmAction(action);
    if (action === 'refund') {
      setRefundAmount(String(money(detail.total)));
    }
  }

  async function handleConfirmAction() {
    if (!detail || !confirmAction) return;
    setActionBusy(true);
    try {
      if (confirmAction === 'void') {
        const result = await voidCardPayment(detail.id);
        if (result.result !== 'ok') {
          toast.error(result.message || 'Void failed');
          return;
        }
        toast.success('Payment voided');
      } else {
        const parsed = refundAmount.trim() ? money(refundAmount) : undefined;
        const result = await refundCardPayment(detail.id, parsed);
        if (result.result !== 'ok') {
          toast.error(result.message || 'Refund failed');
          return;
        }
        toast.success('Refund processed');
      }
      await refreshDetail(detail.id);
      await loadOrders();
      setConfirmAction(null);
      setRefundAmount('');
    } catch (err) {
      toast.error(getErrorDetail(err, confirmAction === 'void' ? 'Void failed' : 'Refund failed'));
    } finally {
      setActionBusy(false);
    }
  }

  const showVoid =
    manager &&
    detail &&
    detail.status === 'paid' &&
    isTerminalReversible(detail) &&
    isPaidToday(detail.created_at ?? '');

  const showRefund =
    manager &&
    detail &&
    detail.status === 'paid' &&
    isTerminalReversible(detail);

  if (selectedId) {
    return (
      <div className="transactions-page">
        <header className="transactions-header">
          <button className="secondary-button txn-back" type="button" onClick={closeDetail}>
            <ArrowLeft size={18} aria-hidden="true" />
            Back
          </button>
          <h1>Order {detail?.order_number ?? '…'}</h1>
        </header>

        {loadingDetail || !detail ? (
          <div className="transactions-loading">
            <Loader2 className="spin-icon" size={28} aria-hidden="true" />
            <span>Loading order…</span>
          </div>
        ) : (
          <div className="transactions-detail">
            <section className="txn-card">
              <div className="txn-meta-row">
                <span className={statusBadgeClass(detail.status)}>{detail.status}</span>
                <span className="txn-meta-time">{formatOrderTime(detail.created_at ?? '')}</span>
              </div>
              <p className="txn-meta-payment">
                {paymentMethodLabel(detail.payment_method)}
                {detail.payment_reference ? ` · ${detail.payment_reference}` : ''}
              </p>
            </section>

            <section className="txn-card">
              <h2>Items</h2>
              <ul className="txn-item-list">
                {detail.items.map((item) => (
                  <li key={item.id} className="txn-item-row">
                    <div className="txn-item-main">
                      <span className="txn-item-qty">{item.quantity}×</span>
                      <span className="txn-item-name">{item.product_name}</span>
                      <span className="txn-item-total">{formatCurrency(money(item.unit_price) * item.quantity)}</span>
                    </div>
                    {item.modifiers.length > 0 && (
                      <ul className="txn-modifier-list">
                        {item.modifiers.map((modifier, index) => (
                          <li key={`${item.id}-${index}`}>{modifier.modifier_name}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section className="txn-card">
              <h2>Payment</h2>
              <dl className="txn-breakdown">
                <div><dt>Total</dt><dd>{formatCurrency(detail.total)}</dd></div>
                {money(detail.cash_amount) > 0 && (
                  <div><dt>Cash</dt><dd>{formatCurrency(detail.cash_amount)}</dd></div>
                )}
                {money(detail.card_amount) > 0 && (
                  <div><dt>Card / PayNow</dt><dd>{formatCurrency(detail.card_amount)}</dd></div>
                )}
                {money(detail.cdc_amount) > 0 && (
                  <div><dt>CDC voucher</dt><dd>{formatCurrency(detail.cdc_amount)}</dd></div>
                )}
                {money(detail.voucher_amount) > 0 && (
                  <div><dt>Voucher</dt><dd>{formatCurrency(detail.voucher_amount)}</dd></div>
                )}
                {money(detail.cash_change) > 0 && (
                  <div><dt>Change</dt><dd>{formatCurrency(detail.cash_change)}</dd></div>
                )}
              </dl>
            </section>

            {refunds.length > 0 && (
              <section className="txn-card">
                <h2>Refunds</h2>
                <ul className="txn-refund-list">
                  {refunds.map((refund) => (
                    <li key={refund.id}>
                      <span>{formatCurrency(refund.amount)}</span>
                      <span className="txn-refund-kind">{refund.kind}</span>
                      {refund.reason && <span className="txn-refund-reason">{refund.reason}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="txn-actions">
              <button className="primary-button txn-action-btn" type="button" onClick={() => void handleReprintChit()}>
                <Printer size={18} aria-hidden="true" />
                Reprint chit
              </button>
              <button className="secondary-button txn-action-btn" type="button" onClick={() => void handleReprintReceipt()}>
                <Receipt size={18} aria-hidden="true" />
                Reprint receipt
              </button>
              {showVoid && (
                <button className="danger-button txn-action-btn" type="button" onClick={() => openConfirm('void')}>
                  <Undo2 size={18} aria-hidden="true" />
                  Void
                </button>
              )}
              {showRefund && (
                <button className="danger-button txn-action-btn" type="button" onClick={() => openConfirm('refund')}>
                  <RotateCcw size={18} aria-hidden="true" />
                  Refund
                </button>
              )}
              {/* TODO: Cash / PayNow-manual refunds (drawer open + status note) — out of scope */}
            </section>
          </div>
        )}

        {confirmAction && detail && (
          <div className="modal-backdrop" role="presentation" onClick={() => !actionBusy && setConfirmAction(null)}>
            <section
              className="loyalty-sheet txn-confirm-dialog"
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="sheet-header">
                <div>
                  <p>Order {detail.order_number}</p>
                  <h2>{confirmAction === 'void' ? 'Void payment?' : 'Refund payment?'}</h2>
                </div>
              </header>
              <div className="txn-confirm-body">
                <p>
                  {confirmAction === 'void'
                    ? `Void the card payment of ${formatCurrency(detail.card_amount || detail.total)}? This is a same-day reversal before settlement.`
                    : `Refund from the terminal. Full order total: ${formatCurrency(detail.total)}.`}
                </p>
                {confirmAction === 'refund' && (
                  <label className="txn-refund-input">
                    <span>Amount (leave full for complete refund)</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={refundAmount}
                      onChange={(e) => setRefundAmount(e.target.value)}
                      disabled={actionBusy}
                    />
                  </label>
                )}
                <div className="txn-confirm-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={actionBusy}
                    onClick={() => setConfirmAction(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    disabled={actionBusy}
                    onClick={() => void handleConfirmAction()}
                  >
                    {actionBusy ? 'Processing…' : confirmAction === 'void' ? 'Void' : 'Refund'}
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="transactions-page">
      <header className="transactions-header">
        <h1>Transactions</h1>
        <p className="transactions-subtitle">Look up orders, reprint, void or refund</p>
      </header>

      <div className="transactions-filters">
        <label className="txn-filter-field">
          <span>From</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label className="txn-filter-field">
          <span>To</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        <label className="txn-filter-field txn-search-field">
          <span>Order #</span>
          <input
            type="search"
            placeholder="e.g. 0042"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </label>
      </div>

      {loadingList ? (
        <div className="transactions-loading">
          <Loader2 className="spin-icon" size={28} aria-hidden="true" />
          <span>Loading orders…</span>
        </div>
      ) : listError ? (
        <p className="transactions-error">{listError}</p>
      ) : filteredOrders.length === 0 ? (
        <p className="transactions-empty">No orders found for this date range.</p>
      ) : (
        <ul className="txn-order-list">
          {filteredOrders.map((order) => (
            <li key={order.id}>
              <button className="txn-order-row" type="button" onClick={() => void openDetail(order.id)}>
                <span className="txn-order-number">#{order.order_number}</span>
                <span className="txn-order-time">{formatOrderTime(order.created_at)}</span>
                <span className="txn-order-total">{formatCurrency(order.total)}</span>
                <span className="txn-order-method">{paymentMethodLabel(order.payment_method)}</span>
                <span className={statusBadgeClass(order.status)}>{order.status}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
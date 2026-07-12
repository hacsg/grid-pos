import { useEffect, useState } from 'react';
import {
  Archive,
  BadgePercent,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Minus,
  PauseCircle,
  Pencil,
  Plus,
  ScanLine,
  Ticket,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { formatCurrency } from '@/api/client';
import type { AppliedVoucher, CartItem, Discount, LoyaltySelection, Totals } from '@/types';
import { lineLabel, lineTotal } from '@/utils/cart';
import type { AppliedDiscountLine } from '@/utils/discounts';
import { tapFeedback } from '@/utils/haptics';

interface CartSidebarProps {
  items: CartItem[];
  totals: Totals;
  discount: Discount | null;
  appliedDiscounts: AppliedDiscountLine[];
  loyalty: LoyaltySelection | null;
  vouchers: AppliedVoucher[];
  isOpen: boolean;
  scanConfirmed: boolean;
  parkedCount: number;
  onOpenParked: () => void;
  onToggleOpen: () => void;
  onIncrement: (lineId: string) => void;
  onDecrement: (lineId: string) => void;
  onRemove: (lineId: string) => void;
  onPark: () => void;
  onDiscount: () => void;
  onLoyalty: () => void;
  onVouchers: () => void;
  onQuickCharge: () => void;
  onClear: () => void;
  onCheckout: () => void;
  onEditItem: (lineId: string) => void;
}


export default function CartSidebar({
  items,
  totals,
  discount,
  appliedDiscounts,
  loyalty,
  vouchers,
  isOpen,
  scanConfirmed,
  parkedCount,
  onOpenParked,
  onToggleOpen,
  onIncrement,
  onDecrement,
  onRemove,
  onPark,
  onDiscount,
  onLoyalty,
  onVouchers,
  onQuickCharge,
  onClear,
  onCheckout,
  onEditItem,
}: CartSidebarProps) {
  const [clearConfirm, setClearConfirm] = useState(false);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  useEffect(() => {
    if (!clearConfirm) {
      return;
    }
    const timer = window.setTimeout(() => setClearConfirm(false), 3000);
    return () => window.clearTimeout(timer);
  }, [clearConfirm]);

  function handleClearClick() {
    if (clearConfirm) {
      onClear();
      setClearConfirm(false);
      return;
    }
    setClearConfirm(true);
  }

  return (
    <aside className={`cart-sidebar ${isOpen ? 'open' : ''} ${scanConfirmed ? 'scan-confirmed' : ''}`} aria-label="Cart">
      <button className="cart-mobile-trigger" type="button" onClick={onToggleOpen}>
        <span>
          Cart <strong>{itemCount}</strong>
        </span>
        <span>{formatCurrency(totals.total)}</span>
        {isOpen ? <ChevronDown size={20} aria-hidden="true" /> : <ChevronUp size={20} aria-hidden="true" />}
      </button>

      <header className="cart-header">
        <div>
          <h2>Current sale</h2>
          <p>{itemCount} item{itemCount === 1 ? '' : 's'}</p>
        </div>
        <div className="cart-header-actions">
          {parkedCount > 0 && (
            <button
              className="parked-trigger"
              type="button"
              onPointerDown={() => tapFeedback()}
              onClick={onOpenParked}
            >
              <Archive size={16} aria-hidden="true" />
              Parked
              <span className="parked-badge">{parkedCount}</span>
            </button>
          )}
          <button
            className="icon-button hide-desktop"
            type="button"
            aria-label="Close cart"
            title="Close"
            onPointerDown={() => tapFeedback()}
            onClick={onToggleOpen}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="cart-chips" aria-live="polite">
        {appliedDiscounts
          .filter((d) => d.scope === 'targeted')
          .map((d) => (
            <span className="cart-chip" key={d.id ?? d.name}>
              <BadgePercent size={15} aria-hidden="true" />
              {d.name}
            </span>
          ))}
        {discount && (
          <span className="cart-chip">
            <BadgePercent size={15} aria-hidden="true" />
            {discount.label}
          </span>
        )}
        {loyalty?.customer && (
          <span className="cart-chip">
            <UserRound size={15} aria-hidden="true" />
            {loyalty.customer.name}
          </span>
        )}
        {loyalty?.reward && (
          <span className="cart-chip">
            <BadgePercent size={15} aria-hidden="true" />
            {loyalty.reward.name}
          </span>
        )}
        {vouchers.map((v) => (
          <span className="cart-chip" key={v.code}>
            <Ticket size={15} aria-hidden="true" />
            {v.type === 'cdc' ? 'CDC' : 'Acre Group'} {formatCurrency(v.amount)}
          </span>
        ))}
      </div>

      <div className="cart-items">
        {items.length === 0 && (
          <div className="cart-empty">
            <ScanLine size={28} aria-hidden="true" />
            <strong>Scan or tap a product to start</strong>
            <span>Items will appear here as they are added.</span>
          </div>
        )}

        {items.map((item) => (
          <article className="cart-line" key={item.lineId}>
            <div className="cart-line-main">
              <div>
                {item.modifiers.length > 0 ? (
                  <button
                    className="cart-line-name"
                    type="button"
                    onClick={() => onEditItem(item.lineId)}
                  >
                    <h3>{lineLabel(item)}</h3>
                    <Pencil size={15} aria-hidden="true" />
                  </button>
                ) : (
                  <h3>{lineLabel(item)}</h3>
                )}
              </div>
              <strong>{formatCurrency(lineTotal(item))}</strong>
            </div>

            {item.modifiers.length > 0 && (
              <ul className="cart-modifiers">
                {item.modifiers.map((modifier) => (
                  <li key={modifier.id}>
                    <span>{modifier.modifier_name}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="cart-line-actions">
              <div className="quantity-stepper">
                <button
                  type="button"
                  aria-label={`Decrease ${item.product.name}`}
                  title="Decrease"
                  onPointerDown={() => tapFeedback()}
                  onClick={() => onDecrement(item.lineId)}
                >
                  <Minus size={17} aria-hidden="true" />
                </button>
                <span>{item.quantity}</span>
                <button
                  type="button"
                  aria-label={`Increase ${item.product.name}`}
                  title="Increase"
                  onPointerDown={() => tapFeedback()}
                  onClick={() => onIncrement(item.lineId)}
                >
                  <Plus size={17} aria-hidden="true" />
                </button>
              </div>
              <button
                className="icon-button danger"
                type="button"
                aria-label={`Remove ${item.product.name}`}
                title="Remove"
                onPointerDown={() => tapFeedback()}
                onClick={() => onRemove(item.lineId)}
              >
                <Trash2 size={18} aria-hidden="true" />
              </button>
            </div>
          </article>
        ))}
      </div>

      <section className="cart-totals" aria-label="Totals">
        {appliedDiscounts
          .filter((d) => d.scope === 'targeted')
          .map((d) => (
            <div key={d.id ?? d.name}>
              <span>{d.name}</span>
              <strong>-{formatCurrency(d.amountOff)}</strong>
            </div>
          ))}
        {totals.discount > 0 && (
          <div>
            <span>Discount</span>
            <strong>-{formatCurrency(totals.discount)}</strong>
          </div>
        )}
        {totals.loyaltyDiscount > 0 && (
          <div>
            <span>Loyalty</span>
            <strong>-{formatCurrency(totals.loyaltyDiscount)}</strong>
          </div>
        )}
        {totals.voucherDiscount > 0 && (
          <div>
            <span>Vouchers</span>
            <strong>-{formatCurrency(totals.voucherDiscount)}</strong>
          </div>
        )}
        <div className="total-row">
          <span>Total</span>
          <strong>{formatCurrency(totals.total)}</strong>
        </div>
      </section>

      <footer className="cart-actions">
        <button className="secondary-button" type="button" onClick={onPark} disabled={items.length === 0}>
          <PauseCircle size={18} aria-hidden="true" />
          Park
        </button>
        <button className="secondary-button" type="button" onClick={onDiscount}>
          <BadgePercent size={18} aria-hidden="true" />
          Discount
        </button>
        <button className="secondary-button" type="button" onClick={onLoyalty}>
          <UserRound size={18} aria-hidden="true" />
          Loyalty
        </button>
        <button className="secondary-button" type="button" onClick={onVouchers}>
          <Ticket size={18} aria-hidden="true" />
          Voucher
        </button>
        <button className="secondary-button" type="button" onClick={onQuickCharge}>
          <Plus size={18} aria-hidden="true" />
          Quick charge
        </button>
        {clearConfirm ? (
          <div className="clear-confirm">
            <span>Clear all items?</span>
            <button className="secondary-button danger-text" type="button" onClick={handleClearClick}>
              Confirm
            </button>
            <button className="secondary-button" type="button" onClick={() => setClearConfirm(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            className="secondary-button danger-text"
            type="button"
            onClick={handleClearClick}
            disabled={items.length === 0}
          >
            <Trash2 size={18} aria-hidden="true" />
            Clear
          </button>
        )}
        <button className="primary-button checkout-button" type="button" onClick={onCheckout} disabled={items.length === 0}>
          <CreditCard size={20} aria-hidden="true" />
          Checkout
        </button>
      </footer>
    </aside>
  );
}

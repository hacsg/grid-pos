import { PlayCircle, Trash2, X } from 'lucide-react';
import { formatCurrency, money } from '@/api/client';
import type { ParkedCart } from '@/types';
import { tapFeedback } from '@/utils/haptics';

interface ParkedSheetProps {
  open: boolean;
  parked: ParkedCart[];
  onClose: () => void;
  onResume: (id: string) => void;
  onDiscard: (id: string) => void;
}

function cartTotal(cart: ParkedCart): number {
  return cart.items.reduce((sum, item) => {
    const modifierTotal = item.modifiers.reduce((m, mod) => m + mod.price_adjustment, 0);
    return sum + (money(item.product.price) + modifierTotal) * item.quantity;
  }, 0);
}

function cartCount(cart: ParkedCart): number {
  return cart.items.reduce((sum, item) => sum + item.quantity, 0);
}

function parkedLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-SG', {
      timeZone: 'Asia/Singapore',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
}

export default function ParkedSheet({ open, parked, onClose, onResume, onDiscard }: ParkedSheetProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="loyalty-sheet parked-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="parked-title"
        style={{ maxWidth: '460px', margin: 'auto' }}
      >
        <header className="sheet-header">
          <div>
            <p>Held sales</p>
            <h2 id="parked-title">Parked carts ({parked.length})</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close"
            onClick={onClose}
            onPointerDown={() => tapFeedback()}
          >
            <X size={20} />
          </button>
        </header>

        <div className="parked-list">
          {parked.length === 0 && <div className="cart-empty">No parked carts</div>}

          {parked.map((cart) => (
            <article className="parked-row" key={cart.id}>
              <div className="parked-row-info">
                <strong>{formatCurrency(cartTotal(cart))}</strong>
                <span>
                  {cartCount(cart)} item{cartCount(cart) === 1 ? '' : 's'} · {parkedLabel(cart.parkedAt)}
                </span>
                {cart.loyalty?.customer && (
                  <span className="parked-row-customer">{cart.loyalty.customer.name}</span>
                )}
              </div>
              <div className="parked-row-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => onResume(cart.id)}
                  onPointerDown={() => tapFeedback()}
                >
                  <PlayCircle size={18} aria-hidden="true" />
                  Resume
                </button>
                <button
                  className="icon-button danger"
                  type="button"
                  aria-label="Discard parked cart"
                  title="Discard"
                  onClick={() => onDiscard(cart.id)}
                  onPointerDown={() => tapFeedback()}
                >
                  <Trash2 size={18} aria-hidden="true" />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

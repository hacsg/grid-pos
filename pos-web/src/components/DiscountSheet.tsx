import { X } from 'lucide-react';
import type { Discount as ApiDiscount } from '@/api/client';
import type { Discount } from '@/types';
import { tapFeedback } from '@/utils/haptics';

interface DiscountSheetProps {
  open: boolean;
  discounts: ApiDiscount[];
  current: Discount | null;
  onClose: () => void;
  onApply: (discount: Discount) => void;
  onClear: () => void;
  onContinue: () => void;
}

export default function DiscountSheet({
  open,
  discounts,
  current,
  onClose,
  onApply,
  onClear,
  onContinue,
}: DiscountSheetProps) {
  if (!open) {
    return null;
  }

  function handleSelect(d: ApiDiscount) {
    tapFeedback();
    onApply({
      id: d.id,
      label: d.name,
      amount: d.amount,
      kind: d.kind,
    });
  }

  function handleClear() {
    tapFeedback();
    onClear();
  }

  function formatAmount(d: ApiDiscount) {
    if (d.kind === 'percent') {
      return `${d.amount}%`;
    }
    return `S$${Number(d.amount).toFixed(2)}`;
  }

  const isCurrent = (d: ApiDiscount) => current && current.label === d.name && current.amount === d.amount && current.kind === d.kind;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="loyalty-sheet" role="dialog" aria-modal="true" aria-labelledby="discount-title">
        <header className="sheet-header">
          <div>
            <p>Discount</p>
            <h2 id="discount-title">Apply discount</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close discounts"
            title="Close"
            onPointerDown={() => tapFeedback()}
            onClick={onClose}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="loyalty-content">
          <section className="reward-list" aria-label="Available discounts">
            <header>
              <h3>Available discounts</h3>
            </header>

            {/* No discount option */}
            <article
              className={`reward-row ${!current ? 'selected' : ''}`}
              onClick={() => {
                tapFeedback();
                if (current) handleClear();
              }}
            >
              <div>
                <h4>No discount</h4>
                <p>Remove any applied discount</p>
              </div>
              {!current && <span className="text-xs text-primary">Selected</span>}
            </article>

            {discounts.length === 0 && (
              <p className="muted-line">No discounts available</p>
            )}

            {discounts.map((d) => (
              <article
                key={d.id}
                className={`reward-row ${isCurrent(d) ? 'selected' : ''}`}
                onClick={() => handleSelect(d)}
              >
                <div>
                  <h4>{d.name}</h4>
                  <p>
                    {d.kind === 'percent' ? 'Percentage' : 'Fixed amount'} · {formatAmount(d)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex rounded px-2 py-0.5 text-xs ${d.kind === 'percent' ? 'bg-primary/10 text-primary' : 'bg-amber-100 text-amber-700'}`}>
                    {d.kind === 'percent' ? 'Percent' : 'Fixed'}
                  </span>
                  {isCurrent(d) && <span className="text-xs text-primary">Applied</span>}
                </div>
              </article>
            ))}
          </section>

          {current && (
            <div className="mt-3 rounded-lg border border-gray-100 bg-surface p-3 text-sm">
              <div className="flex items-center justify-between">
                <span>Current: <strong>{current.label}</strong></span>
                <button className="secondary-button" type="button" onClick={handleClear}>
                  Remove
                </button>
              </div>
            </div>
          )}
        </div>

        <footer className="sheet-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="button" onClick={onContinue}>
            Continue
          </button>
        </footer>
      </section>
    </div>
  );
}

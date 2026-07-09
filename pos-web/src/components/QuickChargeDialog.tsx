import { useState } from 'react';
import { X } from 'lucide-react';
import { formatCurrency } from '@/api/client';
import { tapFeedback } from '@/utils/haptics';

interface QuickChargeDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (amount: number, label: string) => void;
}

const QUICK_AMOUNTS = [0.5, 1, 2, 5] as const;
const QUICK_LABELS = ['Change Flavours', 'Add ice', 'Premium flavour', 'Extra topping'] as const;
const PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'] as const;

export default function QuickChargeDialog({ open, onClose, onConfirm }: QuickChargeDialogProps) {
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');

  if (!open) {
    return null;
  }

  function reset() {
    setAmount('');
    setLabel('');
  }

  function close() {
    reset();
    onClose();
  }

  function press(key: (typeof PAD_KEYS)[number]) {
    tapFeedback();
    if (key === '⌫') {
      setAmount((v) => v.slice(0, -1));
      return;
    }
    if (key === '.') {
      setAmount((v) => (v.includes('.') ? v : v === '' ? '0.' : `${v}.`));
      return;
    }
    setAmount((v) => {
      const [, decimals] = v.split('.');
      if (decimals !== undefined && decimals.length >= 2) return v;
      if (v.replace('.', '').length >= 5) return v;
      return v === '0' ? key : v + key;
    });
  }

  const parsed = Number.parseFloat(amount) || 0;

  function confirm() {
    if (parsed <= 0) return;
    onConfirm(parsed, label.trim() || 'Quick charge');
    reset();
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={close}>
      <section
        className="loyalty-sheet quick-charge-dialog"
        role="dialog"
        aria-modal="true"
        style={{ maxWidth: '440px', margin: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet-header">
          <div>
            <p>Add-on</p>
            <h2>Quick charge</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close" onClick={close}>
            <X size={20} />
          </button>
        </header>

        <div className="quick-charge-body">
          <div className="quick-charge-readout">
            <span>Amount</span>
            <strong>{formatCurrency(parsed)}</strong>
          </div>

          <div className="quick-charge-chips">
            {QUICK_AMOUNTS.map((a) => (
              <button key={a} type="button" onClick={() => { tapFeedback(); setAmount(a.toFixed(2)); }}>
                ${a}
              </button>
            ))}
          </div>

          <div className="quick-charge-keys" role="group" aria-label="Number pad">
            {PAD_KEYS.map((key) => (
              <button key={key} type="button" onClick={() => press(key)}>{key}</button>
            ))}
          </div>

          <div className="quick-charge-labels">
            {QUICK_LABELS.map((l) => (
              <button
                key={l}
                type="button"
                className={label === l ? 'active' : ''}
                onClick={() => { tapFeedback(); setLabel(l); }}
              >
                {l}
              </button>
            ))}
          </div>

          <label className="till-field">
            <span>Description (shown on receipt)</span>
            <input
              type="text"
              placeholder="e.g. Add ice, Premium flavour"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>

          <div className="txn-confirm-actions">
            <button className="secondary-button" type="button" onClick={close}>Cancel</button>
            <button className="primary-button" type="button" disabled={parsed <= 0} onClick={confirm}>
              Add {parsed > 0 ? formatCurrency(parsed) : ''}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

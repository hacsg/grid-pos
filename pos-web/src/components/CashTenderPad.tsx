import { tapFeedback } from '@/utils/haptics';

// Singapore circulating denominations, largest first, for change breakdown.
const NOTE_VALUES = [100, 50, 10, 5, 2] as const;
const COIN_VALUES = [1, 0.5, 0.2, 0.1, 0.05] as const;

export interface ChangePart {
  value: number;
  count: number;
  kind: 'note' | 'coin';
}

/** Greedy breakdown of a change amount into SGD notes and coins. */
export function breakdownChange(amount: number): ChangePart[] {
  let cents = Math.round(amount * 100);
  const parts: ChangePart[] = [];
  for (const value of NOTE_VALUES) {
    const unit = Math.round(value * 100);
    const count = Math.floor(cents / unit);
    if (count > 0) {
      parts.push({ value, count, kind: 'note' });
      cents -= count * unit;
    }
  }
  for (const value of COIN_VALUES) {
    const unit = Math.round(value * 100);
    const count = Math.floor(cents / unit);
    if (count > 0) {
      parts.push({ value, count, kind: 'coin' });
      cents -= count * unit;
    }
  }
  return parts;
}

/** Quick-tender suggestions: the exact total plus notes/round figures above it. */
export function quickTenderAmounts(total: number): number[] {
  const suggestions = new Set<number>();
  for (const note of [5, 10, 50, 100]) {
    if (note > total) {
      suggestions.add(note);
    }
  }
  // Next multiple of $10 covers e.g. total 12.40 -> 20.
  const nextTen = Math.ceil(total / 10) * 10;
  if (nextTen > total) {
    suggestions.add(nextTen);
  }
  return [...suggestions].sort((a, b) => a - b).slice(0, 3);
}

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatDenomination(part: ChangePart): string {
  const label = part.value >= 1 ? `$${part.value}` : `${Math.round(part.value * 100)}¢`;
  return `${part.count} × ${label}`;
}

interface CashTenderPadProps {
  value: string;
  totalDue: number;
  changeDue: number;
  disabled?: boolean;
  onChange: (next: string) => void;
}

const PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'] as const;

export default function CashTenderPad({ value, totalDue, changeDue, disabled, onChange }: CashTenderPadProps) {
  const tendered = Number.parseFloat(value);
  const enough = Number.isFinite(tendered) && tendered >= totalDue;
  const parts = enough && changeDue > 0 ? breakdownChange(changeDue) : [];

  function press(key: (typeof PAD_KEYS)[number]) {
    tapFeedback();
    if (key === '⌫') {
      onChange(value.slice(0, -1));
      return;
    }
    if (key === '.') {
      if (value.includes('.')) {
        return;
      }
      onChange(value === '' ? '0.' : `${value}.`);
      return;
    }
    const [, decimals] = value.split('.');
    if (decimals !== undefined && decimals.length >= 2) {
      return;
    }
    if (value.replace('.', '').length >= 6) {
      return;
    }
    onChange(value === '0' ? key : value + key);
  }

  function setAmount(amount: number) {
    tapFeedback();
    onChange(amount.toFixed(2));
  }

  return (
    <div className="cash-pad" aria-label="Cash received">
      <div className={`cash-pad-readout ${value && !enough ? 'short' : ''}`}>
        <span>Cash received</span>
        <strong>{value === '' ? '$0.00' : formatMoney(Number.parseFloat(value) || 0)}</strong>
      </div>

      <div className="cash-pad-quick">
        <button type="button" disabled={disabled} onClick={() => setAmount(totalDue)}>
          Exact {formatMoney(totalDue)}
        </button>
        {quickTenderAmounts(totalDue).map((amount) => (
          <button key={amount} type="button" disabled={disabled} onClick={() => setAmount(amount)}>
            ${amount}
          </button>
        ))}
        <button type="button" className="cash-pad-clear" disabled={disabled} onClick={() => { tapFeedback(); onChange(''); }}>
          Clear
        </button>
      </div>

      <div className="cash-pad-keys" role="group" aria-label="Number pad">
        {PAD_KEYS.map((key) => (
          <button key={key} type="button" disabled={disabled} onClick={() => press(key)}>
            {key}
          </button>
        ))}
      </div>

      {enough && (
        <div className="cash-pad-change" role="status">
          <div className="cash-pad-change-total">
            <span>Change due</span>
            <strong>{formatMoney(changeDue)}</strong>
          </div>
          {parts.length > 0 && (
            <ul className="cash-pad-change-parts">
              {parts.map((part) => (
                <li key={`${part.kind}-${part.value}`}>
                  {formatDenomination(part)} {part.kind === 'note' ? 'note' : 'coin'}
                  {part.count > 1 ? 's' : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {value !== '' && !enough && (
        <div className="cash-pad-short" role="status">
          Short by {formatMoney(Math.max(0, totalDue - (Number.parseFloat(value) || 0)))}
        </div>
      )}
    </div>
  );
}

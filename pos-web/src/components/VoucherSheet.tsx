import { FormEvent, useEffect, useRef, useState } from 'react';
import { Ticket, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { formatCurrency, validateVoucher } from '@/api/client';
import type { AppliedVoucher } from '@/types';
import { tapFeedback } from '@/utils/haptics';

interface VoucherSheetProps {
  open: boolean;
  applied: AppliedVoucher[];
  onClose: () => void;
  onApply: (voucher: AppliedVoucher) => void;
  onRemove: (code: string) => void;
  onContinue: () => void;
}

export default function VoucherSheet({
  open,
  applied,
  onClose,
  onApply,
  onRemove,
  onContinue,
}: VoucherSheetProps) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const totalApplied = applied.reduce((sum, v) => sum + v.amount, 0);

  async function submitApply(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;

    // Prevent duplicates in current session
    if (applied.some((v) => v.code.toUpperCase() === trimmed.toUpperCase())) {
      toast.error('Voucher already applied');
      return;
    }

    try {
      setLoading(true);
      const res = await validateVoucher(trimmed);
      const amount = res.amount != null ? Number(res.amount) : 0;
      const voucher: AppliedVoucher = {
        code: res.code,
        type: res.type,
        amount: amount > 0 ? amount : 0,
        id: res.id,
      };
      onApply(voucher);
      setCode('');
      if (amount > 0) {
        toast.success(`${res.type === 'cdc' ? 'CDC' : 'Acre Group'} voucher S$${amount.toFixed(2)} applied`);
      } else {
        toast.success(`${res.type === 'cdc' ? 'CDC' : 'Acre Group'} voucher applied (no discount)`);
      }
    } catch (err: any) {
      // errors are toasted by interceptor, but we can be explicit
      const msg = err?.response?.data?.detail || 'Invalid or already redeemed voucher';
      toast.error(typeof msg === 'string' ? msg : 'Could not apply voucher');
    } finally {
      setLoading(false);
    }
  }

  function handleRemove(codeToRemove: string) {
    tapFeedback();
    onRemove(codeToRemove);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="loyalty-sheet" role="dialog" aria-modal="true" aria-labelledby="voucher-title">
        <header className="sheet-header">
          <div>
            <p>Vouchers</p>
            <h2 id="voucher-title">Redeem voucher</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close vouchers"
            title="Close"
            onPointerDown={() => tapFeedback()}
            onClick={onClose}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <form className="scanner-form" onSubmit={submitApply}>
          <label>
            <span>Enter or scan voucher code</span>
            <div className="scanner-input">
              <Ticket size={22} aria-hidden="true" />
              <input
                ref={inputRef}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoFocus
                inputMode="text"
                autoComplete="off"
                enterKeyHint="done"
                placeholder="e.g. CDC-TEST001 or AG-XXXX"
                disabled={loading}
              />
            </div>
          </label>
          <button className="primary-button" type="submit" disabled={loading || !code.trim()}>
            {loading ? 'Applying…' : 'Apply'}
          </button>
        </form>

        {applied.length > 0 && (
          <div className="loyalty-content">
            <section className="customer-panel" aria-label="Applied vouchers">
              <div className="customer-avatar" aria-hidden="true">
                <Ticket size={24} />
              </div>
              <div>
                <h3>{applied.length} voucher{applied.length === 1 ? '' : 's'} applied</h3>
                <p>Total deduction {formatCurrency(totalApplied)}</p>
              </div>
            </section>

            <section className="reward-list" aria-label="Applied list">
              <header>
                <Ticket size={18} aria-hidden="true" />
                <h3>Applied</h3>
              </header>
              {applied.map((v) => (
                <article className="reward-row" key={v.code}>
                  <div>
                    <h4>
                      {v.type === 'cdc' ? 'CDC' : 'Acre Group'}
                      {v.amount > 0 ? ` ${formatCurrency(v.amount)}` : ' (no discount)'}
                    </h4>
                    <p>{v.code}</p>
                  </div>
                  <button
                    className="icon-button danger"
                    type="button"
                    aria-label={`Remove ${v.code}`}
                    onClick={() => handleRemove(v.code)}
                  >
                    <X size={18} />
                  </button>
                </article>
              ))}
            </section>
          </div>
        )}

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

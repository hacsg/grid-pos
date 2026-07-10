import { FormEvent, useEffect, useRef, useState } from 'react';
import { Ticket, UserRound, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  formatCurrency,
  getCustomerWithVouchers,
  money,
  validateVoucher,
  type LoyaltyMember,
  type PlotholdersVoucher,
} from '@/api/client';
import type { AppliedVoucher, LoyaltySelection } from '@/types';
import { tapFeedback } from '@/utils/haptics';

interface VoucherSheetProps {
  open: boolean;
  applied: AppliedVoucher[];
  loyalty: LoyaltySelection | null;
  onClose: () => void;
  onApply: (voucher: AppliedVoucher) => void;
  onRemove: (code: string) => void;
  onSelectCustomer: (customer: LoyaltyMember) => void;
  onContinue: () => void;
}

/** Map a Plotholders voucher to the order's AppliedVoucher shape. */
function toAppliedVoucher(v: PlotholdersVoucher): AppliedVoucher {
  const amount =
    v.amount != null ? money(v.amount) : v.discount_cents != null ? v.discount_cents / 100 : 0;
  const type = (v.type || '').toLowerCase() === 'cdc' ? 'cdc' : 'acre_group';
  return { code: v.code, type, amount, id: v.id };
}

export default function VoucherSheet({
  open,
  applied,
  loyalty,
  onClose,
  onApply,
  onRemove,
  onSelectCustomer,
  onContinue,
}: VoucherSheetProps) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const memberId = loyalty?.customer
    ? String(loyalty.customer.customer_id || loyalty.customer.member_id)
    : null;

  // The attached member's active vouchers — "you have these, want to use them?"
  const memberVouchersQuery = useQuery({
    queryKey: ['member-vouchers', memberId],
    queryFn: () => getCustomerWithVouchers(memberId!, { silent: true }),
    enabled: open && !!memberId,
    staleTime: 30_000,
  });
  const memberVouchers = memberVouchersQuery.data?.vouchers ?? [];

  useEffect(() => {
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const appliedCodes = new Set(applied.map((v) => v.code.toUpperCase()));
  const totalApplied = applied.reduce((sum, v) => sum + v.amount, 0);

  function applyPlotholdersVoucher(v: PlotholdersVoucher) {
    tapFeedback();
    const av = toAppliedVoucher(v);
    onApply(av);
    toast.success(
      av.amount > 0 ? `Voucher ${formatCurrency(av.amount)} applied` : 'Voucher applied'
    );
  }

  // One field, two possibilities: a voucher code applies directly; a scanned
  // membership QR (the Plotholders customer id) attaches the member to the
  // sale and lists their vouchers below for easy redemption.
  async function submitApply(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;

    if (appliedCodes.has(trimmed.toUpperCase())) {
      toast.error('Voucher already applied');
      return;
    }

    // Membership QRs are UUIDs (the Plotholders customer id); voucher QRs are
    // human-readable codes. The shape picks the lookup order.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);

    const tryVoucher = async (): Promise<boolean> => {
      try {
        const res = await validateVoucher(trimmed, { silent: true });
        const amount = res.amount != null ? Number(res.amount) : 0;
        onApply({
          code: res.code,
          type: res.type,
          amount: amount > 0 ? amount : 0,
          id: res.id,
        });
        setCode('');
        toast.success(
          amount > 0
            ? `${res.type === 'cdc' ? 'CDC' : 'Acre Group'} voucher S$${amount.toFixed(2)} applied`
            : `${res.type === 'cdc' ? 'CDC' : 'Acre Group'} voucher applied (no discount)`
        );
        return true;
      } catch (err: any) {
        if (err?.response?.status === 409) {
          toast.error('Voucher has already been redeemed');
          return true; // definitively a voucher — stop here
        }
        return false;
      }
    };

    const tryMember = async (): Promise<boolean> => {
      try {
        const found = await getCustomerWithVouchers(trimmed, { silent: true });
        const { vouchers: _v, ...memberOnly } = found;
        onSelectCustomer(memberOnly as LoyaltyMember);
        setCode('');
        toast.success(`${found.name || 'Member'} attached — their vouchers are listed below`);
        return true;
      } catch {
        return false;
      }
    };

    setLoading(true);
    try {
      const resolved = isUuid
        ? (await tryMember()) || (await tryVoucher())
        : (await tryVoucher()) || (await tryMember());
      if (!resolved) {
        toast.error('Not a valid voucher code or member QR');
      }
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
            <span>Enter or scan a voucher code — or the member's QR</span>
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
                placeholder="Voucher code or member QR"
                disabled={loading}
              />
            </div>
          </label>
          <button className="primary-button" type="submit" disabled={loading || !code.trim()}>
            {loading ? 'Checking…' : 'Apply'}
          </button>
        </form>

        {/* Attached member's vouchers — the "you have these, want to use them?" list */}
        {loyalty?.customer ? (
          <div className="loyalty-vouchers" style={{ padding: '0 4px' }}>
            <p className="loyalty-vouchers-title">
              <UserRound size={16} aria-hidden="true" />
              {loyalty.customer.name || 'Member'}&rsquo;s vouchers
            </p>
            {memberVouchersQuery.isLoading && <p className="loyalty-vouchers-empty">Loading vouchers…</p>}
            {!memberVouchersQuery.isLoading && memberVouchers.length === 0 && (
              <p className="loyalty-vouchers-empty">No active vouchers on this account.</p>
            )}
            {memberVouchers.map((v) => {
              const av = toAppliedVoucher(v);
              const isApplied = appliedCodes.has(v.code.toUpperCase());
              return (
                <div className="loyalty-voucher-row" key={v.id || v.code}>
                  <div>
                    <strong>{v.title || v.code}</strong>
                    <span>{av.amount > 0 ? formatCurrency(av.amount) : v.description || v.code}</span>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={isApplied}
                    onClick={() => applyPlotholdersVoucher(v)}
                  >
                    {isApplied ? 'Applied' : 'Apply'}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="loyalty-vouchers-empty" style={{ padding: '0 4px' }}>
            Scan the member&rsquo;s QR (or add them via Loyalty) to see the vouchers on their account.
          </p>
        )}

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

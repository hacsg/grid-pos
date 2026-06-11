import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { BadgePercent, Search, UserRound, X } from 'lucide-react';
import { formatCurrency, lookupLoyalty, type LoyaltyMember, type LoyaltyReward } from '@/api/client';
import { tapFeedback } from '@/utils/haptics';

interface LoyaltySheetProps {
  open: boolean;
  selectedCustomer: LoyaltyMember | null;
  selectedReward: LoyaltyReward | null;
  onClose: () => void;
  onCustomerSelect: (customer: LoyaltyMember) => void;
  onRedeem: (reward: LoyaltyReward) => void;
  onSkip: () => void;
  onContinue: () => void;
}

function deriveRewards(customer: LoyaltyMember | null): LoyaltyReward[] {
  if (!customer) {
    return [];
  }
  const externalRewards = [...(customer.rewards ?? []), ...(customer.vouchers ?? [])];
  if (externalRewards.length > 0) {
    return externalRewards;
  }
  return [100, 500, 1000]
    .filter((points) => customer.points >= points)
    .map((points) => ({
      id: `points-${points}`,
      name: `${formatCurrency(points / 100)} off`,
      points,
      discount_amount: points / 100,
      kind: 'points' as const,
    }));
}

export default function LoyaltySheet({
  open,
  selectedCustomer,
  selectedReward,
  onClose,
  onCustomerSelect,
  onRedeem,
  onSkip,
  onContinue,
}: LoyaltySheetProps) {
  const [lookupCode, setLookupCode] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const rewards = useMemo(() => deriveRewards(selectedCustomer), [selectedCustomer]);
  const lifetimeMoments = selectedCustomer?.lifetime_moments ?? selectedCustomer?.points ?? 0;

  useEffect(() => {
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  async function submitLookup(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const code = lookupCode.trim();
    if (!code) {
      return;
    }
    try {
      setLoading(true);
      const customer = await lookupLoyalty(code);
      onCustomerSelect(customer);
      setLookupCode('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="loyalty-sheet" role="dialog" aria-modal="true" aria-labelledby="loyalty-title">
        <header className="sheet-header">
          <div>
            <p>Loyalty</p>
            <h2 id="loyalty-title">Customer lookup</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close loyalty"
            title="Close"
            onPointerDown={() => tapFeedback()}
            onClick={onClose}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <form className="scanner-form" onSubmit={submitLookup}>
          <label>
            <span>Scan or enter code</span>
            <div className="scanner-input">
              <Search size={22} aria-hidden="true" />
              <input
                ref={inputRef}
                value={lookupCode}
                onChange={(event) => setLookupCode(event.target.value)}
                autoFocus
                inputMode="tel"
                autoComplete="off"
                enterKeyHint="search"
                disabled={loading}
              />
            </div>
          </label>
          <button className="primary-button" type="submit" disabled={loading || !lookupCode.trim()}>
            Lookup
          </button>
        </form>

        {selectedCustomer && (
          <div className="loyalty-content">
            <section className="customer-panel" aria-label="Customer">
              <div className="customer-avatar" aria-hidden="true">
                <UserRound size={24} />
              </div>
              <div>
                <h3>{selectedCustomer.name}</h3>
                <p>{selectedCustomer.phone ?? selectedCustomer.member_id}</p>
              </div>
              <span className="tier-badge">{selectedCustomer.tier}</span>
              <div className="moments-stat">
                <span>Lifetime moments</span>
                <strong>{lifetimeMoments.toLocaleString()}</strong>
              </div>
            </section>

            <section className="reward-list" aria-label="Available rewards">
              <header>
                <BadgePercent size={18} aria-hidden="true" />
                <h3>Rewards</h3>
              </header>
              {rewards.length === 0 && <p className="muted-line">No rewards available</p>}
              {rewards.map((reward) => (
                <article className={`reward-row ${selectedReward?.id === reward.id ? 'selected' : ''}`} key={reward.id}>
                  <div>
                    <h4>{reward.name}</h4>
                    <p>{reward.points.toLocaleString()} points</p>
                  </div>
                  <button className="secondary-button" type="button" onClick={() => onRedeem(reward)}>
                    Redeem
                  </button>
                </article>
              ))}
            </section>
          </div>
        )}

        <footer className="sheet-actions">
          <button className="secondary-button" type="button" onClick={onSkip}>
            Skip
          </button>
          <button className="primary-button" type="button" onClick={onContinue}>
            Continue
          </button>
        </footer>
      </section>
    </div>
  );
}

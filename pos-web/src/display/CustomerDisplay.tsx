import { useEffect, useState } from 'react';
import { DISPLAY_CHANNEL, type DisplayItem, type DisplayMessage, type OrderSnapshot } from './channel';
import { formatCurrency } from '@/api/client';

type Phase = 'idle' | 'order' | 'processing' | 'thanks' | 'resetting';

interface DisplayState {
  phase: Phase;
  snapshot: OrderSnapshot | null;
  paymentTotal: number | null;
  pointsEarned: number | null;
}

const IDLE_RESET_DELAY = 5000;

export default function CustomerDisplay() {
  const [state, setState] = useState<DisplayState>({
    phase: 'idle',
    snapshot: null,
    paymentTotal: null,
    pointsEarned: null,
  });
  const [resetTimer, setResetTimer] = useState<number | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') {
      return;
    }

    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel(DISPLAY_CHANNEL);
    } catch {
      return;
    }

    const handleMessage = (event: MessageEvent<DisplayMessage>) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'ORDER_UPDATE') {
        const payload = msg.payload;
        const hasItems = Array.isArray(payload?.items) && payload.items.length > 0;

        setState((prev) => {
          // During payment or post-payment, ignore ORDER_UPDATE (keeps processing/thanks visible)
          if (prev.phase === 'processing' || prev.phase === 'thanks' || prev.phase === 'resetting') {
            return prev;
          }

          if (!hasItems) {
            return { phase: 'idle', snapshot: null, paymentTotal: null, pointsEarned: null };
          }

          // Active order
          return {
            phase: 'order',
            snapshot: payload,
            paymentTotal: null,
            pointsEarned: null,
          };
        });
      }

      if (msg.type === 'PAYMENT_START') {
        setState((prev) => ({
          ...prev,
          phase: 'processing',
          paymentTotal: msg.payload?.total ?? prev.snapshot?.total ?? 0,
        }));
      }

      if (msg.type === 'PAYMENT_COMPLETE') {
        const total = msg.payload?.total ?? 0;
        const points = msg.payload?.pointsEarned ?? null;

        // Clear any pending reset timer
        if (resetTimer) {
          window.clearTimeout(resetTimer);
        }

        setState({
          phase: 'thanks',
          snapshot: null,
          paymentTotal: total,
          pointsEarned: points,
        });
      }

      if (msg.type === 'ORDER_COMPLETE') {
        setState((prev) => {
          // Only transition from thanks -> resetting with timer
          if (prev.phase !== 'thanks') {
            // If somehow we get complete without thanks, just go idle after delay
            const t = window.setTimeout(() => {
              setState({ phase: 'idle', snapshot: null, paymentTotal: null, pointsEarned: null });
            }, IDLE_RESET_DELAY);
            setResetTimer(t);
            return { ...prev, phase: 'resetting' };
          }

          const t = window.setTimeout(() => {
            setState({ phase: 'idle', snapshot: null, paymentTotal: null, pointsEarned: null });
            setResetTimer(null);
          }, IDLE_RESET_DELAY);

          setResetTimer(t);
          return { ...prev, phase: 'resetting' };
        });
      }
    };

    ch.addEventListener('message', handleMessage);

    return () => {
      ch.removeEventListener('message', handleMessage);
      try {
        ch.close();
      } catch {
        // ignore
      }
    };
  }, [resetTimer]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (resetTimer) {
        window.clearTimeout(resetTimer);
      }
    };
  }, [resetTimer]);

  const { phase, snapshot, paymentTotal, pointsEarned } = state;

  const items: DisplayItem[] = snapshot?.items ?? [];
  const total = snapshot?.total ?? paymentTotal ?? 0;

  return (
    <div className="customer-display">
      <div className="display-content">
        {/* IDLE / WELCOME */}
        {phase === 'idle' && (
          <div className="display-idle">
            <div className="display-brand">
              <div className="display-mark" aria-hidden="true">
                HAC
              </div>
              <div className="display-brand-name">Hundred Acre Creamery</div>
            </div>
            <div className="display-welcome">Welcome</div>
          </div>
        )}

        {/* ORDER ACTIVE */}
        {phase === 'order' && snapshot && (
          <div className="display-order">
            <div className="display-order-header">
              <div className="display-mark small" aria-hidden="true">
                HAC
              </div>
              <div>
                <div className="display-order-title">Current order</div>
                {snapshot.loyaltyCustomerName && (
                  <div className="display-loyalty">{snapshot.loyaltyCustomerName}</div>
                )}
              </div>
            </div>

            <div className="display-items">
              {items.map((item, index) => (
                <div className="display-item" key={`${item.name}-${index}`}>
                  <div className="display-item-main">
                    <div className="display-item-name">
                      <span className="display-qty">{item.quantity} ×</span> {item.name}
                    </div>
                    <div className="display-item-price">{formatCurrency(item.lineTotal)}</div>
                  </div>
                  {item.modifiers.length > 0 && (
                    <div className="display-modifiers">
                      {item.modifiers.map((m, i) => (
                        <div key={i}>{m}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="display-totals">
              <div className="display-total-row">
                <span>Total</span>
                <strong>{formatCurrency(total)}</strong>
              </div>
            </div>
          </div>
        )}

        {/* PAYMENT PROCESSING */}
        {phase === 'processing' && (
          <div className="display-processing">
            <div className="display-mark small" aria-hidden="true">
              HAC
            </div>
            <div className="display-processing-text">Processing payment…</div>
            <div className="display-processing-total">{formatCurrency(paymentTotal ?? total)}</div>
          </div>
        )}

        {/* PAYMENT COMPLETE / THANK YOU */}
        {(phase === 'thanks' || phase === 'resetting') && (
          <div className="display-thanks">
            <div className="display-mark small" aria-hidden="true">
              HAC
            </div>
            <div className="display-thanks-title">Thank you</div>
            <div className="display-thanks-total">{formatCurrency(paymentTotal ?? total)}</div>
            {pointsEarned != null && pointsEarned > 0 && (
              <div className="display-points">
                +{pointsEarned} loyalty {pointsEarned === 1 ? 'point' : 'points'}
              </div>
            )}
            {phase === 'resetting' && <div className="display-reset-hint">See you soon</div>}
          </div>
        )}
      </div>
    </div>
  );
}

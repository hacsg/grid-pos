import { useEffect, useState } from 'react';
import { broadcast, DISPLAY_CHANNEL, type DisplayItem, type DisplayMessage, type OrderSnapshot } from './channel';
import { formatCurrency } from '@/api/client';

type Phase = 'idle' | 'order' | 'processing' | 'paynowQr' | 'thanks' | 'resetting';

interface DisplayState {
  phase: Phase;
  snapshot: OrderSnapshot | null;
  paymentTotal: number | null;
  pointsEarned: number | null;
  brandName: string;
  brandLogoUrl: string | null;
  paynowQrUrl: string | null;
}

const IDLE_RESET_DELAY = 5000;

export default function CustomerDisplay() {
  const [state, setState] = useState<DisplayState>({
    phase: 'idle',
    snapshot: null,
    paymentTotal: null,
    pointsEarned: null,
    brandName: 'HAC',
    brandLogoUrl: null,
    paynowQrUrl: null,
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
        const brandName = payload?.brandName ?? 'HAC';
        const brandLogoUrl = payload?.brandLogoUrl ?? null;

        setState((prev) => {
          // During payment or post-payment, ignore ORDER_UPDATE but keep branding fresh.
          if (prev.phase === 'processing' || prev.phase === 'paynowQr' || prev.phase === 'thanks' || prev.phase === 'resetting') {
            return { ...prev, brandName, brandLogoUrl };
          }

          if (!hasItems) {
            return { phase: 'idle', snapshot: null, paymentTotal: null, pointsEarned: null, brandName, brandLogoUrl, paynowQrUrl: null };
          }

          return {
            phase: 'order',
            snapshot: payload,
            paymentTotal: null,
            pointsEarned: null,
            brandName,
            brandLogoUrl,
            paynowQrUrl: null,
          };
        });
      }

      if (msg.type === 'PAYMENT_START') {
        setState((prev) => ({
          ...prev,
          phase: 'processing',
          paymentTotal: msg.payload?.total ?? prev.snapshot?.total ?? 0,
          paynowQrUrl: null,
        }));
      }

      if (msg.type === 'PAYNOW_QR') {
        setState((prev) => ({
          ...prev,
          phase: 'paynowQr',
          snapshot: null,
          paymentTotal: msg.payload?.total ?? prev.snapshot?.total ?? prev.paymentTotal ?? 0,
          pointsEarned: null,
          paynowQrUrl: msg.payload?.qrUrl ?? null,
        }));
      }

      if (msg.type === 'PAYMENT_COMPLETE') {
        const total = msg.payload?.total ?? 0;
        const points = msg.payload?.pointsEarned ?? null;

        if (resetTimer) {
          window.clearTimeout(resetTimer);
        }

        setState((prev) => ({
          ...prev,
          phase: 'thanks',
          snapshot: null,
          paymentTotal: total,
          pointsEarned: points,
          paynowQrUrl: null,
        }));
      }

      if (msg.type === 'ORDER_COMPLETE') {
        setState((prev) => {
          const t = window.setTimeout(() => {
            setState((cur) => ({
              phase: 'idle',
              snapshot: null,
              paymentTotal: null,
              pointsEarned: null,
              brandName: cur.brandName,
              brandLogoUrl: cur.brandLogoUrl,
              paynowQrUrl: null,
            }));
            setResetTimer(null);
          }, IDLE_RESET_DELAY);
          setResetTimer(t);
          return { ...prev, phase: 'resetting' };
        });
      }
    };

    ch.addEventListener('message', handleMessage);
    // Ask the POS to send current branding/state so idle shows the shop logo.
    broadcast({ type: 'DISPLAY_HELLO' });

    return () => {
      ch.removeEventListener('message', handleMessage);
      try {
        ch.close();
      } catch {
        // ignore
      }
    };
  }, [resetTimer]);

  useEffect(() => {
    return () => {
      if (resetTimer) {
        window.clearTimeout(resetTimer);
      }
    };
  }, [resetTimer]);

  const { phase, snapshot, paymentTotal, pointsEarned, brandName, brandLogoUrl, paynowQrUrl } = state;

  const items: DisplayItem[] = snapshot?.items ?? [];
  const total = snapshot?.total ?? paymentTotal ?? 0;
  const displayBrandName = snapshot?.brandName ?? brandName;
  const logoUrl = snapshot?.brandLogoUrl ?? brandLogoUrl;

  const mark = (size: 'large' | 'small') =>
    logoUrl ? (
      <img className={`display-logo${size === 'small' ? ' small' : ''}`} src={logoUrl} alt={displayBrandName} />
    ) : (
      <div className={`display-mark${size === 'small' ? ' small' : ''}`} aria-hidden="true">
        {displayBrandName.slice(0, 3).toUpperCase()}
      </div>
    );

  return (
    <div className="customer-display">
      <div className="display-content">
        {/* IDLE / WELCOME */}
        {phase === 'idle' && (
          <div className="display-idle" key={phase}>
            <div className="display-brand">
              {mark('large')}
              <div className="display-brand-name">{displayBrandName}</div>
            </div>
            <div className="display-welcome">Welcome</div>
          </div>
        )}

        {/* ORDER ACTIVE */}
        {phase === 'order' && snapshot && (
          <div className="display-order" key={phase}>
            <div className="display-order-header">
              {mark('small')}
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
              {snapshot.discount > 0 && (
                <div className="display-total-row display-discount">
                  <span>Discount</span>
                  <strong>-{formatCurrency(snapshot.discount)}</strong>
                </div>
              )}
              {snapshot.loyaltyDiscount > 0 && (
                <div className="display-total-row display-discount">
                  <span>Loyalty</span>
                  <strong>-{formatCurrency(snapshot.loyaltyDiscount)}</strong>
                </div>
              )}
              {snapshot.voucherDiscount > 0 && (
                <div className="display-total-row display-discount">
                  <span>Vouchers</span>
                  <strong>-{formatCurrency(snapshot.voucherDiscount)}</strong>
                </div>
              )}
              <div className="display-total-row">
                <span>Total</span>
                <strong>{formatCurrency(total)}</strong>
              </div>
            </div>
          </div>
        )}

        {/* PAYMENT PROCESSING */}
        {phase === 'processing' && (
          <div className="display-processing" key={phase}>
            {mark('small')}
            <div className="display-processing-text">Processing payment…</div>
            <div className="display-processing-total">{formatCurrency(paymentTotal ?? total)}</div>
          </div>
        )}

        {/* MANUAL PAYNOW QR */}
        {phase === 'paynowQr' && paynowQrUrl && (
          <div className="display-paynow-qr" key={phase}>
            <div className="display-paynow-message">Scan and pay {formatCurrency(paymentTotal ?? total)}</div>
            <img src={paynowQrUrl} alt="PayNow QR code" />
            <div className="display-paynow-amount">{formatCurrency(paymentTotal ?? total)}</div>
          </div>
        )}

        {/* PAYMENT COMPLETE / THANK YOU */}
        {(phase === 'thanks' || phase === 'resetting') && (
          <div className="display-thanks" key={phase}>
            {mark('small')}
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

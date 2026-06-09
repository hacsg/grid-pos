import { FormEvent, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle, Clock, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { formatCurrency, redeemVoucher, validateVoucher } from '@/api/client';
import type { StaffSession } from '@/types';
import { tapFeedback } from '@/utils/haptics';

interface RecentRedemption {
  code: string;
  title: string;
  amount: number;
  redeemedAt: string;
}

const RECENT_KEY = 'pos_recent_redemptions';
const MAX_RECENT = 10;

function loadRecent(): RecentRedemption[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRecent(list: RecentRedemption[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch {
    // ignore storage errors
  }
}

interface VoucherRedemptionProps {
  session: StaffSession;
  onLogout?: () => void;
}

interface ValidatedVoucher {
  code: string;
  type: 'cdc' | 'acre_group';
  amount: number;
  id?: string;
}

export default function VoucherRedemption({ session, onLogout }: VoucherRedemptionProps) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [validated, setValidated] = useState<ValidatedVoucher | null>(null);
  const [justRedeemed, setJustRedeemed] = useState<ValidatedVoucher | null>(null);
  const [recent, setRecent] = useState<RecentRedemption[]>(() => loadRecent());
  const [now, setNow] = useState(() => new Date());

  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Live clock
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Autofocus input on mount and after clears
  useEffect(() => {
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(t);
  }, [validated, justRedeemed]);

  const timeLabel = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  function resetCurrent() {
    setValidated(null);
    setJustRedeemed(null);
    setCode('');
  }

  async function handleValidate(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;

    try {
      setLoading(true);
      const res = await validateVoucher(trimmed);
      const amount = Number(res.amount ?? 0);
      if (!amount || amount <= 0) {
        toast.error('Voucher has no value');
        return;
      }
      const v: ValidatedVoucher = {
        code: res.code,
        type: res.type,
        amount,
        id: res.id,
      };
      setValidated(v);
      setJustRedeemed(null);
      toast.success('Voucher validated');
    } catch (err: any) {
      const msg = err?.response?.data?.detail || 'Invalid or already redeemed';
      toast.error(typeof msg === 'string' ? msg : 'Could not validate voucher');
      setValidated(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleRedeem() {
    if (!validated) return;
    tapFeedback();

    try {
      setLoading(true);
      await redeemVoucher({
        code: validated.code,
        staff_id: session.staff.id,
        outlet: session.outlet.name,
      });

      const redeemed: RecentRedemption = {
        code: validated.code,
        title: validated.type === 'cdc' ? 'CDC Voucher' : 'Acre Group Voucher',
        amount: validated.amount,
        redeemedAt: new Date().toISOString(),
      };

      const nextRecent = [redeemed, ...recent.filter((r) => r.code.toUpperCase() !== redeemed.code.toUpperCase())].slice(0, MAX_RECENT);
      setRecent(nextRecent);
      saveRecent(nextRecent);

      setJustRedeemed(validated);
      setValidated(null);
      setCode('');

      toast.success('Voucher redeemed');

      // Refocus shortly after for next scan
      window.setTimeout(() => {
        inputRef.current?.focus();
      }, 120);
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || 'Redemption failed';
      toast.error(typeof msg === 'string' ? msg : 'Could not redeem voucher');
    } finally {
      setLoading(false);
    }
  }

  function openCamera() {
    tapFeedback();
    fileInputRef.current?.click();
  }

  function handleCameraChange() {
    // Camera capture is a fallback; user still enters/scans the code
    toast.success('Camera ready — enter or scan the code');
  }

  function handleNewScan() {
    tapFeedback();
    resetCurrent();
    window.setTimeout(() => inputRef.current?.focus(), 30);
  }

  function formatRedeemedTime(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  return (
    <div className="voucher-redemption">
      <header className="voucher-header">
        <div className="voucher-header-left">
          <div className="brand-mark" aria-hidden="true">G</div>
          <div>
            <div className="voucher-outlet">{session.outlet.name}</div>
            <div className="voucher-staff">{session.staff.name}</div>
          </div>
        </div>
        <div className="voucher-header-right">
          <div className="voucher-time" aria-label="Current time">
            <Clock size={18} aria-hidden="true" />
            <span>{timeLabel}</span>
          </div>
          {onLogout && (
            <button
              type="button"
              className="icon-text-button subtle voucher-signout"
              onPointerDown={() => tapFeedback()}
              onClick={onLogout}
            >
              Sign out
            </button>
          )}
        </div>
      </header>

      <main className="voucher-main">
        <div className="voucher-center">
          <h1 className="voucher-title">Voucher Redemption</h1>
          <p className="voucher-subtitle">Scan or enter voucher code</p>

          <form className="voucher-input-form" onSubmit={handleValidate}>
            <div className="voucher-input-wrap">
              <input
                ref={inputRef}
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Enter voucher code"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="search"
                disabled={loading}
                className="voucher-input"
              />
              <button
                type="button"
                className="voucher-camera-btn"
                onClick={openCamera}
                disabled={loading}
                aria-label="Use camera"
              >
                <Camera size={22} aria-hidden="true" />
              </button>
            </div>
            <button
              type="submit"
              className="primary-button voucher-validate-btn"
              disabled={loading || !code.trim()}
            >
              {loading ? 'Validating...' : 'Validate'}
            </button>
          </form>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="visually-hidden"
            onChange={handleCameraChange}
          />

          {/* Validated but not redeemed */}
          {validated && !justRedeemed && (
            <div className="voucher-card">
              <div className="voucher-card-head">
                <div className="voucher-card-type">
                  {validated.type === 'cdc' ? 'CDC Voucher' : 'Acre Group Voucher'}
                </div>
                <div className="voucher-card-amount">{formatCurrency(validated.amount)}</div>
              </div>
              <div className="voucher-card-code">{validated.code}</div>
              <button
                type="button"
                className="primary-button voucher-redeem-btn"
                onClick={handleRedeem}
                disabled={loading}
              >
                {loading ? 'Redeeming...' : 'Redeem Voucher'}
              </button>
            </div>
          )}

          {/* Success state after redeem */}
          {justRedeemed && (
            <div className="voucher-success">
              <div className="voucher-success-icon">
                <CheckCircle size={48} aria-hidden="true" />
              </div>
              <div className="voucher-success-title">Voucher redeemed</div>
              <div className="voucher-card" style={{ borderColor: 'var(--grid-success)' }}>
                <div className="voucher-card-head">
                  <div className="voucher-card-type">
                    {justRedeemed.type === 'cdc' ? 'CDC Voucher' : 'Acre Group Voucher'}
                  </div>
                  <div className="voucher-card-amount">{formatCurrency(justRedeemed.amount)}</div>
                </div>
                <div className="voucher-card-code">{justRedeemed.code}</div>
              </div>
              <button type="button" className="secondary-button" onClick={handleNewScan}>
                Redeem another
              </button>
            </div>
          )}

          {/* Recent redemptions */}
          <section className="voucher-recent">
            <div className="voucher-recent-header">
              <h2>Recent Redemptions</h2>
              <span className="voucher-recent-count">{recent.length} / {MAX_RECENT}</span>
            </div>

            {recent.length === 0 ? (
              <div className="voucher-recent-empty">No recent redemptions</div>
            ) : (
              <ul className="voucher-recent-list">
                {recent.map((r, index) => (
                  <li key={`${r.code}-${index}`} className="voucher-recent-item">
                    <div className="voucher-recent-main">
                      <div className="voucher-recent-title">{r.title}</div>
                      <div className="voucher-recent-code">{r.code}</div>
                    </div>
                    <div className="voucher-recent-meta">
                      <div className="voucher-recent-amount">{formatCurrency(r.amount)}</div>
                      <div className="voucher-recent-time">{formatRedeemedTime(r.redeemedAt)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>

      <footer className="voucher-footer">
        <div className="voucher-hint">USB QR scanners supported — focus is on the input field</div>
      </footer>
    </div>
  );
}

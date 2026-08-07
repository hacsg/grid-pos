import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle, ChevronDown, ChevronUp, Clock, Ticket, X } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import toast from 'react-hot-toast';
import {
  formatCurrency,
  getCustomerWithVouchers,
  money,
  recordVisitMoment,
  redeemVoucher,
  validateVoucher,
  type MemberWithVouchers,
  type PlotholdersVoucher,
} from '@/api/client';
import type { StaffSession } from '@/types';
import { tapFeedback } from '@/utils/haptics';
import { useScannerWedge } from '@/utils/useScannerWedge';
import { getScannerVoucherAffordance } from '@/utils/giftCards';

interface RecentRedemption {
  code: string;
  title: string;
  amount?: number;
  redeemedAt: string;
}

const RECENT_KEY = 'pos_recent_redemptions';
const MAX_RECENT = 10;
const QR_READER_ID = 'qr-reader-region';

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

interface ScannerProps {
  session: StaffSession;
  onLogout?: () => void;
}

interface ValidatedVoucher {
  code: string;
  type: 'cdc' | 'acre_group';
  amount?: number;
  id?: string;
  is_gift_card?: boolean;
}

interface QrScannerProps {
  onDetected: (code: string) => void;
  paused: boolean;
  onRequestResume: () => void;
}

function QrScanner({ onDetected, paused, onRequestResume }: QrScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const isStartingRef = useRef(false);
  const lastDetectedRef = useRef<string>('');

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current;
    if (scanner) {
      try {
        if (scanner.isScanning) {
          await scanner.stop();
        }
      } catch {
        // ignore stop errors
      }
      scannerRef.current = null;
    }
    setCameraReady(false);
  }, []);

  const startScanner = useCallback(async () => {
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    setError(null);

    try {
      await new Promise((resolve) => window.setTimeout(resolve, 300));
      if (!containerRef.current || !document.getElementById(QR_READER_ID)) {
        return;
      }

      // Create or reuse scanner instance
      let scanner = scannerRef.current;
      if (!scanner) {
        scanner = new Html5Qrcode(QR_READER_ID, { verbose: false });
        scannerRef.current = scanner;
      }

      const config = {
        fps: 8,
        qrbox: { width: 200, height: 200 },
        aspectRatio: 1.0,
      };

      const handleSuccess = (decodedText: string) => {
        const trimmed = decodedText.trim();
        if (!trimmed || trimmed === lastDetectedRef.current) return;
        lastDetectedRef.current = trimmed;

        // Visual success flash
        setFlash(true);
        window.setTimeout(() => setFlash(false), 420);

        // Pause immediately to prevent duplicate triggers
        try {
          if (scanner && scanner.isScanning) {
            scanner.pause(true);
          }
        } catch {
          // ignore
        }

        onDetected(trimmed);
      };

      const handleFrameError = () => {
        // Per-frame decode failures are noisy; ignore
      };

      const stopActiveScanner = async () => {
        try {
          if (scanner && scanner.isScanning) {
            await scanner.stop();
          }
        } catch (stopError) {
          console.error('QR scanner failed to stop after a failed start attempt:', stopError);
        }
      };

      try {
        await scanner.start({ facingMode: 'environment' }, config, handleSuccess, handleFrameError);
        setCameraReady(true);
        return;
      } catch (environmentError) {
        console.error('QR scanner failed to start with environment facing mode:', environmentError);
        await stopActiveScanner();
      }

      try {
        const cameras = await Html5Qrcode.getCameras();
        const backCamera = cameras.find((camera) =>
          /back|rear|environment|world/i.test(camera.label || '')
        );

        if (backCamera) {
          try {
            await scanner.start(backCamera.id, config, handleSuccess, handleFrameError);
            setCameraReady(true);
            return;
          } catch (backCameraError) {
            console.error('QR scanner failed to start with explicit back camera:', backCameraError);
            await stopActiveScanner();
          }
        }
      } catch (cameraListError) {
        console.error('QR scanner failed to enumerate cameras:', cameraListError);
      }

      try {
        await scanner.start(
          {} as MediaTrackConstraints,
          { ...config, videoConstraints: {} },
          handleSuccess,
          handleFrameError
        );
        setCameraReady(true);
        return;
      } catch (defaultCameraError) {
        console.error('QR scanner failed to start with default camera:', defaultCameraError);
        throw defaultCameraError;
      }
    } catch (err: any) {
      const msg = String(err?.message || err || '');
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')) {
        setError('Camera permission denied. Enable camera access in your browser settings.');
      } else if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('no camera')) {
        setError('No camera found on this device.');
      } else {
        setError('Could not start camera. You can enter the code manually below.');
      }
      setCameraReady(false);
    } finally {
      isStartingRef.current = false;
    }
  }, [onDetected]);

  // Manage start/stop/pause/resume based on paused prop
  useEffect(() => {
    let cancelled = false;

    const manage = async () => {
      if (cancelled) return;

      if (paused) {
        const scanner = scannerRef.current;
        if (scanner && scanner.isScanning) {
          try {
            scanner.pause(true);
          } catch {
            // ignore
          }
        }
        return;
      }

      // Not paused: ensure running
      const scanner = scannerRef.current;
      if (scanner && scanner.isScanning) {
        try {
          // resume if paused
          if ((scanner as any).getState && (scanner as any).getState() === 3 /* PAUSED */) {
            await scanner.resume();
          } else {
            // already scanning
          }
          lastDetectedRef.current = '';
        } catch {
          // If resume fails, try full restart
          await stopScanner();
          if (!cancelled) await startScanner();
        }
        return;
      }

      // No scanner or not scanning: start fresh
      await startScanner();
    };

    manage();

    return () => {
      cancelled = true;
    };
  }, [paused, startScanner, stopScanner]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const doStop = async () => {
        await stopScanner();
      };
      void doStop();
    };
  }, [stopScanner]);

  const handleRetryCamera = () => {
    setError(null);
    lastDetectedRef.current = '';
    void startScanner();
    onRequestResume();
  };

  return (
    <div className="qr-scanner-wrap">
      <div
        id={QR_READER_ID}
        ref={containerRef}
        className={`qr-reader ${cameraReady ? 'ready' : ''}`}
      />

      {/* Camera overlay frame + corners */}
      <div className={`qr-overlay ${flash ? 'flash' : ''}`} aria-hidden="true">
        <div className="qr-frame">
          <div className="qr-corner tl" />
          <div className="qr-corner tr" />
          <div className="qr-corner bl" />
          <div className="qr-corner br" />
        </div>
        <div className="qr-scan-hint">Align QR code inside the frame</div>
      </div>

      {error && (
        <div className="qr-error">
          <div className="qr-error-text">{error}</div>
          <button type="button" className="qr-retry-btn" onClick={handleRetryCamera}>
            Try again
          </button>
        </div>
      )}

      {!cameraReady && !error && (
        <div className="qr-starting">Starting camera…</div>
      )}

      {cameraReady && paused && (
        <button
          type="button"
          className="qr-resume-hint"
          onClick={onRequestResume}
          aria-label="Resume scanning"
        >
          Tap to resume scanning
        </button>
      )}
    </div>
  );
}

export default function Scanner({ session, onLogout }: ScannerProps) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [validated, setValidated] = useState<ValidatedVoucher | null>(null);
  const [justRedeemed, setJustRedeemed] = useState<ValidatedVoucher | null>(null);
  const [member, setMember] = useState<MemberWithVouchers | null>(null);
  const [momentAwarded, setMomentAwarded] = useState(false);
  const [redeemedMemberCodes, setRedeemedMemberCodes] = useState<string[]>([]);
  const [redeemingCode, setRedeemingCode] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentRedemption[]>(() => loadRecent());
  const [now, setNow] = useState(() => new Date());
  const [scannerPaused, setScannerPaused] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Live clock
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) {
        setNow(new Date());
      }
    };
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  const timeLabel = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  function resetForNext() {
    setValidated(null);
    setJustRedeemed(null);
    setMember(null);
    setMomentAwarded(false);
    setRedeemedMemberCodes([]);
    setCode('');
    setManualOpen(false);
    setScannerPaused(false);
  }

  // One scan, two possibilities: a voucher code or a membership QR. The
  // membership QR is the Plotholders customer id — a UUID — while voucher QRs
  // encode human-readable codes, so the shape of the scan picks the order:
  // UUIDs go straight to the member lookup (one fast request), everything
  // else is tried as a voucher first. A recognised member gets one visit
  // moment on the spot and their active vouchers are shown for redemption.
  const resolveScan = useCallback(async (scanned: string) => {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scanned);

    const tryVoucher = async (): Promise<boolean> => {
      try {
        const res = await validateVoucher(scanned, { silent: true });
        const amount = res.amount != null ? Number(res.amount) : 0;
        setValidated({
          code: res.code,
          type: res.type,
          amount: amount > 0 ? amount : undefined,
          id: res.id,
        });
        setJustRedeemed(null);
        return true; // keep scanner paused while showing the voucher card
      } catch (err: any) {
        if (err?.response?.status === 409) {
          // A 409 is no longer only "already redeemed" — an unactivated gift
          // card lands here too, and the difference decides what the person at
          // the counter does next, so show the server's own reason.
          const msg = err?.response?.data?.detail;
          toast.error(typeof msg === 'string' ? msg : 'Voucher has already been redeemed');
          setScannerPaused(false);
          setCode('');
          return true; // definitively a voucher — stop here
        }
        return false;
      }
    };

    const tryMember = async (): Promise<boolean> => {
      let found: MemberWithVouchers;
      try {
        found = await getCustomerWithVouchers(scanned, { silent: true });
      } catch {
        return false;
      }
      let awarded = false;
      try {
        await recordVisitMoment(String(found.customer_id || found.member_id), session.outlet.name);
        awarded = true;
      } catch {
        // The check-in still shows the member and vouchers; the moment can be
        // retried by scanning again.
      }
      setMember(found);
      setMomentAwarded(awarded);
      setRedeemedMemberCodes([]);
      if (awarded) toast.success(`+1 moment for ${found.name || 'member'}`);
      return true;
    };

    setLoading(true);
    try {
      const resolved = isUuid
        ? (await tryMember()) || (await tryVoucher())
        : (await tryVoucher()) || (await tryMember());
      if (!resolved) {
        toast.error('Code not recognised — not a voucher or member QR');
        setScannerPaused(false);
        setCode('');
      }
    } finally {
      setLoading(false);
    }
  }, [session.outlet.name]);

  // Called by QR scanner when a code is decoded
  const handleQrDetected = useCallback(async (detectedCode: string) => {
    if (loading || validated || justRedeemed || member) return;
    setCode(detectedCode);
    setScannerPaused(true);
    await resolveScan(detectedCode);
  }, [loading, validated, justRedeemed, member, resolveScan]);

  const requestScannerResume = useCallback(() => {
    setScannerPaused(false);
  }, []);

  // Hardware wedge scanner (keyboard emulation) — the primary path on this POS,
  // whose client-facing scanner is not a camera. Disabled while the manual code
  // field is open so typed input isn't double-handled.
  useScannerWedge({
    enabled: !manualOpen && !loading && !validated && !justRedeemed && !member,
    onScan: (scanned) => { void handleQrDetected(scanned); },
  });

  async function handleValidate(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    setScannerPaused(true);
    await resolveScan(trimmed);
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
        amount: validated.amount && validated.amount > 0 ? validated.amount : undefined,
        redeemedAt: new Date().toISOString(),
      };

      const nextRecent = [redeemed, ...recent.filter((r) => r.code.toUpperCase() !== redeemed.code.toUpperCase())].slice(0, MAX_RECENT);
      setRecent(nextRecent);
      saveRecent(nextRecent);

      setJustRedeemed(validated);
      setValidated(null);
      setCode('');

      toast.success('Voucher redeemed');

      // After success, reset and resume camera for next voucher
      window.setTimeout(() => {
        setJustRedeemed(null);
        setScannerPaused(false);
      }, 1350);
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || 'Redemption failed';
      toast.error(typeof msg === 'string' ? msg : 'Could not redeem voucher');
      // On error, allow retry; keep paused so user sees the error state
    } finally {
      setLoading(false);
    }
  }

  function handleCancelValidated() {
    tapFeedback();
    setValidated(null);
    setCode('');
    setScannerPaused(false);
  }

  // Redeem one of the member's own vouchers, straight from the check-in card.
  async function handleRedeemMemberVoucher(v: PlotholdersVoucher) {
    tapFeedback();
    setRedeemingCode(v.code);
    try {
      await redeemVoucher({
        code: v.code,
        staff_id: session.staff.id,
        outlet: session.outlet.name,
      });
      const amount = v.amount != null ? money(v.amount) : v.discount_cents != null ? v.discount_cents / 100 : 0;
      const redeemed: RecentRedemption = {
        code: v.code,
        title: v.title || 'Member Voucher',
        amount: amount > 0 ? amount : undefined,
        redeemedAt: new Date().toISOString(),
      };
      const nextRecent = [redeemed, ...recent.filter((r) => r.code.toUpperCase() !== redeemed.code.toUpperCase())].slice(0, MAX_RECENT);
      setRecent(nextRecent);
      saveRecent(nextRecent);
      setRedeemedMemberCodes((prev) => [...prev, v.code.toUpperCase()]);
      toast.success('Voucher redeemed');
    } catch (err: any) {
      const msg = err?.response?.data?.detail || 'Redemption failed';
      toast.error(typeof msg === 'string' ? msg : 'Could not redeem voucher');
    } finally {
      setRedeemingCode(null);
    }
  }

  function openManualFilePicker() {
    tapFeedback();
    fileInputRef.current?.click();
  }

  function handleFileInputChange() {
    // Photo capture fallback — user will still type or the image is just for reference
    toast.success('Photo captured — enter the code from the image');
    setManualOpen(true);
    // Focus the input shortly after
    window.setTimeout(() => inputRef.current?.focus(), 80);
  }

  function handleNewScan() {
    tapFeedback();
    resetForNext();
  }

  function toggleManual() {
    tapFeedback();
    setManualOpen((v) => !v);
  }

  function formatRedeemedTime(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  const hasActiveResult = !!validated || !!justRedeemed || !!member;
  const memberVouchers = member?.vouchers ?? [];

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
          <div className="voucher-title-row">
            <h1 className="voucher-title">Scanner</h1>
            <p className="voucher-subtitle">Scan a voucher or member QR — members check in for a moment</p>
          </div>

          {/* AUTO QR CAMERA */}
          <section className="qr-section">
            <QrScanner
              onDetected={handleQrDetected}
              paused={scannerPaused || hasActiveResult}
              onRequestResume={requestScannerResume}
            />

            {loading && (
              <div className="qr-checking" role="status" aria-live="polite">
                <span className="qr-checking-spinner" aria-hidden="true" />
                Checking code…
              </div>
            )}

            {/* Scan manually / photo fallback */}
            <div className="qr-actions">
              <button
                type="button"
                className="qr-manual-btn"
                onClick={openManualFilePicker}
                disabled={loading}
              >
                <Camera size={18} aria-hidden="true" />
                Scan manually
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="visually-hidden"
                onChange={handleFileInputChange}
              />
            </div>
          </section>

          {/* VALIDATED RESULT — slides up / prominent card */}
          {validated && !justRedeemed && (
            <div className="voucher-result-sheet">
              <div className="voucher-result-card">
                <button
                  type="button"
                  className="voucher-result-close"
                  onClick={handleCancelValidated}
                  aria-label="Cancel"
                >
                  <X size={20} />
                </button>

                <div className="voucher-result-type">
                  {validated.type === 'cdc' ? 'CDC Voucher' : 'Acre Group Voucher'}
                </div>
                {validated.amount && validated.amount > 0 ? (
                  <div className="voucher-result-amount">{formatCurrency(validated.amount)}</div>
                ) : (
                  <div className="voucher-result-amount" style={{ fontSize: '1rem', opacity: 0.8 }}>No monetary value</div>
                )}
                <div className="voucher-result-code">{validated.code}</div>

                {validated.is_gift_card ? (
                  <div className="voucher-result-instruction" style={{ padding: '1rem', backgroundColor: '#f3f4f6', borderRadius: '8px', marginBottom: '1rem', textAlign: 'center' }}>
                    <p style={{ margin: 0, fontWeight: 500, color: '#374151' }}>Add items to the sale and apply this at checkout.</p>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="primary-button voucher-redeem-btn-large"
                    onClick={handleRedeem}
                    disabled={loading}
                  >
                    {loading ? 'Redeeming…' : 'Redeem Voucher'}
                  </button>
                )}
                <button
                  type="button"
                  className="voucher-cancel-link"
                  onClick={handleCancelValidated}
                  disabled={loading}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* MEMBER CHECK-IN — moment awarded + their vouchers */}
          {member && (
            <div className="voucher-result-sheet">
              <div className="voucher-result-card">
                <button
                  type="button"
                  className="voucher-result-close"
                  onClick={handleNewScan}
                  aria-label="Done"
                >
                  <X size={20} />
                </button>

                <div className="voucher-result-type">Member Check-in</div>
                <div className="voucher-result-amount" style={{ fontSize: '1.5rem' }}>
                  {member.name || 'Member'}
                </div>
                <div className="voucher-result-code member-checkin-meta">
                  {momentAwarded
                    ? `+1 moment recorded · ${(member.points ?? 0) + 1} total`
                    : 'Moment could not be recorded — scan again to retry'}
                </div>

                <div className="loyalty-vouchers" style={{ textAlign: 'left', width: '100%' }}>
                  <p className="loyalty-vouchers-title">
                    <Ticket size={16} aria-hidden="true" /> Active vouchers
                  </p>
                  {memberVouchers.length === 0 && (
                    <p className="loyalty-vouchers-empty">No active vouchers.</p>
                  )}
                  {memberVouchers.map((v) => {
                    const amount = v.amount != null ? money(v.amount) : v.discount_cents != null ? v.discount_cents / 100 : 0;
                    const isRedeemed = redeemedMemberCodes.includes(v.code.toUpperCase());
                    return (
                      <div className="loyalty-voucher-row" key={v.id || v.code}>
                        <div>
                          <strong>{v.title || v.code}</strong>
                          <span>{amount > 0 ? formatCurrency(amount) : v.description || v.code}</span>
                        </div>
                        {v.is_gift_card ? (
                          <div style={{ fontSize: '0.85rem', color: '#6b7280', textAlign: 'right' }}>
                            Add items to the sale and<br/>apply this at checkout.
                          </div>
                        ) : (
                          <button
                            className={isRedeemed ? 'secondary-button' : 'primary-button'}
                            type="button"
                            disabled={isRedeemed || redeemingCode === v.code}
                            onClick={() => void handleRedeemMemberVoucher(v)}
                          >
                            {isRedeemed ? 'Redeemed' : redeemingCode === v.code ? 'Redeeming…' : 'Redeem'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  className="primary-button voucher-redeem-btn-large"
                  onClick={handleNewScan}
                >
                  Done — next scan
                </button>
              </div>
            </div>
          )}

          {/* Success state */}
          {justRedeemed && (
            <div className="voucher-result-sheet">
            <div className="voucher-success">
              <div className="voucher-success-icon">
                <CheckCircle size={52} aria-hidden="true" />
              </div>
              <div className="voucher-success-title">Voucher redeemed</div>
              <div className="voucher-success-meta">
                {justRedeemed.type === 'cdc' ? 'CDC Voucher' : 'Acre Group Voucher'}
                {justRedeemed.amount && justRedeemed.amount > 0 ? ` · ${formatCurrency(justRedeemed.amount)}` : ''}
              </div>
              <div className="voucher-success-code">{justRedeemed.code}</div>

              <button type="button" className="primary-button voucher-next-btn" onClick={handleNewScan}>
                Redeem next voucher
              </button>
            </div>
            </div>
          )}

          {/* Manual entry (collapsed by default) */}
          <section className="manual-section">
            <button
              type="button"
              className="manual-toggle"
              onClick={toggleManual}
              aria-expanded={manualOpen}
            >
              <span>Enter code manually</span>
              {manualOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>

            {manualOpen && (
              <form className="manual-form" onSubmit={handleValidate}>
                <div className="manual-input-wrap">
                  <input
                    ref={inputRef}
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Enter voucher code or member ID"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="search"
                    disabled={loading || !!validated || !!member}
                    className="manual-input"
                  />
                </div>
                <div className="manual-actions">
                  <button
                    type="submit"
                    className="primary-button manual-validate-btn"
                    disabled={loading || !code.trim() || !!validated || !!member}
                  >
                    {loading ? 'Validating…' : 'Validate'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => { setManualOpen(false); setCode(''); }}
                    disabled={loading}
                  >
                    Close
                  </button>
                </div>
              </form>
            )}
          </section>

          {/* Recent redemptions — horizontal scroll on mobile */}
          <section className="voucher-recent">
            <div className="voucher-recent-header">
              <h2>Recent Redemptions</h2>
              <span className="voucher-recent-count">{recent.length} / {MAX_RECENT}</span>
            </div>

            {recent.length === 0 ? (
              <div className="voucher-recent-empty">No recent redemptions</div>
            ) : (
              <div className="voucher-recent-scroll">
                {recent.map((r, index) => (
                  <div key={`${r.code}-${index}`} className="voucher-recent-card">
                    <div className="voucher-recent-card-title">{r.title}</div>
                    <div className="voucher-recent-card-code">{r.code}</div>
                    <div className="voucher-recent-card-meta">
                      {r.amount && r.amount > 0 ? (
                        <span className="voucher-recent-card-amount">{formatCurrency(r.amount)}</span>
                      ) : (
                        <span className="voucher-recent-card-amount" style={{ opacity: 0.7 }}>No value</span>
                      )}
                      <span className="voucher-recent-card-time">{formatRedeemedTime(r.redeemedAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>

      <footer className="voucher-footer">
        <div className="voucher-hint">Camera auto-starts • USB scanners supported</div>
      </footer>
    </div>
  );
}

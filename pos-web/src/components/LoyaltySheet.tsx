import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BadgePercent, Camera, Search, UserRound, X } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
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

const QR_READER_ID = 'qr-reader-loyalty';

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
  const onDetectedRef = useRef(onDetected);

  // Keep ref updated without causing re-renders
  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

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

        onDetectedRef.current(trimmed);
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
        setError('Could not start camera. You can enter the phone manually below.');
      }
      setCameraReady(false);
    } finally {
      isStartingRef.current = false;
    }
  }, []);

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
  const [showScanner, setShowScanner] = useState(false);
  const [scannerPaused, setScannerPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const rewards = useMemo(() => deriveRewards(selectedCustomer), [selectedCustomer]);
  const lifetimeMoments = selectedCustomer?.lifetime_moments ?? selectedCustomer?.points ?? 0;

  useEffect(() => {
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 80);
    } else {
      setShowScanner(false);
      setScannerPaused(true);
      setLookupCode('');
    }
  }, [open]);

  if (!open) {
    return null;
  }

  async function submitLookup(event?: FormEvent<HTMLFormElement>, codeOverride?: string) {
    event?.preventDefault();
    const code = (codeOverride ?? lookupCode).trim();
    if (!code) {
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const customer = await lookupLoyalty(code);
      onCustomerSelect(customer);
      setLookupCode('');
    } catch (err) {
      console.error('Loyalty lookup failed:', err);
      setError('Lookup failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function toggleScanner() {
    tapFeedback();
    const next = !showScanner;
    setShowScanner(next);
    if (next) {
      setScannerPaused(false);
    } else {
      setScannerPaused(true);
    }
  }

  const requestScannerResume = useCallback(() => {
    setScannerPaused(false);
  }, []);

  const handleQrDetected = useCallback((detectedCode: string) => {
    const trimmed = detectedCode.trim();
    if (!trimmed || loading) return;

    setLookupCode(trimmed);
    setScannerPaused(true);

    // Auto-submit lookup on successful QR scan
    void (async () => {
      try {
        setLoading(true);
        const customer = await lookupLoyalty(trimmed);
        onCustomerSelect(customer);
        setLookupCode('');
        setShowScanner(false);
      } catch {
        // Interceptor toasts error; resume scanner for retry
        setScannerPaused(false);
        setLookupCode('');
      } finally {
        setLoading(false);
      }
    })();
  }, [loading, lookupLoyalty, onCustomerSelect]);

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
                style={{ flex: '1 1 auto', width: '1px' }}
              />
              <button
                type="button"
                className="icon-button"
                aria-label="Scan member QR code"
                title="Scan QR"
                onPointerDown={() => tapFeedback()}
                onClick={toggleScanner}
                disabled={loading}
                style={{ width: 36, height: 36, flex: '0 0 36px', border: 'none', background: 'transparent', padding: 0 }}
              >
                <Camera size={18} aria-hidden="true" />
              </button>
            </div>
          </label>
          <button className="primary-button" type="submit" disabled={loading || !lookupCode.trim()}>
            Lookup
          </button>
        </form>

        {error && (
          <div style={{ color: '#dc2626', padding: '8px 16px', fontSize: 14, textAlign: 'center' }}>
            {error}
          </div>
        )}

        {showScanner && (
          <section className="qr-section">
            <QrScanner
              onDetected={handleQrDetected}
              paused={scannerPaused || loading}
              onRequestResume={requestScannerResume}
            />
            <div className="qr-actions">
              <button
                type="button"
                className="qr-manual-btn"
                onClick={toggleScanner}
                disabled={loading}
              >
                Close camera
              </button>
            </div>
          </section>
        )}

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

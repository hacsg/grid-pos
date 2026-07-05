import { useRef, useState } from 'react';
import { CheckCircle2, QrCode, Search, X } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { api, formatCurrency, lookupLoyalty, type LoyaltyMember } from '@/api/client';
import { tapFeedback } from '@/utils/haptics';
import { useScannerWedge } from '@/utils/useScannerWedge';
import type { StaffSession, Totals } from '@/types';

interface LoyaltySheetProps {
  open: boolean;
  session: StaffSession;
  totals: Totals;
  onClose: () => void;
}

const QR_READER_ID = 'qr-reader-loyalty-simple';

type Status = 'idle' | 'scanning' | 'looking' | 'found' | 'earning' | 'success' | 'error';

export default function LoyaltySheet({ open, session, totals, onClose }: LoyaltySheetProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [code, setCode] = useState('');
  const [member, setMember] = useState<LoyaltyMember | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  // Hardware wedge scanner (keyboard emulation): scanning the member QR at any
  // time while the sheet is open looks the member up — no camera needed.
  useScannerWedge({
    enabled: open && (status === 'idle' || status === 'error' || status === 'looking'),
    onScan: (scanned) => { void handleLookup(scanned); },
  });

  if (!open) {
    return null;
  }

  function resetState() {
    setStatus('idle');
    setMessage('');
    setCode('');
    setMember(null);
  }

  async function stopScanner() {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (scanner) {
      try {
        await scanner.stop();
      } catch {
        // already stopped
      }
    }
  }

  async function earnFor(memberId: string) {
    setStatus('earning');
    setMessage('Recording points…');
    try {
      const response = await api.post('/loyalty/earn', {
        customer_id: memberId,
        order_total: totals.total,
        outlet: session.outlet.name,
      });
      const earned = response.data?.points_earned;
      setStatus('success');
      setMessage(earned != null ? `${earned} points earned` : 'Points recorded');
      tapFeedback();
    } catch (err: any) {
      setStatus('error');
      setMessage(err?.response?.data?.detail || 'Failed to record points. Please try again.');
    }
  }

  async function handleLookup(value?: string) {
    const trimmed = (value ?? code).trim();
    if (!trimmed) {
      setMessage('Enter a phone number or member ID');
      return;
    }
    tapFeedback();
    setCode(trimmed);
    setStatus('looking');
    setMessage('');
    try {
      const found = await lookupLoyalty(trimmed);
      setMember(found);
      setStatus('found');
    } catch (err: any) {
      setStatus('error');
      setMessage(err?.response?.data?.detail || 'Member not found. Check the number and try again.');
    }
  }

  async function handleScan() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('error');
      setMessage('No camera available on this device. Enter the member number instead.');
      return;
    }
    tapFeedback();
    setStatus('scanning');
    setMessage('Point camera at the Acre Club QR code…');

    const scanner = new Html5Qrcode(QR_READER_ID, { verbose: false });
    scannerRef.current = scanner;

    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        async (decodedText) => {
          await stopScanner();
          await earnFor(decodedText.trim());
        },
        () => {}
      );
    } catch {
      scannerRef.current = null;
      setStatus('error');
      setMessage('Could not start the camera. Allow camera access or enter the member number.');
    }
  }

  async function handleClose() {
    await stopScanner();
    resetState();
    onClose();
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="loyalty-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="loyalty-title"
        style={{ maxWidth: '420px', margin: 'auto' }}
      >
        <header className="sheet-header">
          <div>
            <p>Acre Club</p>
            <h2 id="loyalty-title">Earn points</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close"
            onClick={handleClose}
            onPointerDown={() => tapFeedback()}
          >
            <X size={20} />
          </button>
        </header>

        <div className="loyalty-body">
          {(status === 'idle' || status === 'looking' || status === 'error') && (
            <>
              <p className="loyalty-prompt">Scan the member's Acre Club QR with the counter scanner, or look them up by phone.</p>
              <div className="loyalty-lookup">
                <label className="search-field">
                  <Search size={20} aria-hidden="true" />
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleLookup();
                    }}
                    placeholder="Phone number or member ID"
                    inputMode="tel"
                    autoFocus
                  />
                </label>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => handleLookup()}
                  onPointerDown={() => tapFeedback()}
                  disabled={status === 'looking'}
                >
                  {status === 'looking' ? 'Looking up…' : 'Look up'}
                </button>
              </div>

              <button
                className="secondary-button loyalty-scan-btn"
                type="button"
                onClick={handleScan}
                onPointerDown={() => tapFeedback()}
              >
                <QrCode size={18} aria-hidden="true" />
                Scan QR code instead
              </button>

              <p className="loyalty-total">Order total: {formatCurrency(totals.total)}</p>

              {status === 'error' && message && <p className="form-error">{message}</p>}
            </>
          )}

          {status === 'scanning' && (
            <>
              <div id={QR_READER_ID} className="loyalty-scanner" />
              <p className="loyalty-prompt">{message}</p>
              <button
                className="secondary-button"
                type="button"
                onClick={async () => {
                  await stopScanner();
                  resetState();
                }}
              >
                Cancel scan
              </button>
            </>
          )}

          {status === 'found' && member && (
            <>
              <div className="loyalty-member-card">
                <div className="loyalty-member-top">
                  <strong>{member.name}</strong>
                  <span className="tier-badge">{member.tier}</span>
                </div>
                <p>
                  {member.points} pts available
                  {member.phone ? ` · ${member.phone}` : ''}
                </p>
              </div>
              <p className="loyalty-total">Order total: {formatCurrency(totals.total)}</p>
              <button
                className="primary-button loyalty-confirm"
                type="button"
                onClick={() => earnFor(member.customer_id || member.member_id)}
                onPointerDown={() => tapFeedback()}
              >
                Earn points for this sale
              </button>
              <button className="secondary-button" type="button" onClick={resetState}>
                Use a different member
              </button>
            </>
          )}

          {status === 'earning' && <p className="loyalty-prompt">{message}</p>}

          {status === 'success' && (
            <>
              <div className="loyalty-result success">
                <CheckCircle2 size={52} aria-hidden="true" />
              </div>
              <p className="loyalty-result-msg">{message}</p>
              <button
                className="primary-button"
                type="button"
                onClick={handleClose}
                onPointerDown={() => tapFeedback()}
              >
                Done
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

import { useRef, useState } from 'react';
import { CheckCircle2, QrCode, Search, Ticket, UserPlus, X } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  formatCurrency,
  getCustomerWithVouchers,
  lookupLoyalty,
  money,
  type LoyaltyMember,
  type MemberWithVouchers,
  type PlotholdersVoucher,
} from '@/api/client';
import { tapFeedback } from '@/utils/haptics';
import { useScannerWedge } from '@/utils/useScannerWedge';
import type { AppliedVoucher, StaffSession, Totals } from '@/types';

interface LoyaltySheetProps {
  open: boolean;
  session: StaffSession;
  totals: Totals;
  appliedCodes: string[];
  onSelectCustomer: (member: LoyaltyMember) => void;
  onApplyVoucher: (voucher: AppliedVoucher) => void;
  onClose: () => void;
}

const QR_READER_ID = 'qr-reader-loyalty-simple';

type Status = 'idle' | 'scanning' | 'looking' | 'found' | 'error';

/** Map a Plotholders voucher to the order's AppliedVoucher shape. */
function toAppliedVoucher(v: PlotholdersVoucher): AppliedVoucher {
  const amount =
    v.amount != null ? money(v.amount) : v.discount_cents != null ? v.discount_cents / 100 : 0;
  const type = (v.type || '').toLowerCase() === 'cdc' ? 'cdc' : 'acre_group';
  return { code: v.code, type, amount, id: v.id };
}

export default function LoyaltySheet({
  open,
  session,
  totals,
  appliedCodes,
  onSelectCustomer,
  onApplyVoucher,
  onClose,
}: LoyaltySheetProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [code, setCode] = useState('');
  const [member, setMember] = useState<MemberWithVouchers | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  // Hardware wedge scanner (keyboard emulation): the membership QR encodes the
  // Plotholders customer id, so a scan pulls up the member and their active
  // vouchers — no camera needed.
  // Also enabled while the camera view is up ('scanning') — this POS uses a
  // hardware wedge scanner, not a camera, so a scan must resolve even there.
  useScannerWedge({
    enabled: open && (status === 'idle' || status === 'error' || status === 'scanning'),
    onScan: (scanned) => { void stopScanner().then(() => loadById(scanned.trim())); },
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

  // Scan path: the QR value is the customer id → member + active vouchers.
  async function loadById(customerId: string) {
    if (!customerId) return;
    setStatus('looking');
    setMessage('');
    try {
      const found = await getCustomerWithVouchers(customerId);
      setMember(found);
      setStatus('found');
      tapFeedback();
    } catch (err: any) {
      setStatus('error');
      setMessage(err?.response?.data?.detail || 'Member not found. Try their phone number instead.');
    }
  }

  // Manual path: phone lookup, then pull their vouchers by the returned id.
  async function handleLookup(value?: string) {
    const trimmed = (value ?? code).trim();
    if (!trimmed) {
      setMessage('Enter a phone number');
      return;
    }
    tapFeedback();
    setCode(trimmed);
    setStatus('looking');
    setMessage('');
    try {
      const found = await lookupLoyalty(trimmed);
      const id = found.customer_id || found.member_id;
      const { vouchers: _legacy, ...base } = found;
      let withVouchers: MemberWithVouchers = base;
      try {
        withVouchers = await getCustomerWithVouchers(id);
      } catch {
        // Lookup succeeded but voucher fetch failed — still let staff attach.
      }
      setMember(withVouchers);
      setStatus('found');
    } catch (err: any) {
      setStatus('error');
      setMessage(err?.response?.data?.detail || 'Member not found. Check the number and try again.');
    }
  }

  async function handleScan() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('error');
      setMessage('No camera on this device — use the counter scanner or enter the phone number.');
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
          await loadById(decodedText.trim());
        },
        () => {}
      );
    } catch {
      scannerRef.current = null;
      setStatus('error');
      setMessage('Could not start the camera. Use the counter scanner or enter the phone number.');
    }
  }

  function handleAttach() {
    if (!member) return;
    tapFeedback();
    const { vouchers: _v, ...memberOnly } = member;
    onSelectCustomer(memberOnly);
    void handleClose();
  }

  async function handleClose() {
    await stopScanner();
    resetState();
    onClose();
  }

  const applied = new Set(appliedCodes.map((c) => c.toUpperCase()));
  const vouchers = member?.vouchers ?? [];

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="loyalty-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="loyalty-title"
        style={{ maxWidth: '440px', margin: 'auto' }}
      >
        <header className="sheet-header">
          <div>
            <p>Acre Club</p>
            <h2 id="loyalty-title">Member &amp; vouchers</h2>
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
                    placeholder="Phone number"
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
                Use camera instead
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
                  <strong>{member.name || 'Acre Club member'}</strong>
                  <span className="tier-badge">{member.tier}</span>
                </div>
                <p>
                  {member.lifetime_moments ?? member.points ?? 0} visits
                  {member.phone ? ` · ${member.phone}` : ''}
                </p>
              </div>

              <button
                className="primary-button loyalty-confirm"
                type="button"
                onClick={handleAttach}
                onPointerDown={() => tapFeedback()}
              >
                <UserPlus size={18} aria-hidden="true" />
                Add member to this sale
              </button>

              <div className="loyalty-vouchers">
                <p className="loyalty-vouchers-title">
                  <Ticket size={16} aria-hidden="true" /> Active vouchers
                </p>
                {vouchers.length === 0 && <p className="loyalty-vouchers-empty">No active vouchers.</p>}
                {vouchers.map((v) => {
                  const isApplied = applied.has(v.code.toUpperCase());
                  const av = toAppliedVoucher(v);
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
                        onClick={() => { tapFeedback(); onApplyVoucher(av); }}
                      >
                        {isApplied ? 'Applied' : 'Apply'}
                      </button>
                    </div>
                  );
                })}
              </div>

              <button className="secondary-button" type="button" onClick={resetState}>
                Use a different member
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

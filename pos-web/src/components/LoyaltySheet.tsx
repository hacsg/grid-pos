import { useState } from 'react';
import { QrCode, X } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { api } from '@/api/client';
import { tapFeedback } from '@/utils/haptics';
import type { StaffSession, Totals } from '@/types';

interface LoyaltySheetProps {
  open: boolean;
  session: StaffSession;
  totals: Totals;
  onClose: () => void;
}

const QR_READER_ID = 'qr-reader-loyalty-simple';

export default function LoyaltySheet({ open, session, totals, onClose }: LoyaltySheetProps) {
  const [status, setStatus] = useState<'idle' | 'scanning' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  if (!open) {
    return null;
  }

  const handleScan = async () => {
    setStatus('scanning');
    setMessage('Point camera at QR code...');

    const scanner = new Html5Qrcode(QR_READER_ID, { verbose: false });
    
    return new Promise<void>((resolve, reject) => {
      scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 200, height: 200 } },
        async (decodedText) => {
          await scanner.stop();
          const memberId = decodedText.trim();
          
          try {
            const response = await api.post('/loyalty/earn', {
              customer_id: memberId,
              order_total: totals.total,
              outlet: session.outlet.name,
            });
            
            setStatus('success');
            setMessage(`Points earned! ${response.data.points_earned || 'Transaction recorded.'}`);
            tapFeedback();
            resolve();
          } catch (err: any) {
            setStatus('error');
            setMessage(err.response?.data?.detail || 'Failed to earn points. Please try again.');
            reject(err);
          }
        },
        () => {}
      ).catch((err) => {
        setStatus('error');
        setMessage('Camera error. Please allow camera access and try again.');
        reject(err);
      });
    });
  };

  const handleClose = () => {
    setStatus('idle');
    setMessage('');
    onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section 
        className="loyalty-sheet" 
        role="dialog" 
        aria-modal="true" 
        aria-labelledby="loyalty-title"
        style={{ maxWidth: '400px', margin: 'auto' }}
      >
        <header className="sheet-header">
          <div>
            <p>Acre Club</p>
            <h2 id="loyalty-title">Earn Points</h2>
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

        <div style={{ padding: '24px', textAlign: 'center' }}>
          {status === 'idle' && (
            <>
              <div style={{ marginBottom: '16px' }}>
                <QrCode size={48} style={{ margin: '0 auto', opacity: 0.5 }} />
              </div>
              <p style={{ marginBottom: '8px', fontSize: '16px' }}>
                Scan customer's Acre Club QR code
              </p>
              <p style={{ marginBottom: '24px', fontSize: '14px', opacity: 0.7 }}>
                Order total: ${totals.total.toFixed(2)}
              </p>
              <button
                className="primary-button"
                onClick={handleScan}
                onPointerDown={() => tapFeedback()}
                style={{ width: '100%', padding: '12px' }}
              >
                Scan QR Code
              </button>
            </>
          )}

          {status === 'scanning' && (
            <>
              <div id={QR_READER_ID} style={{ width: '100%', maxWidth: '300px', margin: '0 auto 16px' }} />
              <p style={{ fontSize: '14px', opacity: 0.7 }}>{message}</p>
            </>
          )}

          {status === 'success' && (
            <>
              <div style={{ 
                fontSize: '48px', 
                marginBottom: '16px',
                color: '#10b981'
              }}>
                ✓
              </div>
              <p style={{ fontSize: '16px', marginBottom: '24px', fontWeight: '500' }}>
                {message}
              </p>
              <button
                className="primary-button"
                onClick={handleClose}
                onPointerDown={() => tapFeedback()}
                style={{ width: '100%', padding: '12px' }}
              >
                Done
              </button>
            </>
          )}

          {status === 'error' && (
            <>
              <div style={{ 
                fontSize: '48px', 
                marginBottom: '16px',
                color: '#ef4444'
              }}>
                ✗
              </div>
              <p style={{ fontSize: '14px', marginBottom: '24px', color: '#ef4444' }}>
                {message}
              </p>
              <button
                className="secondary-button"
                onClick={handleClose}
                onPointerDown={() => tapFeedback()}
                style={{ width: '100%', padding: '12px' }}
              >
                Close
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

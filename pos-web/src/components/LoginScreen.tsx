import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Delete, UserRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { getOutlets, loginWithPin } from '@/api/client';
import type { StaffSession } from '@/types';
import { tapFeedback } from '@/utils/haptics';

interface LoginScreenProps {
  onLogin: (session: StaffSession) => void;
}

const pinKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'backspace'];

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [pin, setPin] = useState('');
  const [selectedOutletId, setSelectedOutletId] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  const outletsQuery = useQuery({
    queryKey: ['outlets'],
    queryFn: getOutlets,
  });

  const selectedOutlet = useMemo(
    () => outletsQuery.data?.find((outlet) => outlet.id === selectedOutletId) ?? null,
    [outletsQuery.data, selectedOutletId]
  );

  const canSubmit = Boolean(selectedOutlet) && username.trim().length > 0;

  useEffect(() => {
    if (!selectedOutletId && outletsQuery.data?.length) {
      setSelectedOutletId(outletsQuery.data[0].id);
    }
  }, [outletsQuery.data, selectedOutletId]);

  useEffect(() => {
    if (pin.length === 4 && canSubmit) {
      void submitPin(pin);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, canSubmit]);

  async function submitPin(nextPin = pin) {
    if (!selectedOutlet) {
      toast.error('Select an outlet');
      return;
    }
    if (!username.trim()) {
      toast.error('Enter your username');
      return;
    }
    if (nextPin.length !== 4) {
      toast.error('Enter a 4 digit PIN');
      return;
    }
    try {
      setLoading(true);
      const response = await loginWithPin(selectedOutlet.id, nextPin, username);
      onLogin({
        token: response.access_token,
        staff: response.staff,
        outlet: selectedOutlet,
        expiresAt: Date.now() + response.expires_in * 1000,
      });
    } catch {
      setShake(true);
      window.setTimeout(() => setShake(false), 500);
    } finally {
      setLoading(false);
      setPin('');
    }
  }

  function pressKey(key: string) {
    tapFeedback();
    if (key === 'clear') {
      setPin('');
      return;
    }
    if (key === 'backspace') {
      setPin((current) => current.slice(0, -1));
      return;
    }
    setPin((current) => (current.length >= 4 ? current : `${current}${key}`));
  }

  return (
    <main className="login-shell">
      <section className="login-panel" aria-label="Staff login">
        <div className="login-brand">
          <div className="brand-mark large" aria-hidden="true">G</div>
          <div>
            <h1>Grid POS</h1>
            <p>Staff login</p>
          </div>
        </div>

        <label className="field-label">
          Outlet
          <select
            value={selectedOutletId}
            onChange={(event) => setSelectedOutletId(event.target.value)}
            disabled={outletsQuery.isLoading || loading}
          >
            {(outletsQuery.data ?? []).map((outlet) => (
              <option key={outlet.id} value={outlet.id}>
                {outlet.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field-label">
          Username
          <div className="input-with-icon">
            <UserRound size={18} aria-hidden="true" />
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Your staff name"
              autoComplete="username"
              autoCapitalize="none"
              disabled={loading}
            />
          </div>
        </label>

        <div className="pin-login">
          <div className={`pin-display${shake ? ' shake' : ''}`} aria-label="PIN">
            {Array.from({ length: 4 }).map((_, index) => (
              <span key={index} className={pin[index] ? 'filled' : ''} />
            ))}
          </div>
          <div className="pin-pad">
            {pinKeys.map((key) => (
              <button
                key={key}
                type="button"
                disabled={loading || (!canSubmit && key !== 'clear' && key !== 'backspace')}
                aria-label={key === 'backspace' ? 'Backspace' : key === 'clear' ? 'Clear' : key}
                onClick={() => pressKey(key)}
              >
                {key === 'backspace' ? <Delete size={22} aria-hidden="true" /> : key === 'clear' ? 'Clear' : key}
              </button>
            ))}
          </div>
          {!username.trim() && <p className="login-hint">Enter your username, then your 4-digit PIN</p>}
        </div>
      </section>
    </main>
  );
}

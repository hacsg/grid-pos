import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Delete, LockKeyhole, UserRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { getOutlets, loginWithPassword, loginWithPin } from '@/api/client';
import type { StaffSession } from '@/types';
import { tapFeedback } from '@/utils/haptics';

interface LoginScreenProps {
  onLogin: (session: StaffSession) => void;
}

type LoginMode = 'pin' | 'password';

const pinKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'backspace'];

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [mode, setMode] = useState<LoginMode>('pin');
  const [pin, setPin] = useState('');
  const [selectedOutletId, setSelectedOutletId] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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

  useEffect(() => {
    if (!selectedOutletId && outletsQuery.data?.length) {
      setSelectedOutletId(outletsQuery.data[0].id);
    }
  }, [outletsQuery.data, selectedOutletId]);

  useEffect(() => {
    if (pin.length === 4 && selectedOutlet) {
      void submitPin(pin);
    }
  }, [pin, selectedOutlet]);

  async function submitPin(nextPin = pin) {
    if (!selectedOutlet) {
      toast.error('Select an outlet');
      return;
    }
    if (nextPin.length !== 4) {
      toast.error('Enter a 4 digit PIN');
      return;
    }
    try {
      setLoading(true);
      const response = await loginWithPin(selectedOutlet.id, nextPin);
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

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOutlet) {
      toast.error('Select an outlet');
      return;
    }
    try {
      setLoading(true);
      const response = await loginWithPassword(selectedOutlet.id, username, password);
      onLogin({
        token: response.access_token,
        staff: response.staff,
        outlet: selectedOutlet,
        expiresAt: Date.now() + response.expires_in * 1000,
      });
    } finally {
      setLoading(false);
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

        <div className="segmented-control" role="tablist" aria-label="Login mode">
          <button
            className={mode === 'pin' ? 'active' : ''}
            type="button"
            role="tab"
            aria-selected={mode === 'pin'}
            onClick={() => setMode('pin')}
          >
            <LockKeyhole size={18} aria-hidden="true" />
            PIN
          </button>
          <button
            className={mode === 'password' ? 'active' : ''}
            type="button"
            role="tab"
            aria-selected={mode === 'password'}
            onClick={() => setMode('password')}
          >
            <UserRound size={18} aria-hidden="true" />
            Account
          </button>
        </div>

        {mode === 'pin' ? (
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
                  disabled={loading}
                  aria-label={key === 'backspace' ? 'Backspace' : key === 'clear' ? 'Clear' : key}
                  onClick={() => pressKey(key)}
                >
                  {key === 'backspace' ? <Delete size={22} aria-hidden="true" /> : key === 'clear' ? 'Clear' : key}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <form className="password-login" onSubmit={submitPassword}>
            <label className="field-label">
              Username
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                disabled={loading}
              />
            </label>
            <label className="field-label">
              Password
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
                disabled={loading}
              />
            </label>
            <button className="primary-button full-width" type="submit" disabled={loading || !username || !password}>
              Sign in
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Delete, UserRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { getOutlets, getStaffRoster, loginWithPin, type StaffRosterEntry } from '@/api/client';
import type { StaffSession } from '@/types';
import { tapFeedback } from '@/utils/haptics';

interface LoginScreenProps {
  onLogin: (session: StaffSession) => void;
}

const pinKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'backspace'];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [pin, setPin] = useState('');
  const [selectedOutletId, setSelectedOutletId] = useState('');
  const [selectedStaff, setSelectedStaff] = useState<StaffRosterEntry | null>(null);
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

  const rosterQuery = useQuery({
    queryKey: ['staff-roster', selectedOutletId],
    queryFn: () => getStaffRoster(selectedOutletId),
    enabled: Boolean(selectedOutletId),
  });

  useEffect(() => {
    if (selectedOutletId || !outletsQuery.data?.length) {
      return;
    }
    // Preselect an outlet from ?outlet=<id|name> so a per-outlet start-pos.bat
    // can deep-link straight to the right till (e.g. ?outlet=HAC%20Bedok).
    const params = new URLSearchParams(window.location.search);
    const wanted = (params.get('outlet') ?? '').trim().toLowerCase();
    const match = wanted
      ? outletsQuery.data.find(
          (o) => o.id.toLowerCase() === wanted || o.name.toLowerCase() === wanted,
        )
      : null;
    setSelectedOutletId((match ?? outletsQuery.data[0]).id);
  }, [outletsQuery.data, selectedOutletId]);

  // Reset the staff selection when the outlet changes.
  useEffect(() => {
    setSelectedStaff(null);
    setPin('');
  }, [selectedOutletId]);

  useEffect(() => {
    if (pin.length === 4 && selectedOutlet && selectedStaff) {
      void submitPin(pin);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, selectedOutlet, selectedStaff]);

  async function submitPin(nextPin = pin) {
    if (!selectedOutlet || !selectedStaff) {
      return;
    }
    if (nextPin.length !== 4) {
      toast.error('Enter a 4 digit PIN');
      return;
    }
    try {
      setLoading(true);
      const response = await loginWithPin(selectedOutlet.id, nextPin, selectedStaff.name);
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

  const roster = rosterQuery.data ?? [];

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

        {!selectedStaff ? (
          <div className="staff-picker" aria-label="Select staff">
            <p className="staff-picker-label">Tap your name</p>
            {rosterQuery.isLoading && <div className="login-hint">Loading staff…</div>}
            {!rosterQuery.isLoading && roster.length === 0 && (
              <div className="login-hint">No staff found for this outlet</div>
            )}
            <div className="staff-grid">
              {roster.map((staff) => (
                <button
                  key={staff.id}
                  type="button"
                  className="staff-tile"
                  onClick={() => {
                    tapFeedback();
                    setSelectedStaff(staff);
                    setPin('');
                  }}
                >
                  <span className="staff-avatar" aria-hidden="true">{initials(staff.name) || <UserRound size={20} />}</span>
                  <span className="staff-tile-name">{staff.name}</span>
                  <span className="staff-tile-role">{staff.role}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="pin-login">
            <button
              type="button"
              className="staff-selected"
              onClick={() => {
                tapFeedback();
                setSelectedStaff(null);
                setPin('');
              }}
              disabled={loading}
            >
              <ChevronLeft size={18} aria-hidden="true" />
              <span className="staff-avatar small" aria-hidden="true">{initials(selectedStaff.name)}</span>
              <span className="staff-selected-name">{selectedStaff.name}</span>
              <span className="staff-selected-change">Change</span>
            </button>

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
        )}
      </section>
    </main>
  );
}

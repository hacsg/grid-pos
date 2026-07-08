import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  closeTill,
  formatCurrency,
  getCurrentTill,
  getTillSessions,
  money,
  openTill,
  type TillSession,
} from '@/api/client';
import type { StaffSession } from '@/types';
import { tapFeedback } from '@/utils/haptics';

const MANAGER_ROLES = ['admin', 'manager', 'supervisor'];

function getErrorDetail(err: unknown, fallback: string): string {
  const d =
    (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail ??
    (err as Error)?.message ??
    fallback;
  return typeof d === 'string' ? d : fallback;
}

function sgtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function TillControls({ session }: { session: StaffSession }) {
  const outletId = session.outlet.id;
  const isManager = MANAGER_ROLES.includes(session.staff.role);
  const qc = useQueryClient();

  const tillQuery = useQuery({
    queryKey: ['till', outletId],
    queryFn: () => getCurrentTill(outletId),
  });
  const till = tillQuery.data ?? null;

  const [floatInput, setFloatInput] = useState('');
  const [countInput, setCountInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  async function handleOpen() {
    const amount = money(floatInput);
    if (!floatInput.trim() || amount < 0) {
      toast.error('Enter the opening float');
      return;
    }
    setBusy(true);
    try {
      await openTill(outletId, amount);
      toast.success('Till opened');
      setFloatInput('');
      await qc.invalidateQueries({ queryKey: ['till', outletId] });
    } catch (err) {
      toast.error(getErrorDetail(err, 'Could not open till'));
    } finally {
      setBusy(false);
    }
  }

  async function handleClose() {
    if (!till) return;
    const amount = money(countInput);
    if (!countInput.trim() || amount < 0) {
      toast.error('Enter the counted cash');
      return;
    }
    setBusy(true);
    try {
      await closeTill(till.id, amount);
      // Blind: no variance shown to the person closing.
      toast.success('Till closed — counted cash recorded');
      setCountInput('');
      await qc.invalidateQueries({ queryKey: ['till', outletId] });
    } catch (err) {
      toast.error(getErrorDetail(err, 'Could not close till'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="till-controls">
      <div className="settings-build-title">Cash till</div>

      {tillQuery.isLoading ? (
        <p className="till-muted">Checking till…</p>
      ) : till ? (
        <>
          <p className="till-status">
            <span className="till-badge open">Open</span>
            Float {formatCurrency(till.opening_float)} · since {sgtDate(till.opened_at)}
          </p>
          <label className="till-field">
            <span>Count the drawer and enter the total</span>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="$0.00"
              value={countInput}
              onChange={(e) => setCountInput(e.target.value)}
              disabled={busy}
            />
          </label>
          <button className="primary-button" type="button" disabled={busy} onClick={() => void handleClose()}>
            {busy ? 'Closing…' : 'Close till'}
          </button>
        </>
      ) : (
        <>
          <p className="till-muted">No till open for today.</p>
          <label className="till-field">
            <span>Opening float (cash in drawer now)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="$0.00"
              value={floatInput}
              onChange={(e) => setFloatInput(e.target.value)}
              disabled={busy}
            />
          </label>
          <button className="primary-button" type="button" disabled={busy} onClick={() => void handleOpen()}>
            {busy ? 'Opening…' : 'Open till'}
          </button>
        </>
      )}

      {isManager && (
        <button className="secondary-button" type="button" onClick={() => { tapFeedback(); setHistoryOpen((v) => !v); }}>
          {historyOpen ? 'Hide till history' : 'Till history & variance'}
        </button>
      )}
      {isManager && historyOpen && <TillHistory outletId={outletId} />}
    </div>
  );
}

function TillHistory({ outletId }: { outletId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['till-sessions', outletId],
    queryFn: () => getTillSessions(outletId),
  });
  if (isLoading) return <p className="till-muted">Loading…</p>;
  const sessions = data ?? [];
  if (sessions.length === 0) return <p className="till-muted">No till sessions yet.</p>;
  return (
    <ul className="till-history">
      {sessions.map((s: TillSession) => {
        const variance = s.variance != null ? money(s.variance) : null;
        const varClass = variance == null ? '' : variance === 0 ? 'ok' : variance > 0 ? 'over' : 'short';
        return (
          <li key={s.id}>
            <div className="till-history-date">{s.business_date}</div>
            <div className="till-history-figs">
              <span>Float {formatCurrency(s.opening_float)}</span>
              {s.status === 'closed' ? (
                <>
                  <span>Expected {s.expected_cash != null ? formatCurrency(s.expected_cash) : '—'}</span>
                  <span>Counted {s.counted_cash != null ? formatCurrency(s.counted_cash) : '—'}</span>
                  {variance != null && (
                    <span className={`till-variance ${varClass}`}>
                      {variance > 0 ? '+' : ''}{formatCurrency(variance)}
                    </span>
                  )}
                </>
              ) : (
                <span className="till-badge open">Open</span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

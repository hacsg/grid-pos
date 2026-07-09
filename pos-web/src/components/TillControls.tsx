import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  addTillMovement,
  authorizeDrawerOpen,
  closeTill,
  formatCurrency,
  getCurrentTill,
  getTillMovements,
  getTillSessions,
  money,
  openTill,
  type TillMovement,
  type TillSession,
} from '@/api/client';
import type { StaffSession } from '@/types';
import { tapFeedback } from '@/utils/haptics';
import { openCashDrawer } from '@/utils/printer';

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

type ActionModal = 'in' | 'out' | 'drawer' | null;

export default function TillControls({ session }: { session: StaffSession }) {
  const outletId = session.outlet.id;
  const isManager = MANAGER_ROLES.includes(session.staff.role);
  const qc = useQueryClient();

  const tillQuery = useQuery({ queryKey: ['till', outletId], queryFn: () => getCurrentTill(outletId) });
  const till = tillQuery.data ?? null;

  const [floatInput, setFloatInput] = useState('');
  const [countInput, setCountInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Cash in / out / drawer modal
  const [action, setAction] = useState<ActionModal>(null);
  const [amountInput, setAmountInput] = useState('');
  const [reasonInput, setReasonInput] = useState('');
  const [pinInput, setPinInput] = useState('');

  // Start-of-day: pop the drawer so the cashier can count the opening float.
  // No manager PIN — the till isn't open yet and there's no sales cash at risk;
  // the manager reviews declared opening floats in the till history.
  async function handleCountDrawer() {
    tapFeedback();
    const ok = await openCashDrawer();
    if (!ok) toast.error('Could not open the drawer');
  }

  async function handleOpen() {
    const amount = money(floatInput);
    if (!floatInput.trim() || amount < 0) { toast.error('Enter the opening float'); return; }
    setBusy(true);
    try {
      await openTill(outletId, amount);
      toast.success('Till opened');
      setFloatInput('');
      await qc.invalidateQueries({ queryKey: ['till', outletId] });
    } catch (err) { toast.error(getErrorDetail(err, 'Could not open till')); }
    finally { setBusy(false); }
  }

  async function handleClose() {
    if (!till) return;
    const amount = money(countInput);
    if (!countInput.trim() || amount < 0) { toast.error('Enter the counted cash'); return; }
    setBusy(true);
    try {
      await closeTill(till.id, amount);
      toast.success('Till closed — counted cash recorded');
      setCountInput('');
      await qc.invalidateQueries({ queryKey: ['till', outletId] });
    } catch (err) { toast.error(getErrorDetail(err, 'Could not close till')); }
    finally { setBusy(false); }
  }

  function openAction(a: ActionModal) {
    tapFeedback();
    setAction(a);
    setAmountInput('');
    setReasonInput('');
    setPinInput('');
  }

  async function submitAction() {
    if (!action) return;
    const pin = isManager ? undefined : pinInput.trim();
    if (!isManager && !pin) { toast.error('Enter a manager PIN'); return; }
    setBusy(true);
    try {
      if (action === 'drawer') {
        await authorizeDrawerOpen(outletId, pin, reasonInput.trim() || undefined);
        await openCashDrawer();
        toast.success('Drawer opened');
      } else {
        if (!till) { toast.error('Open the till first'); return; }
        const amount = money(amountInput);
        if (amount <= 0) { toast.error('Enter an amount'); return; }
        await addTillMovement(till.id, action, amount, reasonInput.trim(), pin);
        toast.success(action === 'in' ? 'Cash in recorded' : 'Cash out recorded');
        await qc.invalidateQueries({ queryKey: ['till', outletId] });
        await qc.invalidateQueries({ queryKey: ['till-movements', till.id] });
      }
      setAction(null);
    } catch (err) {
      toast.error(getErrorDetail(err, 'Action failed'));
    } finally { setBusy(false); }
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

          <div className="till-action-row">
            <button className="secondary-button" type="button" onClick={() => openAction('in')}>Cash in</button>
            <button className="secondary-button" type="button" onClick={() => openAction('out')}>Cash out</button>
            <button className="secondary-button" type="button" onClick={() => openAction('drawer')}>Open drawer</button>
          </div>

          <label className="till-field">
            <span>Count the drawer and enter the total</span>
            <input type="number" min="0" step="0.01" inputMode="decimal" placeholder="$0.00"
              value={countInput} onChange={(e) => setCountInput(e.target.value)} disabled={busy} />
          </label>
          <button className="primary-button" type="button" disabled={busy} onClick={() => void handleClose()}>
            {busy ? 'Closing…' : 'Close till'}
          </button>
        </>
      ) : (
        <>
          <p className="till-muted">No till open for today. Open the drawer, count the cash, then enter it as the opening float.</p>
          <button className="secondary-button" type="button" disabled={busy} onClick={() => void handleCountDrawer()}>
            1. Open drawer to count
          </button>
          <label className="till-field">
            <span>2. Opening float (counted cash in drawer)</span>
            <input type="number" min="0" step="0.01" inputMode="decimal" placeholder="$0.00"
              value={floatInput} onChange={(e) => setFloatInput(e.target.value)} disabled={busy} />
          </label>
          <button className="primary-button" type="button" disabled={busy} onClick={() => void handleOpen()}>
            {busy ? 'Opening…' : '3. Open till'}
          </button>
        </>
      )}

      {isManager && (
        <button className="secondary-button" type="button" onClick={() => { tapFeedback(); setHistoryOpen((v) => !v); }}>
          {historyOpen ? 'Hide till history' : 'Till history & variance'}
        </button>
      )}
      {isManager && historyOpen && <TillHistory outletId={outletId} />}

      {action && (
        <div className="modal-backdrop" role="presentation" onClick={() => !busy && setAction(null)}>
          <section className="loyalty-sheet txn-confirm-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <header className="sheet-header">
              <div><p>Cash till</p><h2>{action === 'in' ? 'Cash in' : action === 'out' ? 'Cash out' : 'Open drawer'}</h2></div>
            </header>
            <div className="txn-confirm-body">
              {action !== 'drawer' && (
                <label className="txn-refund-input">
                  <span>Amount</span>
                  <input type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="$0.00"
                    value={amountInput} onChange={(e) => setAmountInput(e.target.value)} disabled={busy} autoFocus />
                </label>
              )}
              <label className="txn-refund-input">
                <span>Reason{action === 'drawer' ? ' (optional)' : ''}</span>
                <input type="text" placeholder={action === 'out' ? 'e.g. supplier, bank drop' : action === 'in' ? 'e.g. change float' : 'e.g. make change'}
                  value={reasonInput} onChange={(e) => setReasonInput(e.target.value)} disabled={busy} />
              </label>
              {!isManager && (
                <label className="txn-refund-input">
                  <span>Manager PIN</span>
                  <input type="password" inputMode="numeric" autoComplete="off" placeholder="••••"
                    value={pinInput} onChange={(e) => setPinInput(e.target.value)} disabled={busy} autoFocus={action === 'drawer'} />
                </label>
              )}
              <div className="txn-confirm-actions">
                <button className="secondary-button" type="button" disabled={busy} onClick={() => setAction(null)}>Cancel</button>
                <button className="primary-button" type="button" disabled={busy} onClick={() => void submitAction()}>
                  {busy ? 'Working…' : action === 'in' ? 'Cash in' : action === 'out' ? 'Cash out' : 'Open drawer'}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function TillHistory({ outletId }: { outletId: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['till-sessions', outletId], queryFn: () => getTillSessions(outletId) });
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
                    <span className={`till-variance ${varClass}`}>{variance > 0 ? '+' : ''}{formatCurrency(variance)}</span>
                  )}
                </>
              ) : <span className="till-badge open">Open</span>}
            </div>
            <TillMovementList sessionId={s.id} />
          </li>
        );
      })}
    </ul>
  );
}

function TillMovementList({ sessionId }: { sessionId: string }) {
  const { data } = useQuery({ queryKey: ['till-movements', sessionId], queryFn: () => getTillMovements(sessionId) });
  const movements = (data ?? []) as TillMovement[];
  if (movements.length === 0) return null;
  return (
    <ul className="till-movements">
      {movements.map((m) => (
        <li key={m.id}>
          <span className={`till-mv ${m.direction}`}>
            {m.direction === 'in' ? '+ Cash in' : m.direction === 'out' ? '− Cash out' : 'No-sale'}
          </span>
          {m.direction !== 'nosale' && <span>{formatCurrency(m.amount)}</span>}
          {m.reason && <span className="till-mv-reason">{m.reason}</span>}
        </li>
      ))}
    </ul>
  );
}

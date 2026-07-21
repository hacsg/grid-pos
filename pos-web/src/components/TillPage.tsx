import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, ChevronRight, RefreshCw, ShieldCheck, WalletCards, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  addTillMovement,
  authorizeDrawerOpen,
  closeTill,
  formatCurrency,
  getCurrentTill,
  getTillCarryOver,
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

type ActionModal = 'in' | 'out' | 'drawer' | null;

function getErrorDetail(err: unknown, fallback: string): string {
  const detail =
    (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail ??
    (err as Error)?.message ??
    fallback;
  return typeof detail === 'string' ? detail : fallback;
}

function sgtDateTime(iso: string | null | undefined): string {
  if (!iso) return 'Not recorded';
  return new Date(iso).toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function sgtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-SG', {
    timeZone: 'Asia/Singapore',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function varianceLabel(value: number): string {
  if (value === 0) return 'Balanced';
  return `${formatCurrency(Math.abs(value))} ${value > 0 ? 'over' : 'short'}`;
}

export default function TillPage({ session }: { session: StaffSession }) {
  const outletId = session.outlet.id;
  const isManager = MANAGER_ROLES.includes(session.staff.role);
  const queryClient = useQueryClient();
  const [floatInput, setFloatInput] = useState('');
  const [countInput, setCountInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<ActionModal>(null);
  const [amountInput, setAmountInput] = useState('');
  const [reasonInput, setReasonInput] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

  const tillQuery = useQuery({
    queryKey: ['till', outletId],
    queryFn: () => getCurrentTill(outletId),
    refetchInterval: 30_000,
  });
  const till = tillQuery.data ?? null;
  const carryOverQuery = useQuery({
    queryKey: ['till-carry-over', outletId],
    queryFn: () => getTillCarryOver(outletId),
  });
  const sessionsQuery = useQuery({
    queryKey: ['till-sessions', outletId],
    queryFn: () => getTillSessions(outletId),
  });
  const movementsQuery = useQuery({
    queryKey: ['till-movements', till?.id],
    queryFn: () => getTillMovements(till!.id),
    enabled: Boolean(till),
    refetchInterval: 20_000,
  });

  const movements = movementsQuery.data ?? [];
  const cashIn = movements
    .filter((movement) => movement.direction === 'in')
    .reduce((total, movement) => total + money(movement.amount), 0);
  const cashOut = movements
    .filter((movement) => movement.direction === 'out')
    .reduce((total, movement) => total + money(movement.amount), 0);
  const expectedCash = till?.expected_cash != null ? money(till.expected_cash) : null;
  const cashSales = till && expectedCash != null
    ? expectedCash - money(till.opening_float) - cashIn + cashOut
    : null;
  const expectedFloat = carryOverQuery.data?.expected_opening_float != null
    ? money(carryOverQuery.data.expected_opening_float)
    : null;

  async function refreshTill() {
    tapFeedback();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['till', outletId] }),
      queryClient.invalidateQueries({ queryKey: ['till-carry-over', outletId] }),
      queryClient.invalidateQueries({ queryKey: ['till-sessions', outletId] }),
      queryClient.invalidateQueries({ queryKey: ['till-movements'] }),
    ]);
  }

  async function handleCountDrawer() {
    tapFeedback();
    if (!(await openCashDrawer())) toast.error('Could not open the drawer');
  }

  async function handleOpen() {
    const amount = money(floatInput);
    if (!floatInput.trim() || amount < 0) {
      toast.error('Enter the counted opening cash');
      return;
    }
    setBusy(true);
    try {
      await openTill(outletId, amount);
      setFloatInput('');
      toast.success('Till opened');
      await refreshTill();
    } catch (err) {
      toast.error(getErrorDetail(err, 'Could not open till'));
    } finally {
      setBusy(false);
    }
  }

  function requestClose() {
    const amount = money(countInput);
    if (!countInput.trim() || amount < 0) {
      toast.error('Enter the total cash counted in the drawer');
      return;
    }
    setConfirmClose(true);
  }

  async function handleClose() {
    if (!till) return;
    const amount = money(countInput);
    setBusy(true);
    try {
      await closeTill(till.id, amount);
      setConfirmClose(false);
      setCountInput('');
      toast.success(`Till closed with ${formatCurrency(amount)} counted`);
      await refreshTill();
    } catch (err) {
      toast.error(getErrorDetail(err, 'Could not close till'));
    } finally {
      setBusy(false);
    }
  }

  function openAction(nextAction: ActionModal) {
    tapFeedback();
    setAction(nextAction);
    setAmountInput('');
    setReasonInput('');
    setPinInput('');
  }

  async function submitAction() {
    if (!action) return;
    const managerPin = isManager ? undefined : pinInput.trim();
    if (!isManager && !managerPin) {
      toast.error('Enter a manager PIN');
      return;
    }
    if (action !== 'drawer' && !reasonInput.trim()) {
      toast.error('Enter a reason so this movement can be audited later');
      return;
    }
    setBusy(true);
    try {
      if (action === 'drawer') {
        await authorizeDrawerOpen(outletId, managerPin, reasonInput.trim() || undefined);
        if (!(await openCashDrawer())) throw new Error('Drawer was authorized but could not be opened');
        toast.success('Drawer opened and logged');
      } else {
        if (!till) throw new Error('Open the till first');
        const amount = money(amountInput);
        if (amount <= 0) throw new Error('Enter an amount greater than zero');
        await addTillMovement(till.id, action, amount, reasonInput.trim(), managerPin);
        toast.success(action === 'in' ? 'Cash in recorded' : 'Cash out recorded');
      }
      setAction(null);
      await refreshTill();
    } catch (err) {
      toast.error(getErrorDetail(err, 'Action failed'));
    } finally {
      setBusy(false);
    }
  }

  const recentSessions = (sessionsQuery.data ?? []).filter((item) => item.id !== till?.id).slice(0, 14);

  return (
    <main className="till-page">
      <header className="till-page-header">
        <div>
          <p className="till-eyebrow">{session.outlet.name}</p>
          <h1>Cash till</h1>
          <p>Follow every drawer adjustment from opening count to closing reconciliation.</p>
        </div>
        <button className="till-refresh" type="button" disabled={tillQuery.isFetching} onClick={() => void refreshTill()}>
          <RefreshCw size={17} className={tillQuery.isFetching ? 'spin' : ''} />
          Refresh
        </button>
      </header>

      {tillQuery.isLoading ? (
        <section className="till-panel till-loading">Loading till record…</section>
      ) : till ? (
        <>
          <section className="till-summary-strip">
            <SummaryItem label="Status" value="Open" detail={`Since ${sgtDateTime(till.opened_at)}`} tone="open" />
            <SummaryItem label="Opening cash" value={formatCurrency(till.opening_float)} detail="Counted at open" />
            <SummaryItem label="Manual cash in" value={`+${formatCurrency(cashIn)}`} detail={`${movements.filter((m) => m.direction === 'in').length} entries`} tone="positive" />
            <SummaryItem label="Manual cash out" value={`-${formatCurrency(cashOut)}`} detail={`${movements.filter((m) => m.direction === 'out').length} entries`} tone="negative" />
            {isManager && <SummaryItem label="Expected now" value={formatCurrency(expectedCash)} detail="Before closing count" tone="manager" />}
          </section>

          <div className="till-workspace">
            <section className="till-panel till-ledger-panel">
              <div className="till-panel-heading">
                <div>
                  <p className="till-eyebrow">Today’s audit trail</p>
                  <h2>Manual drawer activity</h2>
                </div>
                <div className="till-action-row till-page-actions">
                  <button type="button" onClick={() => openAction('in')}><ArrowDownToLine size={18} />Cash in</button>
                  <button type="button" onClick={() => openAction('out')}><ArrowUpFromLine size={18} />Cash out</button>
                  <button type="button" onClick={() => openAction('drawer')}><WalletCards size={18} />Open drawer</button>
                </div>
              </div>
              <MovementLedger movements={movements} loading={movementsQuery.isLoading} />
            </section>

            <aside className="till-panel till-close-panel">
              <p className="till-eyebrow">End of shift</p>
              <h2>Close and count</h2>
              <p className="till-guidance">Count all notes and coins in the drawer, then enter the total once.</p>
              {isManager && expectedCash != null && (
                <div className="till-manager-breakdown">
                  <div><span>Opening cash</span><strong>{formatCurrency(till.opening_float)}</strong></div>
                  <div><span>Cash sales</span><strong>+{formatCurrency(cashSales)}</strong></div>
                  <div><span>Manual cash in</span><strong>+{formatCurrency(cashIn)}</strong></div>
                  <div><span>Manual cash out</span><strong>-{formatCurrency(cashOut)}</strong></div>
                  <div className="total"><span>Expected cash</span><strong>{formatCurrency(expectedCash)}</strong></div>
                </div>
              )}
              {!isManager && (
                <div className="till-blind-note"><ShieldCheck size={18} />Expected cash stays hidden until a manager reviews the blind count.</div>
              )}
              <label className="till-field till-count-field">
                <span>Total cash counted</span>
                <input type="number" min="0" step="0.01" inputMode="decimal" placeholder="S$0.00" value={countInput} onChange={(event) => setCountInput(event.target.value)} disabled={busy} />
              </label>
              <button className="primary-button till-close-button" type="button" disabled={busy} onClick={requestClose}>Review closing count</button>
            </aside>
          </div>
        </>
      ) : (
        <section className="till-panel till-open-panel">
          <div className="till-open-copy">
            <p className="till-eyebrow">Start of day</p>
            <h2>Count and open the till</h2>
            <p>Open the drawer, count every note and coin, then declare the cash physically present.</p>
            {expectedFloat != null && (
              <div className="till-carry-over">
                <span>Expected from last close</span>
                <strong>{formatCurrency(expectedFloat)}</strong>
                <small>Last counted {sgtDateTime(carryOverQuery.data?.previous_closed_at)}</small>
              </div>
            )}
          </div>
          <div className="till-open-steps">
            <button className="secondary-button" type="button" disabled={busy} onClick={() => void handleCountDrawer()}>1. Open drawer to count</button>
            <label className="till-field">
              <span>2. Cash physically counted</span>
              <input type="number" min="0" step="0.01" inputMode="decimal" placeholder="S$0.00" value={floatInput} onChange={(event) => setFloatInput(event.target.value)} disabled={busy} />
            </label>
            {expectedFloat != null && (
              <button className="secondary-button" type="button" disabled={busy} onClick={() => setFloatInput(expectedFloat.toFixed(2))}>Use matching count {formatCurrency(expectedFloat)}</button>
            )}
            <button className="primary-button" type="button" disabled={busy} onClick={() => void handleOpen()}>{busy ? 'Opening…' : '3. Open till'}</button>
          </div>
        </section>
      )}

      <section className="till-history-section">
        <div className="till-section-title">
          <div>
            <p className="till-eyebrow">Handover evidence</p>
            <h2>Recent closing records</h2>
          </div>
          <p>{isManager ? 'Expected and counted cash are shown for manager review.' : 'Your entered counts and manual movements remain visible here.'}</p>
        </div>
        {sessionsQuery.isLoading ? (
          <div className="till-panel till-loading">Loading closing records…</div>
        ) : recentSessions.length === 0 ? (
          <div className="till-panel till-empty">No closed till records yet.</div>
        ) : (
          <div className="till-session-list">
            {recentSessions.map((item) => (
              <SessionRecord
                key={item.id}
                session={item}
                isManager={isManager}
                expanded={expandedSessionId === item.id}
                onToggle={() => setExpandedSessionId(expandedSessionId === item.id ? null : item.id)}
              />
            ))}
          </div>
        )}
      </section>

      {action && (
        <div className="modal-backdrop" role="presentation" onClick={() => !busy && setAction(null)}>
          <section className="loyalty-sheet txn-confirm-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className="sheet-header">
              <div><p>Cash till audit</p><h2>{action === 'in' ? 'Record cash in' : action === 'out' ? 'Record cash out' : 'Open drawer'}</h2></div>
              <button className="icon-button" type="button" aria-label="Close" onClick={() => setAction(null)}><X size={20} /></button>
            </header>
            <div className="txn-confirm-body">
              {action !== 'drawer' && (
                <label className="txn-refund-input"><span>Amount</span><input type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="S$0.00" value={amountInput} onChange={(event) => setAmountInput(event.target.value)} disabled={busy} autoFocus /></label>
              )}
              <label className="txn-refund-input"><span>Reason{action === 'drawer' ? ' (optional)' : ''}</span><input type="text" placeholder={action === 'out' ? 'Supplier payment, bank drop…' : action === 'in' ? 'Additional change float…' : 'Make change…'} value={reasonInput} onChange={(event) => setReasonInput(event.target.value)} disabled={busy} autoFocus={action === 'drawer'} /></label>
              {!isManager && (
                <label className="txn-refund-input"><span>Manager PIN</span><input type="password" inputMode="numeric" autoComplete="off" placeholder="••••" value={pinInput} onChange={(event) => setPinInput(event.target.value)} disabled={busy} /></label>
              )}
              <div className="txn-confirm-actions">
                <button className="secondary-button" type="button" disabled={busy} onClick={() => setAction(null)}>Cancel</button>
                <button className="primary-button" type="button" disabled={busy} onClick={() => void submitAction()}>{busy ? 'Recording…' : 'Confirm and record'}</button>
              </div>
            </div>
          </section>
        </div>
      )}

      {confirmClose && till && (
        <div className="modal-backdrop" role="presentation" onClick={() => !busy && setConfirmClose(false)}>
          <section className="loyalty-sheet txn-confirm-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className="sheet-header"><div><p>Final check</p><h2>Close this till?</h2></div></header>
            <div className="txn-confirm-body till-close-confirm">
              <p>You entered this as the total physical cash in the drawer:</p>
              <strong>{formatCurrency(money(countInput))}</strong>
              <small>This count will be saved as the closing record and used as the expected opening cash next time.</small>
              <div className="txn-confirm-actions">
                <button className="secondary-button" type="button" disabled={busy} onClick={() => setConfirmClose(false)}>Count again</button>
                <button className="primary-button" type="button" disabled={busy} onClick={() => void handleClose()}>{busy ? 'Closing…' : 'Yes, close till'}</button>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function SummaryItem({ label, value, detail, tone = '' }: { label: string; value: string; detail: string; tone?: string }) {
  return <div className={`till-summary-item ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function MovementLedger({ movements, loading }: { movements: TillMovement[]; loading: boolean }) {
  if (loading) return <div className="till-ledger-empty">Loading manual activity…</div>;
  if (movements.length === 0) return <div className="till-ledger-empty"><strong>No manual drawer activity</strong><span>Cash in, cash out, and no-sale drawer opens will appear here.</span></div>;
  return (
    <div className="till-ledger">
      {movements.map((movement) => (
        <div className={`till-ledger-row ${movement.direction}`} key={movement.id}>
          <time>{sgtTime(movement.created_at)}</time>
          <span className="till-ledger-icon">{movement.direction === 'in' ? <ArrowDownToLine size={17} /> : movement.direction === 'out' ? <ArrowUpFromLine size={17} /> : <WalletCards size={17} />}</span>
          <div className="till-ledger-copy">
            <strong>{movement.direction === 'in' ? 'Cash in' : movement.direction === 'out' ? 'Cash out' : 'Drawer opened'}</strong>
            <span>{movement.reason || 'No reason recorded'}</span>
            {(movement.staff_name || movement.authorized_by_name) && <small>Entered by {movement.staff_name || 'staff'}{movement.authorized_by_name ? ` · approved by ${movement.authorized_by_name}` : ''}</small>}
          </div>
          <b>{movement.direction === 'nosale' ? '—' : `${movement.direction === 'in' ? '+' : '-'}${formatCurrency(movement.amount)}`}</b>
        </div>
      ))}
    </div>
  );
}

function SessionRecord({ session, isManager, expanded, onToggle }: { session: TillSession; isManager: boolean; expanded: boolean; onToggle: () => void }) {
  const variance = session.variance != null ? money(session.variance) : null;
  return (
    <article className={`till-session-record ${expanded ? 'expanded' : ''}`}>
      <button type="button" className="till-session-summary" onClick={onToggle}>
        <span className="till-session-chevron">{expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span>
        <span className="till-session-date"><strong>{session.business_date}</strong><small>{sgtDateTime(session.opened_at)} to {sgtDateTime(session.closed_at)}</small></span>
        <span><small>Opened with</small><strong>{formatCurrency(session.opening_float)}</strong></span>
        <span><small>Counted at close</small><strong>{session.counted_cash != null ? formatCurrency(session.counted_cash) : 'Still open'}</strong></span>
        {isManager && <span><small>Expected at close</small><strong>{formatCurrency(session.expected_cash)}</strong></span>}
        {isManager && <span className={variance == null || variance === 0 ? 'balanced' : variance > 0 ? 'over' : 'short'}><small>Variance</small><strong>{variance == null ? 'Pending' : varianceLabel(variance)}</strong></span>}
      </button>
      {expanded && <SessionDetails session={session} isManager={isManager} />}
    </article>
  );
}

function SessionDetails({ session, isManager }: { session: TillSession; isManager: boolean }) {
  const query = useQuery({ queryKey: ['till-movements', session.id], queryFn: () => getTillMovements(session.id) });
  const movements = query.data ?? [];
  const cashIn = movements.filter((m) => m.direction === 'in').reduce((sum, m) => sum + money(m.amount), 0);
  const cashOut = movements.filter((m) => m.direction === 'out').reduce((sum, m) => sum + money(m.amount), 0);
  const expected = session.expected_cash != null ? money(session.expected_cash) : null;
  const cashSales = expected == null ? null : expected - money(session.opening_float) - cashIn + cashOut;
  return (
    <div className="till-session-details">
      {isManager && expected != null && (
        <div className="till-history-equation">
          <span><small>Opening</small><strong>{formatCurrency(session.opening_float)}</strong></span><i>+</i>
          <span><small>Cash sales</small><strong>{formatCurrency(cashSales)}</strong></span><i>+</i>
          <span><small>Cash in</small><strong>{formatCurrency(cashIn)}</strong></span><i>-</i>
          <span><small>Cash out</small><strong>{formatCurrency(cashOut)}</strong></span><i>=</i>
          <span><small>Expected</small><strong>{formatCurrency(expected)}</strong></span>
        </div>
      )}
      <MovementLedger movements={movements} loading={query.isLoading} />
    </div>
  );
}

import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import Card from '@/components/ui/Card';
import { getTillCarryOver, getTillCurrent, getTillMovements, getTillSessions } from '@/api/client';
import { useOutlets } from '@/hooks/useOutlets';
import type { TillSession } from '@/types/till';

const formatCurrency = (value: string | number | null | undefined) => {
  if (value == null) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `S$${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const num = (value: string | number | null | undefined): number | null => {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function sgtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function VarianceBadge({ value }: { value: string | number | null }) {
  const n = num(value);
  if (n === null) return <span className="text-text-muted">—</span>;
  if (n === 0) {
    return (
      <span className="inline-flex items-center rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
        Balanced
      </span>
    );
  }
  const over = n > 0;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums ${
        over ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-error/10 text-error border-error/30'
      }`}
    >
      {over ? '+' : '−'}
      {formatCurrency(Math.abs(n))} {over ? 'over' : 'short'}
    </span>
  );
}

function MovementsRow({ sessionId, colSpan }: { sessionId: string; colSpan: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['till-movements', sessionId],
    queryFn: () => getTillMovements(sessionId),
  });
  const movements = data ?? [];
  return (
    <tr>
      <td colSpan={colSpan} className="border-b border-gray-50 bg-surface/50 px-6 py-3">
        {isLoading ? (
          <p className="text-xs text-text-muted">Loading movements…</p>
        ) : movements.length === 0 ? (
          <p className="text-xs text-text-muted">No cash movements on this session.</p>
        ) : (
          <ul className="space-y-1">
            {movements.map((m) => (
              <li key={m.id} className="flex items-center gap-3 text-xs">
                <span className="w-14 text-text-muted">{sgtTime(m.created_at)}</span>
                <span
                  className={`font-medium ${
                    m.direction === 'in' ? 'text-success' : m.direction === 'out' ? 'text-error' : 'text-text-muted'
                  }`}
                >
                  {m.direction === 'in' ? '+ Cash in' : m.direction === 'out' ? '− Cash out' : 'No-sale open'}
                </span>
                {m.direction !== 'nosale' && <span className="tabular-nums text-text">{formatCurrency(m.amount)}</span>}
                {m.reason && <span className="text-text-muted">· {m.reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

export default function Tills() {
  const outletsQuery = useOutlets();
  const outlets = outletsQuery.data?.data ?? [];
  const [selectedOutlet, setSelectedOutlet] = useState<string | undefined>();
  const outletId = selectedOutlet ?? outlets[0]?.id;
  const [expanded, setExpanded] = useState<string | null>(null);

  const currentQuery = useQuery({
    queryKey: ['till-current', outletId],
    queryFn: () => getTillCurrent(outletId!),
    enabled: !!outletId,
    refetchInterval: 60_000,
  });
  const sessionsQuery = useQuery({
    queryKey: ['till-sessions', outletId],
    queryFn: () => getTillSessions(outletId!),
    enabled: !!outletId,
  });
  const carryOverQuery = useQuery({
    queryKey: ['till-carry-over', outletId],
    queryFn: () => getTillCarryOver(outletId!),
    enabled: !!outletId,
  });

  const current = currentQuery.data ?? null;
  const sessions = sessionsQuery.data ?? [];
  const carryOver = carryOverQuery.data ?? null;
  const isFetching = currentQuery.isFetching || sessionsQuery.isFetching;

  // "In the drawer right now / for the next open": live expected while open,
  // otherwise the carry-over from the last close.
  const drawerNow = current
    ? num(current.expected_cash)
    : num(carryOver?.expected_opening_float);

  const totalCloseVariance = useMemo(
    () => sessions.reduce((sum, s) => sum + (num(s.variance) ?? 0), 0),
    [sessions],
  );

  const COLS = 9;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-text">Tills</h1>
          {isFetching && <Loader2 size={16} className="animate-spin text-text-muted" />}
        </div>
        <p className="mt-1 text-sm text-text-muted">
          Cash drawer sessions — expected cash at close and the float carried over to the next day
        </p>
      </div>

      {outlets.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {outlets.map((o) => (
            <button
              key={o.id}
              onClick={() => setSelectedOutlet(o.id)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                outletId === o.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-gray-200 bg-white text-text-muted hover:border-gray-300'
              }`}
            >
              {o.name}
            </button>
          ))}
        </div>
      )}

      {/* ── Status cards ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Till Status</p>
          <p className="mt-2 text-2xl font-bold text-text">{current ? 'Open' : 'Closed'}</p>
          <p className="mt-1 text-xs text-text-muted">
            {current
              ? `Float ${formatCurrency(current.opening_float)} · opened ${sgtTime(current.opened_at)}`
              : carryOver?.previous_closed_at
                ? `Last closed ${sgtTime(carryOver.previous_closed_at)} on ${carryOver.previous_business_date}`
                : 'No sessions yet'}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
            {current ? 'Expected in Drawer Now' : 'Expected at Next Open'}
          </p>
          <p className="mt-2 text-2xl font-bold text-text">{formatCurrency(drawerNow)}</p>
          <p className="mt-1 text-xs text-text-muted">
            {current
              ? 'Float + cash sales + cash in − cash out'
              : 'Carried over from the last close — no overnight cash-out assumed'}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Net Close Variance</p>
          <p className={`mt-2 text-2xl font-bold ${totalCloseVariance < 0 ? 'text-error' : 'text-text'}`}>
            {totalCloseVariance > 0 ? '+' : ''}
            {formatCurrency(totalCloseVariance)}
          </p>
          <p className="mt-1 text-xs text-text-muted">Across the last {sessions.filter((s) => s.status === 'closed').length} closed sessions</p>
        </div>
      </div>

      {/* ── Sessions table ── */}
      <Card
        title="Till Sessions"
        subtitle="Each close's counted cash becomes the expected opening float of the next session"
      >
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="text-text-muted">
                <th className="w-8 border-b border-gray-100 px-2 py-2" />
                <th className="border-b border-gray-100 px-2 py-2 text-left text-xs font-medium uppercase tracking-wider">Date</th>
                <th className="border-b border-gray-100 px-2 py-2 text-left text-xs font-medium uppercase tracking-wider">Open–Close</th>
                <th className="border-b border-gray-100 px-2 py-2 text-right text-xs font-medium uppercase tracking-wider">Expected Open</th>
                <th className="border-b border-gray-100 px-2 py-2 text-right text-xs font-medium uppercase tracking-wider">Declared Float</th>
                <th className="border-b border-gray-100 px-2 py-2 text-center text-xs font-medium uppercase tracking-wider">Open Variance</th>
                <th className="border-b border-gray-100 px-2 py-2 text-right text-xs font-medium uppercase tracking-wider">Expected Close</th>
                <th className="border-b border-gray-100 px-2 py-2 text-right text-xs font-medium uppercase tracking-wider">Counted</th>
                <th className="border-b border-gray-100 px-2 py-2 text-center text-xs font-medium uppercase tracking-wider">Close Variance</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s: TillSession) => (
                <Fragment key={s.id}>
                  <tr
                    className="cursor-pointer transition-colors hover:bg-surface/70"
                    onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                  >
                    <td className="border-b border-gray-50 px-2 py-2.5 text-text-muted">
                      {expanded === s.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </td>
                    <td className="border-b border-gray-50 px-2 py-2.5 font-medium text-text">
                      {format(parseISO(s.business_date), 'EEE d MMM')}
                      {s.status === 'open' && (
                        <span className="ml-2 inline-flex items-center rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                          Open
                        </span>
                      )}
                    </td>
                    <td className="border-b border-gray-50 px-2 py-2.5 tabular-nums text-text-muted">
                      {sgtTime(s.opened_at)}–{sgtTime(s.closed_at)}
                    </td>
                    <td className="border-b border-gray-50 px-2 py-2.5 text-right tabular-nums text-text">
                      {formatCurrency(s.expected_opening_float)}
                    </td>
                    <td className="border-b border-gray-50 px-2 py-2.5 text-right tabular-nums text-text">
                      {formatCurrency(s.opening_float)}
                    </td>
                    <td className="border-b border-gray-50 px-2 py-2.5 text-center">
                      <VarianceBadge value={s.opening_variance} />
                    </td>
                    <td className="border-b border-gray-50 px-2 py-2.5 text-right tabular-nums text-text">
                      {formatCurrency(s.expected_cash)}
                    </td>
                    <td className="border-b border-gray-50 px-2 py-2.5 text-right font-semibold tabular-nums text-text">
                      {formatCurrency(s.counted_cash)}
                    </td>
                    <td className="border-b border-gray-50 px-2 py-2.5 text-center">
                      <VarianceBadge value={s.variance} />
                    </td>
                  </tr>
                  {expanded === s.id && <MovementsRow sessionId={s.id} colSpan={COLS} />}
                </Fragment>
              ))}
              {sessions.length === 0 && (
                <tr>
                  <td colSpan={COLS} className="py-8 text-center text-sm text-text-muted">
                    No till sessions yet — open the till from the POS to start tracking drawer cash.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

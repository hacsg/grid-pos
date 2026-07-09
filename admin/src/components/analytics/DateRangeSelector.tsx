import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

// Gusta-style date range selector: preset chips + custom from/to inputs,
// persisted in the URL (?from=YYYY-MM-DD&to=YYYY-MM-DD) so ranges are
// shareable and survive reloads.

function toDateParam(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftDays(isoDate: string, delta: number): string {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return toDateParam(d);
}

const PRESETS = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: '7D', value: '7d' },
  { label: '30D', value: '30d' },
  { label: 'This Week', value: 'this_week' },
  { label: 'Last Week', value: 'last_week' },
  { label: 'This Month', value: 'this_month' },
  { label: 'Last Month', value: 'last_month' },
];

type Range = { from: string; to: string };

function getTodayRange(): Range {
  const today = toDateParam(new Date());
  return { from: today, to: today };
}

function getYesterdayRange(): Range {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = toDateParam(d);
  return { from: y, to: y };
}

function getRollingDaysRange(n: number): Range {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - (n - 1));
  return { from: toDateParam(from), to: toDateParam(to) };
}

function getThisWeekRange(): Range {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  return { from: toDateParam(monday), to: toDateParam(now) };
}

function getLastWeekRange(): Range {
  const thisWeek = getThisWeekRange();
  const lastMonday = shiftDays(thisWeek.from, -7);
  return { from: lastMonday, to: shiftDays(lastMonday, 6) };
}

function getThisMonthRange(): Range {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: toDateParam(first), to: toDateParam(now) };
}

function getLastMonthRange(): Range {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return { from: toDateParam(first), to: toDateParam(last) };
}

const RANGE_BY_PRESET: Record<string, () => Range> = {
  today: getTodayRange,
  yesterday: getYesterdayRange,
  '7d': () => getRollingDaysRange(7),
  '30d': () => getRollingDaysRange(30),
  this_week: getThisWeekRange,
  last_week: getLastWeekRange,
  this_month: getThisMonthRange,
  last_month: getLastMonthRange,
};

const COMPARISON_TEXT: Record<string, string> = {
  today: 'Compared to yesterday',
  yesterday: 'Compared to the previous day',
  '7d': 'Compared to the previous 7 days',
  '30d': 'Compared to the previous 30 days',
  this_week: 'Compared to the same period last week',
  last_week: 'Compared to the week before',
  this_month: 'Compared to the same-length previous period',
  last_month: 'Compared to the previous month',
};

export function useDateRangeParams(): { from: string | null; to: string | null } {
  const [params] = useSearchParams();
  return { from: params.get('from'), to: params.get('to') };
}

export default function DateRangeSelector() {
  const [params, setParams] = useSearchParams();
  const fromParam = params.get('from');
  const toParam = params.get('to');

  // Default to this month on first visit.
  useEffect(() => {
    if (!fromParam && !toParam) {
      const next = new URLSearchParams(params);
      const { from, to } = getThisMonthRange();
      next.set('from', from);
      next.set('to', to);
      setParams(next, { replace: true });
    }
  }, [fromParam, toParam, params, setParams]);

  const activePreset = (() => {
    if (!fromParam || !toParam) return '';
    for (const [value, getRange] of Object.entries(RANGE_BY_PRESET)) {
      const r = getRange();
      if (fromParam === r.from && toParam === r.to) return value;
    }
    return 'custom';
  })();

  function setPreset(value: string) {
    const getRange = RANGE_BY_PRESET[value];
    if (!getRange) return;
    const range = getRange();
    const next = new URLSearchParams(params);
    next.set('from', range.from);
    next.set('to', range.to);
    setParams(next);
  }

  function setCustomRange(from: string, to: string) {
    let nextFrom = from;
    let nextTo = to;
    if (nextFrom && !nextTo) nextTo = toDateParam(new Date());
    if (nextTo && !nextFrom) nextFrom = shiftDays(nextTo, -30);
    if (!nextFrom || !nextTo) return;
    if (nextFrom > nextTo) [nextFrom, nextTo] = [nextTo, nextFrom];
    const next = new URLSearchParams(params);
    next.set('from', nextFrom);
    next.set('to', nextTo);
    setParams(next);
  }

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => {
          const active = activePreset === p.value;
          return (
            <button
              key={p.value}
              onClick={() => setPreset(p.value)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                active
                  ? 'border-primary bg-primary text-white shadow-sm'
                  : 'border-gray-200 bg-white text-text-muted hover:border-gray-300 hover:text-text'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-text-muted">or pick custom dates:</span>
        <input
          type="date"
          value={fromParam ?? ''}
          onChange={(e) => setCustomRange(e.target.value, toParam ?? '')}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-text transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <span className="text-xs text-text-muted">to</span>
        <input
          type="date"
          value={toParam ?? ''}
          onChange={(e) => setCustomRange(fromParam ?? '', e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-text transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <span className="ml-auto text-xs text-text-muted">
          {COMPARISON_TEXT[activePreset] ?? 'Compared to the same-length previous period'}
        </span>
      </div>
    </div>
  );
}

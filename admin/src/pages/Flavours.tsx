import { useMemo, useState } from 'react';
import { Loader2, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import Card from '@/components/ui/Card';
import DateRangeSelector, { useDateRangeParams } from '@/components/analytics/DateRangeSelector';
import { useFlavorAnalysis, useFlavorRankings } from '@/hooks/useAnalytics';
import type {
  FlavorClassification,
  FlavorItem,
  FlavorRankingItem,
  RankClassification,
} from '@/types/analytics';

// Validated chart tokens (see Analytics.tsx): teal primary series, blue for
// the second measure on the Pareto chart. Both series share one % axis.
const SERIES = '#00a08f';
const SERIES_2 = '#2a78d6';
const GRID = '#E9ECEF';
const MUTED = '#6C757D';
const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const CLASSIFICATION_BADGE: Record<FlavorClassification, { label: string; cls: string }> = {
  hero: { label: '🟢 Hero', cls: 'bg-success/10 text-success border-success/30' },
  rising: { label: '🚀 Rising', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  stable: { label: '⚪ Stable', cls: 'bg-gray-50 text-text-muted border-gray-200' },
  rotate_out: { label: '🔴 Rotate Out', cls: 'bg-error/10 text-error border-error/30' },
};

const RANK_BADGE: Record<RankClassification, { label: string; cls: string }> = {
  consistent_top: { label: '🏆 Top Tier', cls: 'bg-success/10 text-success border-success/30' },
  rising: { label: '🚀 Rising', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  stable: { label: '➡️ Stable', cls: 'bg-gray-50 text-text-muted border-gray-200' },
  dropping: { label: '📉 Dropping', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  consistent_bottom: { label: '⚠️ At Risk', cls: 'bg-error/10 text-error border-error/30' },
};

const TOOLTIP_STYLE: React.CSSProperties = {
  background: '#1A1A1A',
  border: 'none',
  borderRadius: '8px',
  padding: '8px 12px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
  color: '#FFFFFF',
  fontSize: '12px',
};

function TrendIndicator({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined || pct === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-text-muted">
        <Minus size={14} />
      </span>
    );
  }
  const up = pct > 0;
  return (
    <span className={`inline-flex items-center gap-1 ${up ? 'text-success' : 'text-error'}`}>
      {up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
      <span className="text-xs font-medium">
        {up ? '+' : ''}
        {pct.toFixed(1)}%
      </span>
    </span>
  );
}

function ShareBadge({ pct }: { pct: number }) {
  if (pct <= 0) return null;
  return (
    <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-text-muted">
      {pct.toFixed(1)}%
    </span>
  );
}

function MiniBar({ value, max }: { value: number; max: number }) {
  const width = max > 0 ? Math.max((value / max) * 100, 2) : 2;
  return (
    <div className="h-2 w-16 overflow-hidden rounded-full bg-gray-100">
      <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: SERIES }} />
    </div>
  );
}

// ── Performance matrix ────────────────────────────────────────
function PerformanceMatrix({ title, items, showOutlets }: { title: string; items: FlavorItem[]; showOutlets: boolean }) {
  const maxQty = Math.max(...items.map((f) => f.total_qty), 1);
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-text">{title}</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="text-text-muted">
              <th className="border-b border-gray-100 px-2 py-2 text-left text-xs font-medium uppercase tracking-wider">#</th>
              <th className="border-b border-gray-100 px-2 py-2 text-left text-xs font-medium uppercase tracking-wider">Name</th>
              <th className="border-b border-gray-100 px-2 py-2 text-right text-xs font-medium uppercase tracking-wider">Total</th>
              <th className="border-b border-gray-100 px-2 py-2 text-left text-xs font-medium uppercase tracking-wider">Volume</th>
              <th className="border-b border-gray-100 px-2 py-2 text-center text-xs font-medium uppercase tracking-wider">Share</th>
              {showOutlets && (
                <th className="border-b border-gray-100 px-2 py-2 text-left text-xs font-medium uppercase tracking-wider">Outlets</th>
              )}
              <th className="border-b border-gray-100 px-2 py-2 text-center text-xs font-medium uppercase tracking-wider">Trend (14d)</th>
              <th className="border-b border-gray-100 px-2 py-2 text-center text-xs font-medium uppercase tracking-wider">Consistency</th>
              <th className="border-b border-gray-100 px-2 py-2 text-center text-xs font-medium uppercase tracking-wider">Class</th>
            </tr>
          </thead>
          <tbody>
            {items.map((f) => {
              const badge = CLASSIFICATION_BADGE[f.classification] ?? CLASSIFICATION_BADGE.stable;
              return (
                <tr key={f.name} className="transition-colors hover:bg-surface/70">
                  <td className="border-b border-gray-50 px-2 py-2 tabular-nums text-text-muted">{f.rank}</td>
                  <td className="border-b border-gray-50 px-2 py-2 font-medium text-text">{f.name}</td>
                  <td className="border-b border-gray-50 px-2 py-2 text-right font-semibold tabular-nums text-text">
                    {f.total_qty.toLocaleString()}
                  </td>
                  <td className="border-b border-gray-50 px-2 py-2">
                    <MiniBar value={f.total_qty} max={maxQty} />
                  </td>
                  <td className="border-b border-gray-50 px-2 py-2 text-center">
                    <ShareBadge pct={f.share_pct} />
                  </td>
                  {showOutlets && (
                    <td className="border-b border-gray-50 px-2 py-2">
                      <div className="space-y-0.5">
                        {f.by_outlet.map((o) => (
                          <p key={o.outlet_id} className="text-xs text-text-muted">
                            {o.outlet_name}: <span className="tabular-nums text-text">{o.qty}</span>
                          </p>
                        ))}
                      </div>
                    </td>
                  )}
                  <td className="border-b border-gray-50 px-2 py-2 text-center">
                    <TrendIndicator pct={f.trend_pct} />
                  </td>
                  <td className="border-b border-gray-50 px-2 py-2 text-center">
                    <span className="text-sm tabular-nums text-text">{f.consistency_pct.toFixed(0)}%</span>
                    <p className="text-[10px] text-text-muted">
                      {f.days_sold} of {f.active_days} days
                    </p>
                  </td>
                  <td className="border-b border-gray-50 px-2 py-2 text-center">
                    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={showOutlets ? 9 : 8} className="py-6 text-center text-sm text-text-muted">
                  No data in this period
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Rankings ──────────────────────────────────────────────────
function RankSparkline({ monthlyRank, months }: { monthlyRank: (number | null)[]; months: string[] }) {
  const valid = monthlyRank.filter((r): r is number => r !== null);
  if (valid.length < 2) return <div className="h-9" />;
  const data = monthlyRank.map((rank, i) => ({ month: months[i] ?? '', rank }));
  const maxRank = Math.max(...valid, 2);
  return (
    <div className="hidden h-9 w-28 sm:block">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <YAxis reversed domain={[1, maxRank]} hide />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v: any) => (v != null ? [`#${v}`, 'Rank'] : ['—', 'Rank'])}
          />
          <Line
            type="monotone"
            dataKey="rank"
            stroke={SERIES}
            strokeWidth={2}
            dot={{ r: 2.5, fill: SERIES }}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function RankChange({ item }: { item: FlavorRankingItem }) {
  const nonNull = item.monthly_rank.filter((r) => r !== null);
  if (nonNull.length === 1 && item.monthly_rank[item.monthly_rank.length - 1] !== null) {
    return (
      <span className="inline-flex items-center rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
        New
      </span>
    );
  }
  if (item.rank_change === null || item.rank_change === 0) {
    return <Minus size={12} className="mx-auto text-text-muted" />;
  }
  const improved = item.rank_change > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${improved ? 'text-success' : 'text-error'}`}>
      {improved ? '▲' : '▼'} {improved ? '+' : ''}
      {item.rank_change}
    </span>
  );
}

function SummaryGroup({ title, tone, children }: { title: string; tone: 'green' | 'blue' | 'red'; children: React.ReactNode }) {
  const tones = {
    green: 'border-success/30 bg-success/5 text-success',
    blue: 'border-blue-200 bg-blue-50/60 text-blue-700',
    red: 'border-error/30 bg-error/5 text-error',
  };
  return (
    <div className={`rounded-lg border p-3 ${tones[tone]}`}>
      <h3 className="mb-2 text-xs font-semibold">{title}</h3>
      {children}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────
export default function Flavours() {
  const { from, to } = useDateRangeParams();
  const [granularity, setGranularity] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  const params = useMemo(
    () => (from && to ? { from_date: from, to_date: to, granularity } : undefined),
    [from, to, granularity],
  );
  const { data, isFetching } = useFlavorAnalysis(params);
  const rankingsQuery = useFlavorRankings();
  const rankings = rankingsQuery.data;

  const flavors = data?.flavors ?? [];
  const showOutlets = flavors.some((f) => f.by_outlet.length > 1);

  const topTier = useMemo(
    () => (rankings?.flavors ?? []).filter((f) => f.classification === 'consistent_top'),
    [rankings],
  );
  const rising = useMemo(
    () => (rankings?.flavors ?? []).filter((f) => f.classification === 'rising'),
    [rankings],
  );
  const atRisk = useMemo(
    () =>
      (rankings?.flavors ?? []).filter(
        (f) => f.classification === 'consistent_bottom' || f.classification === 'dropping',
      ),
    [rankings],
  );

  const maxHeatQty = useMemo(
    () => Math.max(...(data?.day_of_week ?? []).flatMap((r) => r.quantities), 1),
    [data?.day_of_week],
  );

  // Auto-generated insight lines, Gusta-style.
  const insights = useMemo(() => {
    if (!flavors.length) return [];
    const lines: string[] = [];
    const top = flavors[0];
    lines.push(`${top.name} is the #1 flavour with ${top.total_qty.toLocaleString()} servings (${top.share_pct.toFixed(1)}% share).`);
    const risingNow = flavors.filter((f) => f.classification === 'rising');
    if (risingNow.length) {
      lines.push(`${risingNow.length} rising star${risingNow.length > 1 ? 's' : ''}: ${risingNow.slice(0, 3).map((f) => f.name).join(', ')}.`);
    }
    const rotateOut = flavors.filter((f) => f.classification === 'rotate_out');
    if (rotateOut.length) {
      lines.push(`${rotateOut.length} flavour${rotateOut.length > 1 ? 's' : ''} flagged for rotation: ${rotateOut.slice(0, 3).map((f) => f.name).join(', ')}.`);
    }
    const heroes = flavors.filter((f) => f.classification === 'hero');
    if (heroes.length) {
      lines.push(`${heroes.length} hero flavour${heroes.length > 1 ? 's' : ''} driving most of the volume.`);
    }
    const pareto80 = (data?.pareto ?? []).findIndex((p) => p.cumulative_pct >= 80) + 1;
    if (pareto80 > 0) {
      lines.push(`The top ${pareto80} flavour${pareto80 > 1 ? 's' : ''} drive 80% of servings.`);
    }
    return lines;
  }, [flavors, data?.pareto]);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-text">Flavour Performance</h1>
          {isFetching && <Loader2 size={16} className="animate-spin text-text-muted" />}
        </div>
        {data && (
          <p className="mt-1 text-sm text-text-muted">
            {flavors.length} flavours tracked · {format(parseISO(data.date_from), 'd MMM yyyy')} –{' '}
            {format(parseISO(data.date_to), 'd MMM yyyy')}
          </p>
        )}
      </div>

      <DateRangeSelector />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {/* ── Monthly Ranking Trends ── */}
          <Card
            title="Monthly Ranking Trends"
            subtitle={`How flavours move in and out of favour · ${rankings?.months.length ?? 0} month${(rankings?.months.length ?? 0) === 1 ? '' : 's'} tracked (all history)`}
          >
            {(topTier.length > 0 || rising.length > 0 || atRisk.length > 0) && (
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <SummaryGroup title="🏆 Top Tier" tone="green">
                  {topTier.length ? (
                    topTier.slice(0, 5).map((f) => (
                      <p key={f.name} className="text-xs">
                        <span className="font-medium">{f.name}</span> · avg #{f.avg_rank.toFixed(1)}
                      </p>
                    ))
                  ) : (
                    <p className="text-xs text-text-muted">None</p>
                  )}
                </SummaryGroup>
                <SummaryGroup title="🚀 On the Rise" tone="blue">
                  {rising.length ? (
                    rising.slice(0, 5).map((f) => (
                      <p key={f.name} className="text-xs">
                        <span className="font-medium">{f.name}</span> · +{f.rank_change ?? 0} ranks
                      </p>
                    ))
                  ) : (
                    <p className="text-xs text-text-muted">None</p>
                  )}
                </SummaryGroup>
                <SummaryGroup title="📉 Consider Phasing Out" tone="red">
                  {atRisk.length ? (
                    atRisk.slice(0, 5).map((f) => (
                      <p key={f.name} className="text-xs">
                        <span className="font-medium">{f.name}</span> ·{' '}
                        {f.classification === 'dropping' ? `▼ ${Math.abs(f.rank_change ?? 0)}` : 'consistently low'}
                      </p>
                    ))
                  ) : (
                    <p className="text-xs text-text-muted">None</p>
                  )}
                </SummaryGroup>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr className="text-text-muted">
                    <th className="w-14 border-b border-gray-100 px-2 py-2 text-center text-xs font-medium uppercase tracking-wider">Rank</th>
                    <th className="border-b border-gray-100 px-2 py-2 text-left text-xs font-medium uppercase tracking-wider">Flavour</th>
                    <th className="hidden border-b border-gray-100 px-2 py-2 text-center text-xs font-medium uppercase tracking-wider sm:table-cell">Trend</th>
                    <th className="w-20 border-b border-gray-100 px-2 py-2 text-center text-xs font-medium uppercase tracking-wider">Change</th>
                    <th className="w-28 border-b border-gray-100 px-2 py-2 text-center text-xs font-medium uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(rankings?.flavors ?? []).map((f) => {
                    const badge = RANK_BADGE[f.classification] ?? RANK_BADGE.stable;
                    const currentRank = f.monthly_rank[f.monthly_rank.length - 1];
                    return (
                      <tr key={f.name} className="transition-colors hover:bg-surface/70">
                        <td className="border-b border-gray-50 px-2 py-2 text-center">
                          <span className="text-lg font-bold tabular-nums text-text">{currentRank ?? '—'}</span>
                        </td>
                        <td className="border-b border-gray-50 px-2 py-2 font-medium text-text">{f.name}</td>
                        <td className="hidden border-b border-gray-50 px-2 py-2 sm:table-cell">
                          <div className="flex justify-center">
                            <RankSparkline monthlyRank={f.monthly_rank} months={rankings?.months ?? []} />
                          </div>
                        </td>
                        <td className="border-b border-gray-50 px-2 py-2 text-center">
                          <RankChange item={f} />
                        </td>
                        <td className="border-b border-gray-50 px-2 py-2 text-center">
                          <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {(rankings?.flavors ?? []).length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-sm text-text-muted">
                        No ranking data yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ── Performance Matrix ── */}
          <Card title="Performance Matrix" subtitle="Quartile + 14-day momentum classification">
            <div className="space-y-6">
              <PerformanceMatrix title="Gelato Flavours" items={flavors} showOutlets={showOutlets} />
              {(data?.addons ?? []).length > 0 && (
                <PerformanceMatrix title="Add-ons & Other Modifiers" items={data!.addons} showOutlets={showOutlets} />
              )}
            </div>
          </Card>

          {/* ── Pareto ── */}
          <Card title="Sales Concentration (Pareto)" subtitle="Individual and cumulative share of servings — both on one % axis">
            {(data?.pareto ?? []).length === 0 ? (
              <p className="py-6 text-center text-sm text-text-muted">No Pareto data in this period</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={data!.pareto} margin={{ top: 8, right: 16, bottom: 48, left: 0 }}>
                    <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10, fill: MUTED }}
                      angle={-35}
                      textAnchor="end"
                      interval={0}
                      height={70}
                      tickLine={false}
                      axisLine={{ stroke: GRID }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: MUTED }}
                      domain={[0, 100]}
                      tickFormatter={(v: number) => `${v}%`}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(value: number, name: string, entry: any) => {
                        if (name === 'Cumulative') return [`${value.toFixed(1)}%`, name];
                        return [`${value.toFixed(1)}% (${entry?.payload?.quantity} sold)`, 'Share'];
                      }}
                    />
                    <Bar dataKey="share_pct" name="Share" fill={SERIES} radius={[3, 3, 0, 0]} maxBarSize={28} />
                    <Line
                      type="monotone"
                      dataKey="cumulative_pct"
                      name="Cumulative"
                      stroke={SERIES_2}
                      strokeWidth={2}
                      dot={{ r: 2.5, fill: SERIES_2 }}
                    />
                    <ReferenceLine y={80} stroke={MUTED} strokeDasharray="4 4" label={{ value: '80%', fill: MUTED, fontSize: 11, position: 'insideBottomRight' }} />
                  </ComposedChart>
                </ResponsiveContainer>
                {(() => {
                  const idx = data!.pareto.findIndex((p) => p.cumulative_pct >= 80);
                  const n = idx >= 0 ? idx + 1 : data!.pareto.length;
                  return (
                    <p className="mt-1 text-center text-xs text-text-muted">
                      Top {n} flavour{n !== 1 ? 's' : ''} drive 80% of servings
                    </p>
                  );
                })()}
              </>
            )}
          </Card>

          {/* ── Day-of-week heatmap ── */}
          <Card title="Day-of-Week Patterns" subtitle="Top 10 flavours · darker cells = higher volume">
            {(data?.day_of_week ?? []).length === 0 ? (
              <p className="py-6 text-center text-sm text-text-muted">No day-of-week data in this period</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-text-muted">
                      <th className="border-b border-gray-100 px-2 py-2 text-left text-xs font-medium uppercase tracking-wider">Flavour</th>
                      {DOW_LABELS.map((day) => (
                        <th key={day} className="w-14 border-b border-gray-100 px-2 py-2 text-center text-xs font-medium uppercase tracking-wider">
                          {day}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data!.day_of_week.map((row) => (
                      <tr key={row.name}>
                        <td className="border-b border-gray-50 px-2 py-2 font-medium text-text">{row.name}</td>
                        {row.quantities.map((qty, i) => {
                          const intensity = maxHeatQty > 0 ? qty / maxHeatQty : 0;
                          return (
                            <td
                              key={i}
                              className="border-b border-gray-50 px-2 py-2 text-center font-semibold tabular-nums"
                              style={{
                                backgroundColor: `rgba(0, 160, 143, ${intensity * 0.55})`,
                                color: intensity > 0.55 ? '#FFFFFF' : '#1A1A1A',
                              }}
                            >
                              {qty > 0 ? qty.toLocaleString() : '—'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* ── Trend sparklines ── */}
          <Card
            title="Flavour Trends"
            subtitle="Top 8 flavours by quantity"
            action={
              <div className="flex overflow-hidden rounded-lg border border-gray-200">
                {(['daily', 'weekly', 'monthly'] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => setGranularity(g)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      granularity === g ? 'bg-primary text-white' : 'bg-white text-text-muted hover:bg-gray-50'
                    }`}
                  >
                    {g.charAt(0).toUpperCase() + g.slice(1)}
                  </button>
                ))}
              </div>
            }
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {flavors.slice(0, 8).map((f) => (
                <div key={f.name} className="flex items-center justify-between rounded-lg border border-gray-100 bg-surface/40 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text">{f.name}</p>
                    <p className="text-xs text-text-muted">
                      {f.total_qty.toLocaleString()} total · <TrendIndicator pct={f.trend_pct} />
                    </p>
                  </div>
                  {f.trend.length >= 2 ? (
                    <div className="h-10 w-28">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={f.trend} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v, 'qty']} labelFormatter={(l) => String(l)} />
                          <Area type="monotone" dataKey="qty" stroke={SERIES} strokeWidth={1.5} fill={SERIES} fillOpacity={0.12} dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-10 w-28" />
                  )}
                </div>
              ))}
              {flavors.length === 0 && <p className="py-4 text-sm text-text-muted">No flavour sales in this period</p>}
            </div>
          </Card>
        </div>

        {/* ── Sidebar ── */}
        <aside className="space-y-6">
          <Card title="Flavour Insights">
            <div className="space-y-2">
              {insights.map((line, idx) => (
                <div key={idx} className="rounded-lg border border-gray-100 bg-surface/60 p-3">
                  <p className="text-sm text-text">{line}</p>
                </div>
              ))}
              {insights.length === 0 && <p className="text-sm text-text-muted">No insights for this period yet.</p>}
            </div>
          </Card>

          <Card title="Classification Summary">
            <div className="grid grid-cols-2 gap-2">
              {(Object.entries(CLASSIFICATION_BADGE) as [FlavorClassification, { label: string; cls: string }][]).map(
                ([key, badge]) => {
                  const count = flavors.filter((f) => f.classification === key).length;
                  return (
                    <div key={key} className={`rounded-lg border p-3 text-center ${badge.cls}`}>
                      <p className="text-2xl font-bold">{count}</p>
                      <p className="text-xs">{badge.label}</p>
                    </div>
                  );
                },
              )}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

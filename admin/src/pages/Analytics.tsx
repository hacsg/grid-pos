import { useMemo, useState } from 'react';
import { Loader2, TrendingUp } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import Card from '@/components/ui/Card';
import DateRangeSelector, { useDateRangeParams } from '@/components/analytics/DateRangeSelector';
import KpiCard from '@/components/analytics/KpiCard';
import { useAnalyticsDashboard } from '@/hooks/useAnalytics';
import { useOutlets } from '@/hooks/useOutlets';
import type { TopProductItem } from '@/types/analytics';

// ── Chart tokens ──────────────────────────────────────────────
// Categorical palette validated for CVD separation / chroma / lightness on the
// white card surface (yellow is under 3:1 contrast, so every use of it also
// carries a visible label — the stats rows below the charts).
const SERIES = '#00a08f'; // primary single-series mark (brand-adjacent teal)
const PAYMENT_COLORS: Record<string, string> = {
  Cash: '#00a08f',
  Card: '#2a78d6',
  PayNow: '#eda100',
  Voucher: '#e34948',
  Other: '#4a3aa7',
};
const GRID = '#E9ECEF';
const MUTED = '#6C757D';

const TOOLTIP_STYLE: React.CSSProperties = {
  background: '#1A1A1A',
  border: 'none',
  borderRadius: '8px',
  padding: '8px 12px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
};

function ChartTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={TOOLTIP_STYLE}>
      <p className="mb-1 text-xs text-gray-400">{label}</p>
      {payload.map((entry: any, idx: number) => (
        <p key={idx} className="text-sm font-medium text-white">
          {entry.name}: {formatter ? formatter(entry.value) : entry.value}
        </p>
      ))}
    </div>
  );
}

// ── Formatters ────────────────────────────────────────────────
const formatCurrency = (value: number) =>
  `S$${value.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatCurrencyAxis = (value: number): string => {
  if (value >= 1_000_000) return `S$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `S$${(value / 1_000).toFixed(1)}k`;
  return `S$${value}`;
};

// ── Small pieces ──────────────────────────────────────────────
function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-gray-200 ${className}`} />;
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-surface/50">
      <div className="text-center">
        <TrendingUp className="mx-auto h-8 w-8 text-text-muted" />
        <p className="mt-2 text-sm text-text-muted">{message}</p>
      </div>
    </div>
  );
}

// Horizontal bar-list with direct labels (name + value on each row).
function ProductBarList({ items, mode }: { items: TopProductItem[]; mode: 'revenue' | 'quantity' }) {
  const max = Math.max(...items.map((p) => (mode === 'revenue' ? p.revenue : p.quantity)), 1);
  return (
    <div className="space-y-2">
      {items.map((p) => {
        const value = mode === 'revenue' ? p.revenue : p.quantity;
        return (
          <div key={p.product_id}>
            <div className="mb-0.5 flex items-center justify-between text-sm">
              <span className="truncate pr-2 text-text">{p.name}</span>
              <span className="shrink-0 font-medium text-text">
                {mode === 'revenue' ? formatCurrency(value) : `${value.toLocaleString()} sold`}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full"
                style={{ width: `${(value / max) * 100}%`, backgroundColor: SERIES }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────
export default function Analytics() {
  const { from, to } = useDateRangeParams();
  const [outletId, setOutletId] = useState<string | undefined>();
  const [productMode, setProductMode] = useState<'revenue' | 'quantity'>('revenue');

  const params = useMemo(
    () =>
      from && to
        ? { from_date: from, to_date: to, outlet_id: outletId }
        : undefined,
    [from, to, outletId],
  );

  const { data, isLoading, isFetching } = useAnalyticsDashboard(params);
  const outletsQuery = useOutlets();
  const outlets = outletsQuery.data?.data ?? [];

  const payments = useMemo(
    () => (data?.payments ?? []).filter((p) => p.amount > 0),
    [data?.payments],
  );
  const paymentsTotal = payments.reduce((s, p) => s + p.amount, 0);

  const trendData = useMemo(
    () =>
      (data?.trend ?? []).map((t) => ({
        ...t,
        shortDate: format(parseISO(t.date), 'MMM d'),
      })),
    [data?.trend],
  );

  // Trim the hourly chart to the active trading window.
  const hourlyData = useMemo(() => {
    const hours = data?.hourly ?? [];
    const active = hours.filter((h) => h.transactions > 0).map((h) => h.hour);
    if (active.length === 0) return [];
    const [lo, hi] = [Math.min(...active), Math.max(...active)];
    return hours
      .filter((h) => h.hour >= lo && h.hour <= hi)
      .map((h) => ({ ...h, label: `${String(h.hour).padStart(2, '0')}:00` }));
  }, [data?.hourly]);

  const hasSales = (data?.kpis.transactions ?? 0) > 0;
  const topProducts = productMode === 'revenue' ? data?.top_by_revenue : data?.top_by_quantity;

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-text">Sales Analytics</h1>
            {isFetching && <Loader2 size={16} className="animate-spin text-text-muted" />}
          </div>
          {data && (
            <p className="mt-1 text-sm text-text-muted">
              Showing data: {format(parseISO(data.date_from), 'd MMM yyyy')} –{' '}
              {format(parseISO(data.date_to), 'd MMM yyyy')}
            </p>
          )}
        </div>
      </div>

      <DateRangeSelector />

      {/* ── Outlet chips ── */}
      {outlets.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setOutletId(undefined)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
              !outletId
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-gray-200 bg-white text-text-muted hover:border-gray-300'
            }`}
          >
            All Outlets
          </button>
          {outlets.map((o) => (
            <button
              key={o.id}
              onClick={() => setOutletId(o.id)}
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

      {/* ── KPI cards ── */}
      {isLoading || !data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card p-5">
              <Skeleton className="mb-2 h-4 w-24" />
              <Skeleton className="h-8 w-32" />
              <Skeleton className="mt-2 h-3 w-20" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard label="Gross Sales" value={formatCurrency(data.kpis.gross_sales)} delta={data.kpis.gross_sales_delta} />
          <KpiCard label="Net Sales" value={formatCurrency(data.kpis.net_sales)} delta={data.kpis.net_sales_delta} />
          <KpiCard label="Transactions" value={data.kpis.transactions.toLocaleString()} delta={data.kpis.transactions_delta} />
          <KpiCard label="Items Sold" value={data.kpis.items_sold.toLocaleString()} delta={data.kpis.items_sold_delta} />
          <KpiCard label="Avg Ticket" value={formatCurrency(data.kpis.avg_ticket)} delta={data.kpis.avg_ticket_delta} />
        </div>
      )}

      {/* ── Trend + Payment mix ── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card title="Net Sales Trend" subtitle="Daily net sales across the selected range">
            {!data || trendData.length === 0 || !hasSales ? (
              <EmptyChart message="No sales in this period" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={trendData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                  <XAxis
                    dataKey="shortDate"
                    tick={{ fontSize: 11, fill: MUTED }}
                    tickLine={false}
                    axisLine={{ stroke: GRID }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: MUTED }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatCurrencyAxis}
                  />
                  <Tooltip content={<ChartTooltip formatter={formatCurrency} />} />
                  <Line
                    type="monotone"
                    dataKey="net_sales"
                    name="Net Sales"
                    stroke={SERIES}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: SERIES }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>

        <Card title="Payment Mix" subtitle="Net sales by payment method">
          {payments.length === 0 ? (
            <EmptyChart message="No payment data" />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={payments}
                    dataKey="amount"
                    nameKey="method"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={3}
                    stroke="#FFFFFF"
                    strokeWidth={2}
                  >
                    {payments.map((p) => (
                      <Cell key={p.method} fill={PAYMENT_COLORS[p.method] ?? PAYMENT_COLORS.Other} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip formatter={formatCurrency} />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-3 space-y-1.5 border-t border-gray-100 pt-3">
                {payments.map((p) => (
                  <div key={p.method} className="flex items-center gap-2 text-sm">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: PAYMENT_COLORS[p.method] ?? PAYMENT_COLORS.Other }}
                    />
                    <span className="text-text">{p.method}</span>
                    <span className="ml-auto font-medium text-text">{formatCurrency(p.amount)}</span>
                    <span className="w-12 text-right text-xs text-text-muted">
                      {paymentsTotal > 0 ? `${((p.amount / paymentsTotal) * 100).toFixed(1)}%` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* ── Top products + Day of week ── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card
          title="Top Products"
          subtitle="Best sellers in the selected range"
          action={
            <div className="flex overflow-hidden rounded-lg border border-gray-200">
              {(['revenue', 'quantity'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setProductMode(mode)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    productMode === mode
                      ? 'bg-primary text-white'
                      : 'bg-white text-text-muted hover:bg-gray-50'
                  }`}
                >
                  {mode === 'revenue' ? 'Revenue' : 'Quantity'}
                </button>
              ))}
            </div>
          }
        >
          {!topProducts || topProducts.length === 0 ? (
            <EmptyChart message="No product sales in this period" />
          ) : (
            <ProductBarList items={topProducts} mode={productMode} />
          )}
        </Card>

        <Card title="Day-of-Week Pattern" subtitle="Average net sales per weekday (days with sales)">
          {!data || !hasSales ? (
            <EmptyChart message="No sales in this period" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.day_of_week} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: MUTED }}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  tickFormatter={(d: string) => d.slice(0, 3)}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: MUTED }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={formatCurrencyAxis}
                />
                <Tooltip content={<ChartTooltip formatter={formatCurrency} />} />
                <Bar
                  dataKey="avg_sales"
                  name="Avg Net Sales"
                  fill={SERIES}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={40}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* ── Hourly pattern + Concentration (+ outlet comparison) ── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card title="Hourly Pattern" subtitle="Revenue by hour of day (SGT), summed over the range">
            {hourlyData.length === 0 ? (
              <EmptyChart message="No sales in this period" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={hourlyData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: MUTED }}
                    tickLine={false}
                    axisLine={{ stroke: GRID }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: MUTED }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatCurrencyAxis}
                  />
                  <Tooltip content={<ChartTooltip formatter={formatCurrency} />} />
                  <Bar
                    dataKey="revenue"
                    name="Revenue"
                    fill={SERIES}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={24}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Menu Concentration" subtitle="Share of units from top sellers">
            {!data || data.concentration.total_products === 0 ? (
              <p className="py-6 text-center text-sm text-text-muted">No product sales yet</p>
            ) : (
              <div className="space-y-4">
                {[
                  { label: 'Top 3 products', pct: data.concentration.top3_pct },
                  { label: 'Top 5 products', pct: data.concentration.top5_pct },
                ].map(({ label, pct }) => (
                  <div key={label}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-sm text-text">{label}</span>
                      <span className="text-sm font-semibold text-text">{pct.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: SERIES }}
                      />
                    </div>
                  </div>
                ))}
                <p className="text-xs text-text-muted">
                  {data.concentration.total_products} products sold in this period
                </p>
              </div>
            )}
          </Card>

          {data && data.sales_by_outlet.length > 1 && (
            <Card title="Sales by Outlet">
              <div className="space-y-2">
                {data.sales_by_outlet.map((o) => {
                  const max = Math.max(...data.sales_by_outlet.map((x) => x.net_sales), 1);
                  return (
                    <div key={o.outlet_id}>
                      <div className="mb-0.5 flex items-center justify-between text-sm">
                        <span className="truncate pr-2 text-text">{o.outlet_name}</span>
                        <span className="shrink-0 font-medium text-text">{formatCurrency(o.net_sales)}</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(o.net_sales / max) * 100}%`, backgroundColor: SERIES }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

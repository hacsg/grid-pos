import { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import Card from '@/components/ui/Card';
import DateRangeSelector, { useDateRangeParams } from '@/components/analytics/DateRangeSelector';
import { useAnalyticsDashboard } from '@/hooks/useAnalytics';

// Validated tokens shared with the Analytics page.
const SERIES = '#00a08f'; // single scoop / primary
const SERIES_2 = '#2a78d6'; // double scoop
const GRID = '#E9ECEF';
const MUTED = '#6C757D';

const TOOLTIP_STYLE: React.CSSProperties = {
  background: '#1A1A1A',
  border: 'none',
  borderRadius: '8px',
  padding: '8px 12px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
  color: '#FFFFFF',
  fontSize: '12px',
};

const formatCurrency = (value: number) =>
  `S$${value.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatCurrencyAxis = (value: number): string => {
  if (value >= 1_000) return `S$${(value / 1_000).toFixed(1)}k`;
  return `S$${value}`;
};

function ProgressBar({ pct, color = SERIES }: { pct: number; color?: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
      <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }} />
    </div>
  );
}

export default function Insights() {
  const { from, to } = useDateRangeParams();
  const params = useMemo(() => (from && to ? { from_date: from, to_date: to } : undefined), [from, to]);
  const { data, isFetching } = useAnalyticsDashboard(params);

  const scoop = data?.scoop_ratio;
  const scoopPieData = useMemo(
    () =>
      scoop && scoop.single_qty + scoop.double_qty > 0
        ? [
            { name: 'Single Scoop', value: scoop.single_qty, color: SERIES },
            { name: 'Double Scoop', value: scoop.double_qty, color: SERIES_2 },
          ]
        : [],
    [scoop],
  );

  const conc = data?.concentration;
  const hasSales = (data?.kpis.transactions ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-text">Business Insights</h1>
          {isFetching && <Loader2 size={16} className="animate-spin text-text-muted" />}
        </div>
        {data && (
          <p className="mt-1 text-sm text-text-muted">
            Showing data: {format(parseISO(data.date_from), 'd MMM yyyy')} –{' '}
            {format(parseISO(data.date_to), 'd MMM yyyy')}
          </p>
        )}
      </div>

      <DateRangeSelector />

      {/* ── Day-of-week patterns ── */}
      <Card title="Day-of-Week Patterns" subtitle="Average net sales per weekday, over days with sales">
        {!data || !hasSales ? (
          <p className="py-8 text-center text-sm text-text-muted">No sales in this period</p>
        ) : (
          <>
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
                <YAxis tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={false} tickFormatter={formatCurrencyAxis} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number) => [formatCurrency(v), 'Avg Net Sales']}
                />
                <Bar dataKey="avg_sales" name="Avg Net Sales" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>

            <div className="mt-4">
              <h3 className="mb-2 text-sm font-medium text-text-muted">Averages per Day</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-text-muted">
                      <th className="border-b border-gray-100 px-3 py-2 text-left text-xs font-medium uppercase tracking-wider">Day</th>
                      <th className="border-b border-gray-100 px-3 py-2 text-right text-xs font-medium uppercase tracking-wider">Avg Net Sales</th>
                      <th className="border-b border-gray-100 px-3 py-2 text-right text-xs font-medium uppercase tracking-wider">Avg Transactions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.day_of_week.map((d) => (
                      <tr key={d.day} className="transition-colors hover:bg-surface/70">
                        <td className="border-b border-gray-50 px-3 py-2 font-medium text-text">{d.day}</td>
                        <td className="border-b border-gray-50 px-3 py-2 text-right tabular-nums text-text">
                          {d.avg_sales > 0 ? formatCurrency(d.avg_sales) : '—'}
                        </td>
                        <td className="border-b border-gray-50 px-3 py-2 text-right tabular-nums text-text">
                          {d.avg_transactions > 0 ? d.avg_transactions.toFixed(1) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ── Menu concentration ── */}
        <Card title="Menu Concentration" subtitle="How much volume the top products drive">
          {!conc || conc.total_products === 0 ? (
            <p className="py-8 text-center text-sm text-text-muted">No product sales in this period</p>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border border-gray-100 bg-surface/60 p-4 text-center">
                  <p className="text-3xl font-bold" style={{ color: SERIES }}>
                    {conc.top3_pct.toFixed(1)}%
                  </p>
                  <p className="mt-1 text-xs text-text-muted">Top 3 products' share</p>
                  <div className="mt-2">
                    <ProgressBar pct={conc.top3_pct} />
                  </div>
                </div>
                <div className="rounded-lg border border-gray-100 bg-surface/60 p-4 text-center">
                  <p className="text-3xl font-bold" style={{ color: SERIES_2 }}>
                    {conc.top5_pct.toFixed(1)}%
                  </p>
                  <p className="mt-1 text-xs text-text-muted">Top 5 products' share</p>
                  <div className="mt-2">
                    <ProgressBar pct={conc.top5_pct} color={SERIES_2} />
                  </div>
                </div>
              </div>
              <p className="text-xs text-text-muted">
                {conc.total_products} products sold in this period. High concentration means a few items carry the
                menu; low concentration means demand is spread out.
              </p>
            </div>
          )}
        </Card>

        {/* ── Scoop ratio ── */}
        <Card title="Scoop Ratio" subtitle="Single vs double scoop distribution">
          {scoopPieData.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-muted">No scoop sales in this period</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={scoopPieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={4}
                    stroke="#FFFFFF"
                    strokeWidth={2}
                  >
                    {scoopPieData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v.toLocaleString(), 'sold']} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-gray-100 bg-surface/60 p-3 text-center">
                  <p className="text-2xl font-bold" style={{ color: SERIES }}>
                    {(scoop?.single_pct ?? 0).toFixed(0)}%
                  </p>
                  <p className="text-xs text-text-muted">Single Scoop</p>
                  <p className="text-sm text-text">{scoop?.single_qty.toLocaleString()} sold</p>
                </div>
                <div className="rounded-lg border border-gray-100 bg-surface/60 p-3 text-center">
                  <p className="text-2xl font-bold" style={{ color: SERIES_2 }}>
                    {(scoop?.double_pct ?? 0).toFixed(0)}%
                  </p>
                  <p className="text-xs text-text-muted">Double Scoop</p>
                  <p className="text-sm text-text">{scoop?.double_qty.toLocaleString()} sold</p>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

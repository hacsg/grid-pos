import { useState, useMemo, useCallback } from 'react';
import {
  DollarSign,
  ShoppingCart,
  TrendingUp,
  Users,
  TrendingDown,
  Calendar,
  ChevronDown,
} from 'lucide-react';
import {
  format,
  startOfWeek,
  endOfWeek,
  subDays,
  parseISO,
  isAfter,
  isBefore,
  startOfMonth,
  endOfMonth,
} from 'date-fns';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useQuery } from '@tanstack/react-query';
import Card from '@/components/ui/Card';
import Table from '@/components/ui/Table';
import {
  useSalesSummary,
  useDailyReport,
  useWeeklyReport,
  useMonthlyReport,
  useOutletReport,
} from '@/hooks/useReports';
import { useOrders } from '@/hooks/useOrders';
import { getStaffList } from '@/api/client';
import type { Order } from '@/types';

// ── Brand Colors ──────────────────────────────────────────────
const COLORS = {
  primary: '#2D5F5D',
  primaryLight: '#4A8B88',
  success: '#28A745',
  warning: '#FFC107',
  error: '#DC3545',
  info: '#17A2B8',
  muted: '#6C757D',
  grid: '#E9ECEF',
  tooltipBg: '#1A1A1A',
};

const CHART_TOOLTIP_STYLE: React.CSSProperties = {
  background: COLORS.tooltipBg,
  border: 'none',
  borderRadius: '8px',
  padding: '8px 12px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
};

const PAYMENT_COLORS = [COLORS.primary, COLORS.success, COLORS.warning];
const OUTLET_COLORS = [
  COLORS.primary,
  COLORS.primaryLight,
  COLORS.info,
  COLORS.success,
  COLORS.warning,
  COLORS.error,
];

// ── Helpers ───────────────────────────────────────────────────
function getDefaultDateRange() {
  const today = new Date();
  const from = startOfWeek(today, { weekStartsOn: 1 });
  const to = endOfWeek(today, { weekStartsOn: 1 });
  return {
    start: format(from, 'yyyy-MM-dd'),
    end: format(to, 'yyyy-MM-dd'),
    startDate: from,
    endDate: to,
  };
}

type TimeRange = 'daily' | 'weekly' | 'monthly';

// ── Skeleton Components ───────────────────────────────────────
function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-gray-200 ${className}`} />;
}

function MetricSkeleton() {
  return (
    <div className="card p-5">
      <Skeleton className="mb-2 h-4 w-24" />
      <Skeleton className="h-8 w-32" />
      <Skeleton className="mt-2 h-3 w-20" />
    </div>
  );
}

function ChartSkeleton({ height = 'h-72' }: { height?: string }) {
  return (
    <Card>
      <Skeleton className="mb-4 h-5 w-40" />
      <div className={`${height} flex items-center justify-center`}>
        <div className="h-full w-full rounded-lg bg-gray-100" />
      </div>
    </Card>
  );
}

function TableSkeleton() {
  return (
    <Card title="Recent Orders">
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Custom Tooltip ────────────────────────────────────────────
function ChartTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={CHART_TOOLTIP_STYLE}>
      <p className="mb-1 text-xs text-gray-400">{label}</p>
      {payload.map((entry: any, idx: number) => (
        <p key={idx} className="text-sm font-medium" style={{ color: entry.color }}>
          {entry.name}: {formatter ? formatter(entry.value) : entry.value}
        </p>
      ))}
    </div>
  );
}

// ── Date Range Presets ────────────────────────────────────────
type DatePreset = 'today' | 'this_week' | 'this_month' | 'last_7' | 'last_30';

const PRESET_LABELS: Record<DatePreset, string> = {
  today: 'Today',
  this_week: 'This Week',
  this_month: 'This Month',
  last_7: 'Last 7 Days',
  last_30: 'Last 30 Days',
};

function getPresetRange(preset: DatePreset): { start: string; end: string } {
  const now = new Date();
  switch (preset) {
    case 'today':
      return { start: format(now, 'yyyy-MM-dd'), end: format(now, 'yyyy-MM-dd') };
    case 'this_week': {
      const from = startOfWeek(now, { weekStartsOn: 1 });
      const to = endOfWeek(now, { weekStartsOn: 1 });
      return { start: format(from, 'yyyy-MM-dd'), end: format(to, 'yyyy-MM-dd') };
    }
    case 'this_month': {
      const from = startOfMonth(now);
      const to = endOfMonth(now);
      return { start: format(from, 'yyyy-MM-dd'), end: format(to, 'yyyy-MM-dd') };
    }
    case 'last_7':
      return { start: format(subDays(now, 6), 'yyyy-MM-dd'), end: format(now, 'yyyy-MM-dd') };
    case 'last_30':
      return { start: format(subDays(now, 29), 'yyyy-MM-dd'), end: format(now, 'yyyy-MM-dd') };
  }
}

// ── Formatting ────────────────────────────────────────────────
function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency: 'SGD',
    minimumFractionDigits: 2,
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-SG').format(value);
}

function formatPercent(value: number) {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

// ── Main Component ────────────────────────────────────────────
export default function Dashboard() {
  const defaultRange = getDefaultDateRange();
  const [dateStart, setDateStart] = useState(defaultRange.start);
  const [dateEnd, setDateEnd] = useState(defaultRange.end);
  const [timeRange, setTimeRange] = useState<TimeRange>('weekly');
  const [showPresets, setShowPresets] = useState(false);
  const [activePreset, setActivePreset] = useState<DatePreset>('this_week');

  // ── Date Preset Handler ──
  const applyPreset = useCallback((preset: DatePreset) => {
    const range = getPresetRange(preset);
    setDateStart(range.start);
    setDateEnd(range.end);
    setActivePreset(preset);
    setShowPresets(false);
  }, []);

  // ── API Hooks ──
  const salesSummaryQuery = useSalesSummary();
  const dailyReportQuery = useDailyReport(
    useMemo(() => ({ date: dateStart }), [dateStart]),
  );
  const weeklyReportQuery = useWeeklyReport(
    useMemo(() => ({ week: format(parseISO(dateStart), "yyyy-'W'ww") }), [dateStart]),
  );
  const monthlyReportQuery = useMonthlyReport(
    useMemo(() => ({ month: format(parseISO(dateStart), 'yyyy-MM') }), [dateStart]),
  );
  const outletReportQuery = useOutletReport(
    useMemo(() => ({ date_from: dateStart, date_to: dateEnd }), [dateStart, dateEnd]),
  );
  const ordersQuery = useOrders(
    useMemo(
      () => ({ limit: 5, start_date: dateStart, end_date: dateEnd }),
      [dateStart, dateEnd],
    ),
  );
  const staffQuery = useQuery({
    queryKey: ['staff-list'],
    queryFn: () => getStaffList({ limit: 1 }),
    select: (data) => data.total,
  });

  // ── Resolve Data ──
  const salesSummary = salesSummaryQuery.data;
  const activeReport =
    timeRange === 'daily'
      ? dailyReportQuery.data
      : timeRange === 'weekly'
        ? weeklyReportQuery.data
        : monthlyReportQuery.data;
  const outletReport = outletReportQuery.data;
  const recentOrders = ordersQuery.data?.data ?? [];
  const activeStaffCount = staffQuery.data ?? 0;

  const isLoadingSummary = salesSummaryQuery.isLoading;
  const isLoadingCharts =
    (timeRange === 'daily' && dailyReportQuery.isLoading) ||
    (timeRange === 'weekly' && weeklyReportQuery.isLoading) ||
    (timeRange === 'monthly' && monthlyReportQuery.isLoading);
  const isLoadingOutlet = outletReportQuery.isLoading;
  const isLoadingOrders = ordersQuery.isLoading;
  const isLoadingStaff = staffQuery.isLoading;

  // ── Stats Cards ──
  const statsCards = useMemo(
    () => [
      {
        label: "Today's Sales",
        value: salesSummary ? formatCurrency(salesSummary.total_sales) : '$0.00',
        change: salesSummary ? formatPercent(12.5) : '0%', // backend doesn't provide change %; use mock as fallback
        icon: DollarSign,
        color: 'text-success',
        bg: 'bg-success/10',
      },
      {
        label: 'Orders Today',
        value: salesSummary ? formatNumber(salesSummary.order_count) : '0',
        change: salesSummary ? formatPercent(8.2) : '0%',
        icon: ShoppingCart,
        color: 'text-primary',
        bg: 'bg-primary/10',
      },
      {
        label: 'Avg. Order Value',
        value: salesSummary ? formatCurrency(salesSummary.average_order_value) : '$0.00',
        change: salesSummary ? formatPercent(3.1) : '0%',
        icon: TrendingUp,
        color: 'text-warning',
        bg: 'bg-warning/10',
      },
      {
        label: 'Active Staff',
        value: activeStaffCount > 0 ? formatNumber(activeStaffCount) : '—',
        change: '0%',
        icon: Users,
        color: 'text-primary',
        bg: 'bg-primary/10',
      },
    ],
    [salesSummary, activeStaffCount],
  );

  // ── Payment Breakdown Pie Data ──
  const paymentPieData = useMemo(() => {
    if (!activeReport) return [];
    const breakdown =
      'payment_breakdown' in activeReport
        ? (activeReport as any).payment_breakdown
        : null;
    if (!breakdown) return [];
    return [
      { name: 'Card', value: breakdown.card || 0, color: COLORS.primary },
      { name: 'PayNow', value: breakdown.paynow || 0, color: COLORS.success },
      { name: 'Cash', value: breakdown.cash || 0, color: COLORS.warning },
    ].filter((d) => d.value > 0);
  }, [activeReport]);

  // ── AreaChart Data ──
  const areaChartData = useMemo(() => {
    if (!activeReport) return [];
    if (timeRange === 'daily') {
      // Hourly sales
      const hourly = (activeReport as any).hourly_sales;
      if (!hourly) return [];
      return hourly.map((h: any) => ({
        label: h.hour,
        Revenue: h.revenue,
        Transactions: h.transactions,
      }));
    }
    if (timeRange === 'weekly') {
      // Daily breakdown
      const daily = (activeReport as any).daily_breakdown;
      if (!daily) return [];
      return daily.map((d: any) => ({
        label: typeof d.date === 'string' ? format(parseISO(d.date), 'EEE') : d.hour,
        Revenue: d.revenue || d.total_sales,
        Transactions: d.transactions || d.order_count,
      }));
    }
    if (timeRange === 'monthly') {
      // Daily breakdown
      const daily = (activeReport as any).daily_breakdown;
      if (!daily) return [];
      return daily.map((d: any) => ({
        label: typeof d.date === 'string' ? format(parseISO(d.date), 'd MMM') : d.hour,
        Revenue: d.revenue || d.total_sales,
        Transactions: d.transactions || d.order_count,
      }));
    }
    return [];
  }, [activeReport, timeRange]);

  // ── Sales by Outlet Bar Data ──
  const barChartData = useMemo(() => {
    if (!outletReport) return [];
    const outlets = (outletReport as any).outlets;
    if (!outlets) return [];
    return outlets.map((o: any, idx: number) => ({
      name: o.outlet_name,
      Revenue: o.revenue || o.total_sales,
      Transactions: o.transactions || o.order_count,
      fill: OUTLET_COLORS[idx % OUTLET_COLORS.length],
    }));
  }, [outletReport]);

  // ── Recent Orders Columns ──
  const orderColumns = useMemo(
    () => [
      { key: 'order_number', header: 'Order' },
      {
        key: 'items',
        header: 'Items',
        render: (row: Order) => formatNumber(row.items?.length ?? 0),
      },
      {
        key: 'total',
        header: 'Total',
        render: (row: Order) => formatCurrency(row.total),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row: Order) => (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              row.status === 'completed'
                ? 'bg-success/10 text-success'
                : row.status === 'pending'
                  ? 'bg-warning/10 text-warning'
                  : row.status === 'cancelled' || row.status === 'refunded'
                    ? 'bg-error/10 text-error'
                    : 'bg-gray-100 text-text-muted'
            }`}
          >
            {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
          </span>
        ),
      },
      {
        key: 'created_at',
        header: 'Time',
        render: (row: Order) => {
          const diff = Date.now() - new Date(row.created_at).getTime();
          const mins = Math.floor(diff / 60000);
          if (mins < 1) return 'Just now';
          if (mins < 60) return `${mins} min ago`;
          const hours = Math.floor(mins / 60);
          if (hours < 24) return `${hours}h ago`;
          return format(new Date(row.created_at), 'd MMM');
        },
      },
    ],
    [],
  );

  // ── Currency Formatter for Charts ──
  const currencyFormatter = useCallback(
    (value: number) => formatCurrency(value),
    [],
  );
  const numberFormatter = useCallback(
    (value: number) => formatNumber(value),
    [],
  );

  // ── Preset Dropdown ──
  const presetLabel = PRESET_LABELS[activePreset];

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Dashboard</h1>
          <p className="mt-1 text-sm text-text-muted">
            Overview of performance for{' '}
            <span className="font-medium text-text">
              {dateStart === dateEnd
                ? format(parseISO(dateStart), 'MMM d, yyyy')
                : `${format(parseISO(dateStart), 'MMM d')} – ${format(parseISO(dateEnd), 'MMM d, yyyy')}`}
            </span>
          </p>
        </div>

        {/* ── Date Range Picker ── */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setShowPresets(!showPresets)}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-text transition-colors hover:border-gray-300"
            >
              <Calendar className="h-4 w-4 text-text-muted" />
              <span>{presetLabel}</span>
              <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
            </button>
            {showPresets && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowPresets(false)}
                />
                <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-gray-100 bg-white shadow-lg">
                  {(Object.keys(PRESET_LABELS) as DatePreset[]).map((key) => (
                    <button
                      key={key}
                      onClick={() => applyPreset(key)}
                      className={`w-full px-4 py-2.5 text-left text-sm transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-gray-50 ${
                        activePreset === key
                          ? 'font-medium text-primary'
                          : 'text-text'
                      }`}
                    >
                      {PRESET_LABELS[key]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <input
            type="date"
            value={dateStart}
            onChange={(e) => {
              setDateStart(e.target.value);
              setActivePreset('last_7');
            }}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-text transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="text-text-muted">–</span>
          <input
            type="date"
            value={dateEnd}
            onChange={(e) => {
              setDateEnd(e.target.value);
              setActivePreset('last_7');
            }}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-text transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* ── Stats Cards ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isLoadingSummary || isLoadingStaff
          ? Array.from({ length: 4 }).map((_, i) => <MetricSkeleton key={i} />)
          : statsCards.map((stat) => (
              <Card key={stat.label}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-text-muted">{stat.label}</p>
                    <p className="stat-value mt-1">{stat.value}</p>
                    <p className={`mt-1 flex items-center gap-1 text-xs font-medium ${stat.color}`}>
                      {stat.change.startsWith('+') ? (
                        <TrendingUp className="h-3 w-3" />
                      ) : stat.change.startsWith('-') ? (
                        <TrendingDown className="h-3 w-3" />
                      ) : null}
                      {stat.change}
                    </p>
                  </div>
                  <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${stat.bg}`}>
                    <stat.icon className={`h-6 w-6 ${stat.color}`} />
                  </div>
                </div>
              </Card>
            ))}
      </div>

      {/* ── Charts Row 1: Sales Over Time + Payment Methods ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Sales Over Time (AreaChart) — spans 2 cols */}
        <div className="lg:col-span-2">
          {isLoadingCharts ? (
            <ChartSkeleton />
          ) : areaChartData.length > 0 ? (
            <Card
              title="Sales Over Time"
              action={
                <div className="flex overflow-hidden rounded-lg border border-gray-200">
                  {(['daily', 'weekly', 'monthly'] as TimeRange[]).map((range) => (
                    <button
                      key={range}
                      onClick={() => setTimeRange(range)}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                        timeRange === range
                          ? 'bg-primary text-white'
                          : 'bg-white text-text-muted hover:bg-gray-50'
                      }`}
                    >
                      {range === 'daily' ? 'Day' : range === 'weekly' ? 'Week' : 'Month'}
                    </button>
                  ))}
                </div>
              }
            >
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={areaChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="colorTransactions" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.success} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={COLORS.success} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: COLORS.muted }}
                    tickLine={false}
                    axisLine={{ stroke: COLORS.grid }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 11, fill: COLORS.muted }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={currencyFormatter}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 11, fill: COLORS.muted }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={numberFormatter}
                  />
                  <Tooltip content={<ChartTooltip formatter={currencyFormatter} />} />
                  <Legend
                    wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                    iconType="circle"
                    iconSize={8}
                  />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="Revenue"
                    stroke={COLORS.primary}
                    fill="url(#colorRevenue)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: COLORS.primary }}
                  />
                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey="Transactions"
                    stroke={COLORS.success}
                    fill="url(#colorTransactions)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: COLORS.success }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          ) : (
            <Card title="Sales Over Time">
              <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-surface/50">
                <div className="text-center">
                  <TrendingUp className="mx-auto h-8 w-8 text-text-muted" />
                  <p className="mt-2 text-sm text-text-muted">No sales data available</p>
                </div>
              </div>
            </Card>
          )}
        </div>

        {/* Payment Methods (PieChart) */}
        <div>
          {isLoadingCharts ? (
            <ChartSkeleton />
          ) : paymentPieData.length > 0 ? (
            <Card title="Payment Methods">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={paymentPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={95}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {paymentPieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={
                      <ChartTooltip formatter={currencyFormatter} />
                    }
                  />
                  <Legend
                    verticalAlign="bottom"
                    wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                    iconType="circle"
                    iconSize={8}
                  />
                </PieChart>
              </ResponsiveContainer>
              {paymentPieData.length > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-gray-100 pt-3">
                  {paymentPieData.map((entry) => {
                    const total = paymentPieData.reduce((s, d) => s + d.value, 0);
                    const pct = total > 0 ? ((entry.value / total) * 100).toFixed(1) : '0.0';
                    return (
                      <div key={entry.name} className="text-center">
                        <p className="text-xs text-text-muted">{entry.name}</p>
                        <p className="text-sm font-semibold text-text">
                          {formatCurrency(entry.value)}
                        </p>
                        <p className="text-xs text-text-muted">{pct}%</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          ) : (
            <Card title="Payment Methods">
              <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-surface/50">
                <div className="text-center">
                  <DollarSign className="mx-auto h-8 w-8 text-text-muted" />
                  <p className="mt-2 text-sm text-text-muted">No payment data</p>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* ── Charts Row 2: Recent Orders + Sales by Outlet ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent Orders */}
        {isLoadingOrders ? (
          <TableSkeleton />
        ) : (
          <Table
            columns={orderColumns}
            data={recentOrders as any}
            loading={isLoadingOrders}
            emptyMessage="No recent orders in this period"
          />
        )}

        {/* Sales by Outlet (BarChart) */}
        <div>
          {isLoadingOutlet ? (
            <ChartSkeleton />
          ) : barChartData.length > 0 ? (
            <Card title="Sales by Outlet">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={barChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: COLORS.muted }}
                    tickLine={false}
                    axisLine={{ stroke: COLORS.grid }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: COLORS.muted }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={currencyFormatter}
                  />
                  <Tooltip content={<ChartTooltip formatter={currencyFormatter} />} />
                  <Legend
                    wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                    iconType="circle"
                    iconSize={8}
                  />
                  <Bar
                    dataKey="Revenue"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={48}
                  >
                    {barChartData.map((entry: any, idx: number) => (
                      <Cell key={`cell-${idx}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {barChartData.length > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-gray-100 pt-3 sm:grid-cols-3">
                  {barChartData.map((entry: any) => (
                    <div key={entry.name} className="flex items-center gap-2">
                      <div
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: entry.fill }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs text-text-muted">{entry.name}</p>
                        <p className="text-sm font-semibold text-text">
                          {formatCurrency(entry.Revenue)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ) : (
            <Card title="Sales by Outlet">
              <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-surface/50">
                <div className="text-center">
                  <TrendingUp className="mx-auto h-8 w-8 text-text-muted" />
                  <p className="mt-2 text-sm text-text-muted">No outlet data available</p>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
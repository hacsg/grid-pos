import { useState, useMemo, useCallback } from 'react';
import {
  Download,
  TrendingUp,
  BarChart3,
  ShoppingBag,
  Users,
  Store,
  ChevronDown,
  Calendar,
  DollarSign,
  Receipt,
  CreditCard,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subMonths,
  parseISO,
  isAfter,
  isBefore,
  subDays,
} from 'date-fns';
import {
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
  LineChart,
  Line,
  Area,
  AreaChart,
} from 'recharts';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import {
  useDailyReport,
  useWeeklyReport,
  useMonthlyReport,
  useProductReport,
  useStaffReport,
  useOutletReport,
} from '@/hooks/useReports';
import { exportReportCSV } from '@/api/client';
import type {
  DailyReport,
  WeeklyReport,
  MonthlyReport,
  ProductReport,
  StaffReport,
  OutletReport,
  StaffHourlyBreakdown,
} from '@/types';
import toast from 'react-hot-toast';

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
  tooltipText: '#FFFFFF',
};

const PIE_COLORS = [COLORS.primary, COLORS.success, COLORS.warning, COLORS.error, COLORS.info];
const CHART_TOOLTIP_STYLE = {
  backgroundColor: COLORS.tooltipBg,
  border: 'none',
  borderRadius: '8px',
  color: COLORS.tooltipText,
  fontSize: '13px',
  padding: '10px 14px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
};

// ── Sample Fallback Data ──────────────────────────────────────
const SAMPLE_DAILY_REPORT: DailyReport = {
  total_revenue: 8030.50,
  total_transactions: 264,
  avg_ticket_size: 30.42,
  revenue_change_percent: 12.5,
  transactions_change_percent: 8.3,
  avg_ticket_change_percent: 3.9,
  payment_breakdown: { card: 4520.00, paynow: 2310.50, cash: 1200.00 },
  hourly_sales: [
    { hour: '09:00', revenue: 320, transactions: 12 },
    { hour: '10:00', revenue: 580, transactions: 18 },
    { hour: '11:00', revenue: 720, transactions: 24 },
    { hour: '12:00', revenue: 980, transactions: 31 },
    { hour: '13:00', revenue: 1120, transactions: 36 },
    { hour: '14:00', revenue: 890, transactions: 28 },
    { hour: '15:00', revenue: 760, transactions: 22 },
    { hour: '16:00', revenue: 840, transactions: 26 },
    { hour: '17:00', revenue: 950, transactions: 30 },
    { hour: '18:00', revenue: 650, transactions: 20 },
    { hour: '19:00', revenue: 430, transactions: 14 },
    { hour: '20:00', revenue: 290, transactions: 10 },
    { hour: '21:00', revenue: 180, transactions: 6 },
    { hour: '22:00', revenue: 70, transactions: 3 },
  ],
};

const SAMPLE_PRODUCT_REPORT: ProductReport = {
  top_by_revenue: [
    { product_id: 'p1', product_name: 'Classic Gelato', units_sold: 89, revenue: 534, avg_modifiers_per_order: 1.2, category_name: 'Gelato' },
    { product_id: 'p2', product_name: 'Chocolate Dream', units_sold: 72, revenue: 432, avg_modifiers_per_order: 1.5, category_name: 'Gelato' },
    { product_id: 'p3', product_name: 'Strawberry Bliss', units_sold: 65, revenue: 390, avg_modifiers_per_order: 0.8, category_name: 'Gelato' },
    { product_id: 'p4', product_name: 'Mango Sorbet', units_sold: 54, revenue: 324, avg_modifiers_per_order: 0.6, category_name: 'Sorbet' },
    { product_id: 'p5', product_name: 'Pistachio', units_sold: 48, revenue: 288, avg_modifiers_per_order: 1.1, category_name: 'Gelato' },
    { product_id: 'p6', product_name: 'Matcha Green Tea', units_sold: 42, revenue: 252, avg_modifiers_per_order: 0.9, category_name: 'Gelato' },
    { product_id: 'p7', product_name: 'Cookies & Cream', units_sold: 38, revenue: 228, avg_modifiers_per_order: 1.3, category_name: 'Gelato' },
    { product_id: 'p8', product_name: 'Lemon Sorbet', units_sold: 35, revenue: 210, avg_modifiers_per_order: 0.4, category_name: 'Sorbet' },
    { product_id: 'p9', product_name: 'Hazelnut Praline', units_sold: 30, revenue: 180, avg_modifiers_per_order: 1.0, category_name: 'Gelato' },
    { product_id: 'p10', product_name: 'Blueberry Yogurt', units_sold: 28, revenue: 168, avg_modifiers_per_order: 0.7, category_name: 'Yogurt' },
  ],
  top_by_quantity: [
    { product_id: 'p1', product_name: 'Classic Gelato', units_sold: 89, revenue: 534, avg_modifiers_per_order: 1.2, category_name: 'Gelato' },
    { product_id: 'p2', product_name: 'Chocolate Dream', units_sold: 72, revenue: 432, avg_modifiers_per_order: 1.5, category_name: 'Gelato' },
    { product_id: 'p3', product_name: 'Strawberry Bliss', units_sold: 65, revenue: 390, avg_modifiers_per_order: 0.8, category_name: 'Gelato' },
    { product_id: 'p4', product_name: 'Mango Sorbet', units_sold: 54, revenue: 324, avg_modifiers_per_order: 0.6, category_name: 'Sorbet' },
    { product_id: 'p5', product_name: 'Pistachio', units_sold: 48, revenue: 288, avg_modifiers_per_order: 1.1, category_name: 'Gelato' },
    { product_id: 'p6', product_name: 'Matcha Green Tea', units_sold: 42, revenue: 252, avg_modifiers_per_order: 0.9, category_name: 'Gelato' },
    { product_id: 'p7', product_name: 'Cookies & Cream', units_sold: 38, revenue: 228, avg_modifiers_per_order: 1.3, category_name: 'Gelato' },
    { product_id: 'p8', product_name: 'Lemon Sorbet', units_sold: 35, revenue: 210, avg_modifiers_per_order: 0.4, category_name: 'Sorbet' },
    { product_id: 'p9', product_name: 'Hazelnut Praline', units_sold: 30, revenue: 180, avg_modifiers_per_order: 1.0, category_name: 'Gelato' },
    { product_id: 'p10', product_name: 'Blueberry Yogurt', units_sold: 28, revenue: 168, avg_modifiers_per_order: 0.7, category_name: 'Yogurt' },
  ],
  category_breakdown: [
    { category_name: 'Gelato', revenue: 1914, quantity_sold: 319, percentage: 59.6 },
    { category_name: 'Sorbet', revenue: 534, quantity_sold: 89, percentage: 16.6 },
    { category_name: 'Yogurt', revenue: 168, quantity_sold: 28, percentage: 5.2 },
  ],
  product_details: [
    { product_id: 'p1', product_name: 'Classic Gelato', units_sold: 89, revenue: 534, avg_modifiers_per_order: 1.2, category_name: 'Gelato' },
    { product_id: 'p2', product_name: 'Chocolate Dream', units_sold: 72, revenue: 432, avg_modifiers_per_order: 1.5, category_name: 'Gelato' },
    { product_id: 'p3', product_name: 'Strawberry Bliss', units_sold: 65, revenue: 390, avg_modifiers_per_order: 0.8, category_name: 'Gelato' },
    { product_id: 'p4', product_name: 'Mango Sorbet', units_sold: 54, revenue: 324, avg_modifiers_per_order: 0.6, category_name: 'Sorbet' },
  ],
};

const SAMPLE_STAFF_REPORT: StaffReport = {
  leaderboard: [
    { staff_id: 's1', staff_name: 'Alice J.', transactions: 42, revenue: 1260, avg_ticket: 30.00 },
    { staff_id: 's2', staff_name: 'Bob S.', transactions: 38, revenue: 1140, avg_ticket: 30.00 },
    { staff_id: 's3', staff_name: 'Carol D.', transactions: 35, revenue: 1050, avg_ticket: 30.00 },
    { staff_id: 's4', staff_name: 'Dave W.', transactions: 28, revenue: 840, avg_ticket: 30.00 },
  ],
  hourly_breakdown: [
    { staff_id: 's1', staff_name: 'Alice J.', hour: '10:00', transactions: 4, revenue: 120 },
    { staff_id: 's1', staff_name: 'Alice J.', hour: '12:00', transactions: 8, revenue: 240 },
    { staff_id: 's1', staff_name: 'Alice J.', hour: '14:00', transactions: 6, revenue: 180 },
    { staff_id: 's1', staff_name: 'Alice J.', hour: '16:00', transactions: 5, revenue: 150 },
    { staff_id: 's2', staff_name: 'Bob S.', hour: '10:00', transactions: 3, revenue: 90 },
    { staff_id: 's2', staff_name: 'Bob S.', hour: '12:00', transactions: 7, revenue: 210 },
    { staff_id: 's2', staff_name: 'Bob S.', hour: '14:00', transactions: 5, revenue: 150 },
    { staff_id: 's2', staff_name: 'Bob S.', hour: '16:00', transactions: 4, revenue: 120 },
    { staff_id: 's3', staff_name: 'Carol D.', hour: '11:00', transactions: 5, revenue: 150 },
    { staff_id: 's3', staff_name: 'Carol D.', hour: '13:00', transactions: 6, revenue: 180 },
    { staff_id: 's3', staff_name: 'Carol D.', hour: '15:00', transactions: 4, revenue: 120 },
    { staff_id: 's4', staff_name: 'Dave W.', hour: '09:00', transactions: 2, revenue: 60 },
    { staff_id: 's4', staff_name: 'Dave W.', hour: '11:00', transactions: 4, revenue: 120 },
    { staff_id: 's4', staff_name: 'Dave W.', hour: '13:00', transactions: 3, revenue: 90 },
    { staff_id: 's4', staff_name: 'Dave W.', hour: '15:00', transactions: 3, revenue: 90 },
  ],
};

const SAMPLE_OUTLET_REPORT: OutletReport = {
  outlets: [
    { outlet_id: 'o1', outlet_name: 'Main Street', revenue: 4820, transactions: 156, avg_ticket: 30.90, top_product: 'Classic Gelato' },
    { outlet_id: 'o2', outlet_name: 'Downtown', revenue: 3210, transactions: 108, avg_ticket: 29.72, top_product: 'Chocolate Dream' },
  ],
};

// ── Outlet Options ────────────────────────────────────────────
const OUTLETS = [
  { id: '', name: 'All Outlets' },
  { id: 'o1', name: 'Main Street' },
  { id: 'o2', name: 'Downtown' },
];

// ── Date Presets ──────────────────────────────────────────────
type DatePreset = 'today' | 'this_week' | 'this_month' | 'last_month' | 'custom';

function getPresetDates(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  switch (preset) {
    case 'today': {
      const d = format(now, 'yyyy-MM-dd');
      return { from: d, to: d };
    }
    case 'this_week': {
      const start = startOfWeek(now, { weekStartsOn: 1 });
      const end = endOfWeek(now, { weekStartsOn: 1 });
      return { from: format(start, 'yyyy-MM-dd'), to: format(end, 'yyyy-MM-dd') };
    }
    case 'this_month': {
      return { from: format(startOfMonth(now), 'yyyy-MM-dd'), to: format(endOfMonth(now), 'yyyy-MM-dd') };
    }
    case 'last_month': {
      const last = subMonths(now, 1);
      return { from: format(startOfMonth(last), 'yyyy-MM-dd'), to: format(endOfMonth(last), 'yyyy-MM-dd') };
    }
    default:
      return { from: format(startOfMonth(now), 'yyyy-MM-dd'), to: format(endOfMonth(now), 'yyyy-MM-dd') };
  }
}

// ── Formatters ────────────────────────────────────────────────
const formatCurrency = (value: number) =>
  `S$${value.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatPercent = (value: number) => {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
};

const formatDate = (dateStr: string) => {
  try {
    return format(parseISO(dateStr), 'd MMM yyyy');
  } catch {
    return dateStr;
  }
};

// ── Skeleton Loader ───────────────────────────────────────────
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

// ── Empty State ───────────────────────────────────────────────
function EmptyState({ icon: Icon, title, description }: { icon: any; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-3 rounded-full bg-gray-100 p-3">
        <Icon className="h-6 w-6 text-text-muted" />
      </div>
      <p className="text-sm font-medium text-text">{title}</p>
      <p className="mt-1 text-xs text-text-muted">{description}</p>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────
export default function Reports() {
  const [preset, setPreset] = useState<DatePreset>('this_month');
  const [dateFrom, setDateFrom] = useState(getPresetDates('this_month').from);
  const [dateTo, setDateTo] = useState(getPresetDates('this_month').to);
  const [outletId, setOutletId] = useState('');
  const [showPresets, setShowPresets] = useState(false);
  const [productSortKey, setProductSortKey] = useState<string>('revenue');
  const [productSortAsc, setProductSortAsc] = useState(false);
  const [staffCompareA, setStaffCompareA] = useState('');
  const [staffCompareB, setStaffCompareB] = useState('');

  // ── Date Preset Handler ──
  const applyPreset = useCallback((p: DatePreset) => {
    setPreset(p);
    const { from, to } = getPresetDates(p);
    setDateFrom(from);
    setDateTo(to);
    setShowPresets(false);
  }, []);

  // ── API Hooks ──
  const dailyParams = useMemo(
    () => (outletId ? { outlet_id: outletId, date: dateFrom } : { date: dateFrom }),
    [outletId, dateFrom],
  );
  const productParams = useMemo(
    () => ({ outlet_id: outletId || undefined, date_from: dateFrom, date_to: dateTo }),
    [outletId, dateFrom, dateTo],
  );
  const staffParams = useMemo(
    () => ({ outlet_id: outletId || undefined, date_from: dateFrom, date_to: dateTo }),
    [outletId, dateFrom, dateTo],
  );
  const outletParams = useMemo(
    () => ({ date_from: dateFrom, date_to: dateTo }),
    [dateFrom, dateTo],
  );

  const dailyQuery = useDailyReport(dailyParams);
  const weeklyQuery = useWeeklyReport(outletId ? { outlet_id: outletId, week: format(parseISO(dateFrom), "yyyy-'W'ww") } : { week: format(parseISO(dateFrom), "yyyy-'W'ww") });
  const monthlyQuery = useMonthlyReport(outletId ? { outlet_id: outletId, month: format(parseISO(dateFrom), 'yyyy-MM') } : { month: format(parseISO(dateFrom), 'yyyy-MM') });
  const productQuery = useProductReport(productParams);
  const staffQuery = useStaffReport(staffParams);
  const outletQuery = useOutletReport(outletParams);

  // ── Data Resolution ──
  const dailyReport = dailyQuery.data || SAMPLE_DAILY_REPORT;
  const productReport = productQuery.data || SAMPLE_PRODUCT_REPORT;
  const staffReport = staffQuery.data || SAMPLE_STAFF_REPORT;
  const outletReport = outletQuery.data || SAMPLE_OUTLET_REPORT;

  const isDailyLoading = dailyQuery.isLoading;
  const isProductLoading = productQuery.isLoading;
  const isStaffLoading = staffQuery.isLoading;
  const isOutletLoading = outletQuery.isLoading;

  const showOutletComparison = !outletId;

  // ── Payment Breakdown Pie Data ──
  const paymentPieData = useMemo(
    () => [
      { name: 'Card', value: dailyReport.payment_breakdown.card, color: COLORS.primary },
      { name: 'PayNow', value: dailyReport.payment_breakdown.paynow, color: COLORS.success },
      { name: 'Cash', value: dailyReport.payment_breakdown.cash, color: COLORS.warning },
    ],
    [dailyReport.payment_breakdown],
  );

  // ── Category Donut Data ──
  const categoryDonutData = useMemo(
    () =>
      productReport.category_breakdown.map((c, i) => ({
        name: c.category_name,
        value: c.revenue,
        color: PIE_COLORS[i % PIE_COLORS.length],
      })),
    [productReport.category_breakdown],
  );

  // ── Staff Hourly Grouped ──
  const staffHourlyData = useMemo(() => {
    const hours = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00'];
    const staffNames = [...new Set(staffReport.hourly_breakdown.map((s) => s.staff_name))];
    return hours.map((hour) => {
      const row: any = { hour };
      staffNames.forEach((name) => {
        const found = staffReport.hourly_breakdown.find((s) => s.staff_name === name && s.hour === hour);
        row[name] = found?.transactions || 0;
      });
      return row;
    });
  }, [staffReport.hourly_breakdown]);

  const staffNames = useMemo(
    () => [...new Set(staffReport.hourly_breakdown.map((s) => s.staff_name))],
    [staffReport.hourly_breakdown],
  );

  // ── Product Table Sort ──
  const sortedProductDetails = useMemo(() => {
    const details = [...productReport.product_details];
    details.sort((a, b) => {
      let cmp = 0;
      switch (productSortKey) {
        case 'name':
          cmp = a.product_name.localeCompare(b.product_name);
          break;
        case 'units_sold':
          cmp = a.units_sold - b.units_sold;
          break;
        case 'revenue':
          cmp = a.revenue - b.revenue;
          break;
        case 'avg_modifiers':
          cmp = a.avg_modifiers_per_order - b.avg_modifiers_per_order;
          break;
        default:
          cmp = a.revenue - b.revenue;
      }
      return productSortAsc ? cmp : -cmp;
    });
    return details;
  }, [productReport.product_details, productSortKey, productSortAsc]);

  // ── Staff Comparison ──
  const staffCompareData = useMemo(() => {
    const a = staffReport.leaderboard.find((s) => s.staff_id === staffCompareA);
    const b = staffReport.leaderboard.find((s) => s.staff_id === staffCompareB);
    return { a, b };
  }, [staffReport.leaderboard, staffCompareA, staffCompareB]);

  // ── Export CSV ──
  const handleExport = useCallback(async () => {
    try {
      const blob = await exportReportCSV({
        outlet_id: outletId || undefined,
        date_from: dateFrom,
        date_to: dateTo,
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report-${dateFrom}-to-${dateTo}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('Report exported successfully');
    } catch {
      toast.error('Failed to export report');
    }
  }, [outletId, dateFrom, dateTo]);

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Reports</h1>
          <p className="mt-1 text-sm text-text-muted">Sales analytics and performance data</p>
        </div>
        <Button variant="secondary" onClick={handleExport}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* ── Filters ── */}
      <div className="card p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-6">
          {/* Date Range */}
          <div className="relative flex-1">
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-text-muted">
              Date Range
            </label>
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => { setDateFrom(e.target.value); setPreset('custom'); }}
                  className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-10 pr-3 text-sm text-text transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <span className="text-sm text-text-muted">to</span>
              <div className="relative flex-1">
                <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => { setDateTo(e.target.value); setPreset('custom'); }}
                  className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-10 pr-3 text-sm text-text transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
          </div>

          {/* Presets */}
          <div className="relative">
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-text-muted">
              Quick Select
            </label>
            <button
              onClick={() => setShowPresets(!showPresets)}
              className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-text transition-colors hover:bg-surface sm:w-auto"
            >
              {preset === 'today' ? 'Today' : preset === 'this_week' ? 'This Week' : preset === 'this_month' ? 'This Month' : preset === 'last_month' ? 'Last Month' : 'Custom'}
              <ChevronDown className="h-4 w-4 text-text-muted" />
            </button>
            {showPresets && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowPresets(false)} />
                <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  {(['today', 'this_week', 'this_month', 'last_month'] as DatePreset[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => applyPreset(p)}
                      className={`w-full px-4 py-2 text-left text-sm transition-colors hover:bg-surface ${
                        preset === p ? 'font-medium text-primary' : 'text-text'
                      }`}
                    >
                      {p === 'today' ? 'Today' : p === 'this_week' ? 'This Week' : p === 'this_month' ? 'This Month' : 'Last Month'}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Outlet Selector */}
          <div className="sm:w-48">
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-text-muted">
              Outlet
            </label>
            <select
              value={outletId}
              onChange={(e) => setOutletId(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-text transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {OUTLETS.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════
         A. DAILY SALES SUMMARY
         ════════════════════════════════════════════════ */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-text">Daily Sales Summary</h2>

        {/* Key Metrics */}
        {isDailyLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <MetricSkeleton />
            <MetricSkeleton />
            <MetricSkeleton />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="card p-5">
              <div className="flex items-center gap-2 text-primary">
                <DollarSign className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-wider">Total Revenue</span>
              </div>
              <p className="mt-2 text-3xl font-bold text-text">
                {formatCurrency(dailyReport.total_revenue)}
              </p>
              <div className="mt-1 flex items-center gap-1">
                {dailyReport.revenue_change_percent >= 0 ? (
                  <ArrowUpRight className="h-3.5 w-3.5 text-success" />
                ) : (
                  <ArrowDownRight className="h-3.5 w-3.5 text-error" />
                )}
                <span
                  className={`text-xs font-medium ${
                    dailyReport.revenue_change_percent >= 0 ? 'text-success' : 'text-error'
                  }`}
                >
                  {formatPercent(dailyReport.revenue_change_percent)} vs last period
                </span>
              </div>
            </div>

            <div className="card p-5">
              <div className="flex items-center gap-2 text-success">
                <Receipt className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-wider">Transactions</span>
              </div>
              <p className="mt-2 text-3xl font-bold text-text">
                {dailyReport.total_transactions.toLocaleString()}
              </p>
              <div className="mt-1 flex items-center gap-1">
                {dailyReport.transactions_change_percent >= 0 ? (
                  <ArrowUpRight className="h-3.5 w-3.5 text-success" />
                ) : (
                  <ArrowDownRight className="h-3.5 w-3.5 text-error" />
                )}
                <span
                  className={`text-xs font-medium ${
                    dailyReport.transactions_change_percent >= 0 ? 'text-success' : 'text-error'
                  }`}
                >
                  {formatPercent(dailyReport.transactions_change_percent)} vs last period
                </span>
              </div>
            </div>

            <div className="card p-5">
              <div className="flex items-center gap-2 text-warning">
                <TrendingUp className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-wider">Avg Ticket</span>
              </div>
              <p className="mt-2 text-3xl font-bold text-text">
                {formatCurrency(dailyReport.avg_ticket_size)}
              </p>
              <div className="mt-1 flex items-center gap-1">
                {dailyReport.avg_ticket_change_percent >= 0 ? (
                  <ArrowUpRight className="h-3.5 w-3.5 text-success" />
                ) : (
                  <ArrowDownRight className="h-3.5 w-3.5 text-error" />
                )}
                <span
                  className={`text-xs font-medium ${
                    dailyReport.avg_ticket_change_percent >= 0 ? 'text-success' : 'text-error'
                  }`}
                >
                  {formatPercent(dailyReport.avg_ticket_change_percent)} vs last period
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Payment Breakdown & Hourly Sales */}
        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Payment Method Pie */}
          <Card title="Payment Method Breakdown" subtitle="Revenue by payment type">
            {isDailyLoading ? (
              <div className="flex h-72 items-center justify-center">
                <Skeleton className="h-64 w-64 rounded-full" />
              </div>
            ) : (
              <div className="flex h-72 items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={paymentPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={70}
                      outerRadius={100}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {paymentPieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip formatter={(v: number) => formatCurrency(v)} />} />
                    <Legend
                      verticalAlign="bottom"
                      iconType="circle"
                      formatter={(value: string) => (
                        <span className="text-sm text-text">{value}</span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* Hourly Sales Bar */}
          <Card title="Hourly Sales" subtitle="Revenue by hour (9am - 10pm)">
            {isDailyLoading ? (
              <ChartSkeleton />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyReport.hourly_sales} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} vertical={false} />
                    <XAxis
                      dataKey="hour"
                      tick={{ fontSize: 11, fill: COLORS.muted }}
                      axisLine={{ stroke: COLORS.grid }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: COLORS.muted }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => `S$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`}
                    />
                    <Tooltip content={<ChartTooltip formatter={(v: number) => formatCurrency(v)} />} />
                    <Bar
                      dataKey="revenue"
                      name="Revenue"
                      fill={COLORS.primary}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={32}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ════════════════════════════════════════════════
         B. PRODUCT PERFORMANCE
         ════════════════════════════════════════════════ */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-text">Product Performance</h2>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Top 10 by Revenue (Horizontal Bar) */}
          <Card title="Top Products by Revenue" subtitle="Highest revenue items">
            {isProductLoading ? (
              <ChartSkeleton height="h-80" />
            ) : productReport.top_by_revenue.length === 0 ? (
              <EmptyState icon={ShoppingBag} title="No product data" description="No sales data available for this period" />
            ) : (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={productReport.top_by_revenue.slice(0, 10)}
                    layout="vertical"
                    barGap={6}
                    margin={{ left: 20, right: 20, top: 10, bottom: 10 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11, fill: COLORS.muted }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => `S$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`}
                    />
                    <YAxis
                      dataKey="product_name"
                      type="category"
                      tick={{ fontSize: 11, fill: '#1A1A1A' }}
                      width={140}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<ChartTooltip formatter={(v: number) => formatCurrency(v)} />} />
                    <Bar dataKey="revenue" name="Revenue" fill={COLORS.primary} radius={[0, 4, 4, 0]} maxBarSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* Top 10 by Quantity (Horizontal Bar) */}
          <Card title="Top Products by Quantity" subtitle="Most sold items">
            {isProductLoading ? (
              <ChartSkeleton height="h-80" />
            ) : productReport.top_by_quantity.length === 0 ? (
              <EmptyState icon={ShoppingBag} title="No product data" description="No sales data available for this period" />
            ) : (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={productReport.top_by_quantity.slice(0, 10)}
                    layout="vertical"
                    barGap={6}
                    margin={{ left: 20, right: 20, top: 10, bottom: 10 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11, fill: COLORS.muted }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      dataKey="product_name"
                      type="category"
                      tick={{ fontSize: 11, fill: '#1A1A1A' }}
                      width={140}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="units_sold" name="Units Sold" fill={COLORS.primaryLight} radius={[0, 4, 4, 0]} maxBarSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* Category Donut */}
          <Card title="Category Breakdown" subtitle="Revenue distribution by category">
            {isProductLoading ? (
              <div className="flex h-72 items-center justify-center">
                <Skeleton className="h-64 w-64 rounded-full" />
              </div>
            ) : categoryDonutData.length === 0 ? (
              <EmptyState icon={BarChart3} title="No category data" description="No category breakdown available" />
            ) : (
              <div className="flex h-72 items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryDonutData}
                      cx="50%"
                      cy="50%"
                      innerRadius={65}
                      outerRadius={95}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {categoryDonutData.map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip formatter={(v: number) => formatCurrency(v)} />} />
                    <Legend
                      verticalAlign="bottom"
                      iconType="circle"
                      formatter={(value: string) => (
                        <span className="text-sm text-text">{value}</span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* Product Detail Table */}
          <Card title="Product Details" subtitle="Detailed breakdown of product sales">
            {isProductLoading ? (
              <div className="space-y-2 p-2">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : sortedProductDetails.length === 0 ? (
              <EmptyState icon={ShoppingBag} title="No product details" description="No detailed data available" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th
                        className="cursor-pointer px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-text-muted"
                        onClick={() => { setProductSortKey('name'); setProductSortAsc(productSortKey === 'name' ? !productSortAsc : false); }}
                      >
                        Product {productSortKey === 'name' && (productSortAsc ? '↑' : '↓')}
                      </th>
                      <th
                        className="cursor-pointer px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-text-muted"
                        onClick={() => { setProductSortKey('units_sold'); setProductSortAsc(productSortKey === 'units_sold' ? !productSortAsc : false); }}
                      >
                        Units Sold {productSortKey === 'units_sold' && (productSortAsc ? '↑' : '↓')}
                      </th>
                      <th
                        className="cursor-pointer px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-text-muted"
                        onClick={() => { setProductSortKey('revenue'); setProductSortAsc(productSortKey === 'revenue' ? !productSortAsc : false); }}
                      >
                        Revenue {productSortKey === 'revenue' && (productSortAsc ? '↑' : '↓')}
                      </th>
                      <th
                        className="cursor-pointer px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-text-muted"
                        onClick={() => { setProductSortKey('avg_modifiers'); setProductSortAsc(productSortKey === 'avg_modifiers' ? !productSortAsc : false); }}
                      >
                        Avg Modifiers {productSortKey === 'avg_modifiers' && (productSortAsc ? '↑' : '↓')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedProductDetails.map((item) => (
                      <tr key={item.product_id} className="border-b border-gray-50 transition-colors hover:bg-surface/50">
                        <td className="px-3 py-2.5 text-sm font-medium text-text">{item.product_name}</td>
                        <td className="px-3 py-2.5 text-right text-sm text-text">{item.units_sold}</td>
                        <td className="px-3 py-2.5 text-right text-sm text-text">{formatCurrency(item.revenue)}</td>
                        <td className="px-3 py-2.5 text-right text-sm text-text">{item.avg_modifiers_per_order.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ════════════════════════════════════════════════
         C. STAFF PERFORMANCE
         ════════════════════════════════════════════════ */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-text">Staff Performance</h2>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Staff Leaderboard */}
          <Card title="Staff Leaderboard" subtitle="Performance ranking by revenue">
            {isStaffLoading ? (
              <div className="space-y-3 p-2">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : staffReport.leaderboard.length === 0 ? (
              <EmptyState icon={Users} title="No staff data" description="No staff performance data available" />
            ) : (
              <div className="space-y-3">
                {staffReport.leaderboard.map((staff, idx) => (
                  <div
                    key={staff.staff_id}
                    className="flex items-center justify-between rounded-lg border border-gray-100 p-3 transition-colors hover:bg-surface"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                          idx === 0
                            ? 'bg-primary text-white'
                            : idx === 1
                            ? 'bg-primary/20 text-primary'
                            : idx === 2
                            ? 'bg-warning/20 text-warning'
                            : 'bg-gray-100 text-text-muted'
                        }`}
                      >
                        {idx + 1}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-text">{staff.staff_name}</p>
                        <p className="text-xs text-text-muted">{staff.transactions} transactions</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-text">{formatCurrency(staff.revenue)}</p>
                      <p className="text-xs text-text-muted">{formatCurrency(staff.avg_ticket)} avg</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Transactions per Hour per Staff (Grouped Bar) */}
          <Card title="Transactions per Hour" subtitle="Staff productivity by hour">
            {isStaffLoading ? (
              <ChartSkeleton />
            ) : staffHourlyData.length === 0 ? (
              <EmptyState icon={Clock} title="No hourly data" description="No hourly breakdown available" />
            ) : (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={staffHourlyData} barGap={4} margin={{ left: 0, right: 0, top: 10, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} vertical={false} />
                    <XAxis
                      dataKey="hour"
                      tick={{ fontSize: 10, fill: COLORS.muted }}
                      axisLine={{ stroke: COLORS.grid }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: COLORS.muted }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend
                      iconType="circle"
                      wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
                    />
                    {staffNames.map((name, i) => (
                      <Bar
                        key={name}
                        dataKey={name}
                        name={name}
                        fill={PIE_COLORS[i % PIE_COLORS.length]}
                        radius={[3, 3, 0, 0]}
                        maxBarSize={16}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* Staff Comparison */}
          <Card title="Staff Comparison" subtitle="Select two staff members to compare" className="lg:col-span-2">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-text-muted">Staff A</label>
                <select
                  value={staffCompareA}
                  onChange={(e) => setStaffCompareA(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-text transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">Select staff</option>
                  {staffReport.leaderboard.map((s) => (
                    <option key={s.staff_id} value={s.staff_id}>
                      {s.staff_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-text-muted">Staff B</label>
                <select
                  value={staffCompareB}
                  onChange={(e) => setStaffCompareB(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-text transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">Select staff</option>
                  {staffReport.leaderboard.map((s) => (
                    <option key={s.staff_id} value={s.staff_id}>
                      {s.staff_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {staffCompareData.a && staffCompareData.b ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Staff A */}
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <p className="mb-3 text-sm font-semibold text-primary">{staffCompareData.a.staff_name}</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text-muted">Transactions</span>
                      <span className="text-sm font-medium text-text">{staffCompareData.a.transactions}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text-muted">Revenue</span>
                      <span className="text-sm font-medium text-text">{formatCurrency(staffCompareData.a.revenue)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text-muted">Avg Ticket</span>
                      <span className="text-sm font-medium text-text">{formatCurrency(staffCompareData.a.avg_ticket)}</span>
                    </div>
                  </div>
                </div>
                {/* Staff B */}
                <div className="rounded-lg border border-success/20 bg-success/5 p-4">
                  <p className="mb-3 text-sm font-semibold text-success">{staffCompareData.b.staff_name}</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text-muted">Transactions</span>
                      <span className="text-sm font-medium text-text">{staffCompareData.b.transactions}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text-muted">Revenue</span>
                      <span className="text-sm font-medium text-text">{formatCurrency(staffCompareData.b.revenue)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text-muted">Avg Ticket</span>
                      <span className="text-sm font-medium text-text">{formatCurrency(staffCompareData.b.avg_ticket)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-6 text-center text-sm text-text-muted">
                Select two staff members above to compare their performance side by side.
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ════════════════════════════════════════════════
         D. OUTLET COMPARISON
         ════════════════════════════════════════════════ */}
      {showOutletComparison && (
        <div>
          <h2 className="mb-4 text-lg font-semibold text-text">Outlet Comparison</h2>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Revenue by Outlet */}
            <Card title="Revenue by Outlet" subtitle="Total revenue per location">
              {isOutletLoading ? (
                <ChartSkeleton />
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={outletReport.outlets} barGap={8}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} vertical={false} />
                      <XAxis
                        dataKey="outlet_name"
                        tick={{ fontSize: 11, fill: COLORS.muted }}
                        axisLine={{ stroke: COLORS.grid }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: COLORS.muted }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v: number) => `S$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`}
                      />
                      <Tooltip content={<ChartTooltip formatter={(v: number) => formatCurrency(v)} />} />
                      <Bar dataKey="revenue" name="Revenue" fill={COLORS.primary} radius={[4, 4, 0, 0]} maxBarSize={48} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            {/* Transactions by Outlet */}
            <Card title="Transactions by Outlet" subtitle="Order count per location">
              {isOutletLoading ? (
                <ChartSkeleton />
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={outletReport.outlets} barGap={8}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} vertical={false} />
                      <XAxis
                        dataKey="outlet_name"
                        tick={{ fontSize: 11, fill: COLORS.muted }}
                        axisLine={{ stroke: COLORS.grid }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: COLORS.muted }}
                        axisLine={false}
                        tickLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="transactions" name="Transactions" fill={COLORS.success} radius={[4, 4, 0, 0]} maxBarSize={48} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            {/* Avg Ticket by Outlet */}
            <Card title="Average Ticket by Outlet" subtitle="Avg spend per location">
              {isOutletLoading ? (
                <ChartSkeleton />
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={outletReport.outlets} barGap={8}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} vertical={false} />
                      <XAxis
                        dataKey="outlet_name"
                        tick={{ fontSize: 11, fill: COLORS.muted }}
                        axisLine={{ stroke: COLORS.grid }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: COLORS.muted }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v: number) => `S$${v}`}
                      />
                      <Tooltip content={<ChartTooltip formatter={(v: number) => formatCurrency(v)} />} />
                      <Bar dataKey="avg_ticket" name="Avg Ticket" fill={COLORS.warning} radius={[4, 4, 0, 0]} maxBarSize={48} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>

          {/* Outlet Detail Table */}
          <div className="mt-4">
            <Card title="Outlet Details" subtitle="Key metrics by location">
              {isOutletLoading ? (
                <div className="space-y-2 p-2">
                  {[1, 2].map((i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : outletReport.outlets.length === 0 ? (
                <EmptyState icon={Store} title="No outlet data" description="No outlet comparison data available" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">Outlet</th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-text-muted">Revenue</th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-text-muted">Transactions</th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-text-muted">Avg Ticket</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">Top Product</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outletReport.outlets.map((outlet) => (
                        <tr key={outlet.outlet_id} className="border-b border-gray-50 transition-colors hover:bg-surface/50">
                          <td className="px-4 py-3 text-sm font-medium text-text">{outlet.outlet_name}</td>
                          <td className="px-4 py-3 text-right text-sm text-text">{formatCurrency(outlet.revenue)}</td>
                          <td className="px-4 py-3 text-right text-sm text-text">{outlet.transactions}</td>
                          <td className="px-4 py-3 text-right text-sm text-text">{formatCurrency(outlet.avg_ticket)}</td>
                          <td className="px-4 py-3 text-sm text-text-muted">{outlet.top_product}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
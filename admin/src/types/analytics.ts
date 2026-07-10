// Types for the sales analytics dashboard (GET /analytics/dashboard).

export interface AnalyticsKpis {
  gross_sales: number;
  net_sales: number;
  transactions: number;
  items_sold: number;
  avg_ticket: number;
  gross_sales_delta: number | null;
  net_sales_delta: number | null;
  transactions_delta: number | null;
  items_sold_delta: number | null;
  avg_ticket_delta: number | null;
}

export interface PaymentBreakdownItem {
  method: string;
  amount: number;
}

export interface OutletSalesItem {
  outlet_id: string;
  outlet_name: string;
  net_sales: number;
  transactions: number;
}

export interface TrendPoint {
  date: string;
  net_sales: number;
  transactions: number;
}

export interface TopProductItem {
  product_id: string;
  name: string;
  quantity: number;
  revenue: number;
}

export interface DayOfWeekPoint {
  day: string;
  avg_sales: number;
  avg_transactions: number;
}

export interface HourlyPoint {
  hour: number;
  revenue: number;
  transactions: number;
  avg_sales: number;
}

export interface ConcentrationData {
  top3_pct: number;
  top5_pct: number;
  total_products: number;
}

export interface ScoopRatioData {
  single_qty: number;
  double_qty: number;
  single_pct: number;
  double_pct: number;
}

export interface AnalyticsDashboard {
  date_from: string;
  date_to: string;
  kpis: AnalyticsKpis;
  payments: PaymentBreakdownItem[];
  sales_by_outlet: OutletSalesItem[];
  trend: TrendPoint[];
  top_by_revenue: TopProductItem[];
  top_by_quantity: TopProductItem[];
  day_of_week: DayOfWeekPoint[];
  hourly: HourlyPoint[];
  concentration: ConcentrationData;
  scoop_ratio: ScoopRatioData;
}

export interface AnalyticsDashboardParams {
  outlet_id?: string;
  days?: number;
  from_date?: string;
  to_date?: string;
}

// Staff leaderboard, mapped from GET /reports/staff.
export interface StaffLeaderboardEntry {
  staff_id: string;
  name: string;
  transactions: number;
  revenue: number;
  average_ticket: number;
}

// ── Flavour analytics (GET /analytics/flavors, /analytics/flavor-rankings) ──

export type FlavorClassification = 'hero' | 'rising' | 'stable' | 'rotate_out';
export type RankClassification =
  | 'consistent_top'
  | 'rising'
  | 'stable'
  | 'dropping'
  | 'consistent_bottom';

export interface FlavorTrendPoint {
  bucket: string;
  qty: number;
}

export interface FlavorOutletQty {
  outlet_id: string;
  outlet_name: string;
  qty: number;
  share_pct: number;
}

export interface FlavorItem {
  name: string;
  total_qty: number;
  share_pct: number;
  rank: number;
  trend_pct: number;
  classification: FlavorClassification;
  days_sold: number;
  active_days: number;
  consistency_pct: number;
  trend: FlavorTrendPoint[];
  by_outlet: FlavorOutletQty[];
}

export interface ParetoPoint {
  name: string;
  quantity: number;
  share_pct: number;
  cumulative_pct: number;
}

export interface FlavorDowRow {
  name: string;
  quantities: number[]; // Monday..Sunday
}

export interface FlavorAnalysis {
  date_from: string;
  date_to: string;
  active_days: number;
  flavors: FlavorItem[];
  addons: FlavorItem[];
  pareto: ParetoPoint[];
  day_of_week: FlavorDowRow[];
}

export interface FlavorAnalysisParams extends AnalyticsDashboardParams {
  granularity?: 'daily' | 'weekly' | 'monthly';
}

export interface FlavorRankingItem {
  name: string;
  monthly_rank: (number | null)[];
  monthly_qty: number[];
  rank_change: number | null;
  avg_rank: number;
  classification: RankClassification;
}

export interface FlavorRankings {
  months: string[];
  flavors: FlavorRankingItem[];
}

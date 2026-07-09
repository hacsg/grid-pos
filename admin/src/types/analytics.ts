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
}

export interface AnalyticsDashboardParams {
  outlet_id?: string;
  days?: number;
  from_date?: string;
  to_date?: string;
}

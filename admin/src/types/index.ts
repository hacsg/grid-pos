export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  category_id: string;
  category_name: string;
  image_url: string | null;
  available: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  modifier_groups: ProductModifierAssignment[];
}

// --- Modifier Management Types ---
export interface ModifierOption {
  id: string;
  name: string;
  price_adjustment: number;
  display_order: number;
  is_available: boolean;
  created_at: string;
}

export interface ModifierGroup {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  options: ModifierOption[];
}

export interface ModifierGroupCreate {
  name: string;
  description?: string | null;
}

export interface ModifierGroupUpdate {
  name?: string;
  description?: string | null;
}

export interface ModifierOptionCreate {
  name: string;
  price_adjustment?: number;
  display_order?: number;
  is_available?: boolean;
}

export interface ModifierOptionUpdate {
  name?: string;
  price_adjustment?: number;
  display_order?: number;
  is_available?: boolean;
}

// --- Product Assignment Types ---
export interface ProductModifierAssignment {
  id: string;
  group_id: string;
  group_name: string;
  group_description?: string | null;
  min_select: number;
  max_select: number;
  is_required: boolean;
  display_order: number;
  options: ModifierOption[];
}

export interface ProductModifierAssignmentCreate {
  group_id: string;
  min_select?: number;
  max_select?: number;
  is_required?: boolean;
  display_order?: number;
}

export interface ProductModifierAssignmentUpdate {
  min_select?: number;
  max_select?: number;
  is_required?: boolean;
  display_order?: number;
}

// Legacy aliases for any internal references (kept for compatibility in this migration)
export interface ModifierItem {
  id: string;
  name: string;
  price: number;
}

export interface ProductFormData {
  name: string;
  description: string;
  price: number;
  category_id: string;
  image_url: string | null;
  available: boolean;
  modifier_groups: ModifierGroup[];
}

export interface Category {
  id: string;
  name: string;
  sort_order: number;
  outlet_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CategoryFormData {
  name: string;
  outlet_id?: string | null;
}

export interface Order {
  id: string;
  order_number: string;
  outlet_id: string;
  outlet_name: string;
  staff_id: string;
  staff_name: string;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  total: number;
  status: OrderStatus;
  payment_method: string;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  modifiers: string[];
}

export type OrderStatus = 'pending' | 'completed' | 'cancelled' | 'refunded';

export interface Staff {
  id: string;
  name: string;
  role: StaffRole;
  outlet_id: string;
  outlet_name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type StaffRole = 'admin' | 'manager' | 'cashier' | 'kitchen';

export interface StaffFormData {
  name: string;
  role: StaffRole;
  outlet_id: string;
  pin?: string;
  is_active?: boolean;
}

export interface Outlet {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutletFormData {
  name: string;
  address: string;
  phone?: string | null;
}

export interface SalesSummary {
  total_sales: number;
  order_count: number;
  average_order_value: number;
  date: string;
}

export interface SalesReport {
  outlet_id: string;
  outlet_name: string;
  total_sales: number;
  order_count: number;
  items_sold: number;
}

export interface TopProduct {
  product_id: string;
  product_name: string;
  quantity_sold: number;
  revenue: number;
}

export interface StaffPerformance {
  staff_id: string;
  staff_name: string;
  order_count: number;
  total_sales: number;
  average_order_value: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface DateRange {
  start_date: string;
  end_date: string;
}

// === Report Types ===

export interface PaymentBreakdown {
  card: number;
  paynow: number;
  cash: number;
}

export interface HourlySale {
  hour: string; // e.g. "09:00", "10:00"
  revenue: number;
  transactions: number;
}

export interface DailyReport {
  total_revenue: number;
  total_transactions: number;
  avg_ticket_size: number;
  revenue_change_percent: number;
  transactions_change_percent: number;
  avg_ticket_change_percent: number;
  payment_breakdown: PaymentBreakdown;
  hourly_sales: HourlySale[];
}

export interface WeeklyReport {
  total_revenue: number;
  total_transactions: number;
  avg_ticket_size: number;
  revenue_change_percent: number;
  daily_breakdown: HourlySale[];
}

export interface MonthlyReport {
  total_revenue: number;
  total_transactions: number;
  avg_ticket_size: number;
  revenue_change_percent: number;
  transactions_change_percent: number;
  avg_ticket_change_percent: number;
  payment_breakdown: PaymentBreakdown;
  daily_breakdown: { date: string; revenue: number; transactions: number }[];
}

export interface CategoryBreakdown {
  category_name: string;
  revenue: number;
  quantity_sold: number;
  percentage: number;
}

export interface ProductPerformanceItem {
  product_id: string;
  product_name: string;
  units_sold: number;
  revenue: number;
  avg_modifiers_per_order: number;
  category_name: string;
}

export interface ProductReport {
  top_by_revenue: ProductPerformanceItem[];
  top_by_quantity: ProductPerformanceItem[];
  category_breakdown: CategoryBreakdown[];
  product_details: ProductPerformanceItem[];
}

export interface StaffPerformanceItem {
  staff_id: string;
  staff_name: string;
  transactions: number;
  revenue: number;
  avg_ticket: number;
}

export interface StaffHourlyBreakdown {
  staff_id: string;
  staff_name: string;
  hour: string;
  transactions: number;
  revenue: number;
}

export interface StaffReport {
  leaderboard: StaffPerformanceItem[];
  hourly_breakdown: StaffHourlyBreakdown[];
}

export interface OutletComparisonItem {
  outlet_id: string;
  outlet_name: string;
  revenue: number;
  transactions: number;
  avg_ticket: number;
  top_product: string;
}

export interface OutletReport {
  outlets: OutletComparisonItem[];
}

export interface DailyReportParams {
  outlet_id?: string;
  date?: string;
}

export interface WeeklyReportParams {
  outlet_id?: string;
  week?: string;
}

export interface MonthlyReportParams {
  outlet_id?: string;
  month?: string;
}

export interface ProductReportParams {
  outlet_id?: string;
  date_from?: string;
  date_to?: string;
}

export interface StaffReportParams {
  outlet_id?: string;
  date_from?: string;
  date_to?: string;
}

export interface OutletReportParams {
  date_from?: string;
  date_to?: string;
}

export interface CsvExportParams {
  outlet_id?: string;
  date_from?: string;
  date_to?: string;
}
// --- Vouchers ---
export type VoucherType = 'cdc' | 'acre_group';

export interface Voucher {
  id: string;
  code: string;
  type: VoucherType;
  amount: number;
  redeemed_at?: string | null;
  redeemed_by_staff_id?: string | null;
  outlet_id?: string | null;
  order_id?: string | null;
  created_at: string;
  updated_at: string;
  outlet_name?: string;
  staff_name?: string;
  order_number?: string;
}

export interface VoucherCreate {
  code: string;
  type?: VoucherType;
  amount: number;
}

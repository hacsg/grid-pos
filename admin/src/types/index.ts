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
  modifier_groups: ModifierGroup[];
}

export interface ModifierGroup {
  id: string;
  name: string;
  min_select: number;
  max_select: number;
  required: boolean;
  items: ModifierItem[];
}

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
  outlet_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface CategoryFormData {
  name: string;
  outlet_ids: string[];
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
  email: string;
  role: StaffRole;
  pin: string;
  outlet_id: string;
  outlet_name: string;
  active: boolean;
  created_at: string;
}

export type StaffRole = 'admin' | 'manager' | 'cashier' | 'kitchen';

export interface StaffFormData {
  name: string;
  email: string;
  role: StaffRole;
  outlet_id: string;
  pin: string;
}

export interface Outlet {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  active: boolean;
  created_at: string;
}

export interface OutletFormData {
  name: string;
  address: string;
  phone: string;
  email: string;
  active: boolean;
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
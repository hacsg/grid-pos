import axios, { type AxiosRequestConfig } from 'axios';
import toast from 'react-hot-toast';

export interface Timestamped {
  id: string;
  created_at?: string;
  updated_at?: string;
}

export interface Category extends Timestamped {
  name: string;
  sort_order: number;
  outlet_id: string | null;
}

export interface Outlet extends Timestamped {
  name: string;
  address: string;
  phone: string | null;
}

export interface Modifier extends Timestamped {
  name: string;
  price_adjustment: number | string;
  modifier_group_id?: string;
  group_id?: string;
  display_order?: number;
  is_available?: boolean;
}

export interface ModifierGroup extends Timestamped {
  name: string;
  description?: string | null;
  required: boolean;
  is_required?: boolean;
  min_select: number;
  max_select: number;
  product_id?: string;
  group_id?: string;
  group_name?: string;
  group_description?: string | null;
  display_order?: number;
  modifiers: Modifier[];
  options?: Modifier[];
}

export interface Product extends Timestamped {
  name: string;
  price: number | string;
  category_id: string;
  image_url: string | null;
  is_available: boolean;
  category?: Category;
  modifier_groups: ModifierGroup[];
  stock?: number | null;
  stock_quantity?: number | null;
  inventory_count?: number | null;
}

export type StaffRole = 'admin' | 'manager' | 'supervisor' | 'cashier' | 'kitchen';

export interface Staff extends Timestamped {
  name: string;
  role: StaffRole;
  outlet_id: string;
  is_active: boolean;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  staff: Staff;
  expires_in: number;
}

export interface SelectedModifier {
  modifier_name: string;
  price_adjustment: number;
}

export interface OrderItemCreate {
  product_id: string;
  quantity: number;
  modifiers: SelectedModifier[];
  notes?: string | null;
}

export type OrderStatus = 'pending' | 'paid' | 'refunded' | 'cancelled';

export interface OrderCreate {
  outlet_id: string;
  staff_id: string;
  items: OrderItemCreate[];
  status?: OrderStatus;
  payment_method?: string | null;
  payment_reference?: string | null;
  loyalty_member_id?: string | null;
  loyalty_points_redeemed?: number | null;
  loyalty_discount?: number | null;
  customer_id?: string | null;
  voucher_codes?: string[] | null;
}

export interface OrderRead extends Timestamped {
  order_number: string;
  outlet_id: string;
  staff_id: string;
  subtotal: number | string;
  total: number | string;
  status: OrderStatus;
  payment_method: string | null;
  payment_reference: string | null;
  loyalty_member_id?: string | null;
  loyalty_points_earned?: number | null;
  loyalty_points_redeemed?: number | null;
  loyalty_discount?: number | string | null;
  voucher_discount?: number | string | null;
  applied_vouchers?: Array<{
    id: string;
    voucher_id: string;
    code: string;
    type: 'cdc' | 'acre_group';
    amount_applied: number | string;
  }> | null;
  items: Array<{
    id: string;
    product_id: string;
    quantity: number;
    unit_price: number | string;
    modifiers: SelectedModifier[];
    notes: string | null;
  }>;
}

export interface LoyaltyMember {
  member_id: string;
  name: string;
  phone?: string;
  points: number;
  points_value: number | string;
  tier: string;
  lifetime_moments?: number;
  customer_id?: string;
  rewards?: LoyaltyReward[];
  vouchers?: LoyaltyReward[];
}

export interface LoyaltyReward {
  id: string;
  name: string;
  points: number;
  discount_amount: number;
  kind: 'points' | 'voucher';
}

export interface LoyaltyRedeemResponse {
  points_redeemed: number;
  discount_amount: number | string;
  remaining_balance: number;
  new_points: number;
}

type SilentRequestConfig = AxiosRequestConfig & {
  silent?: boolean;
};

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const config = error.config as SilentRequestConfig | undefined;
    const message =
      error.response?.data?.detail?.detail ||
      error.response?.data?.detail ||
      error.response?.data?.message ||
      error.message ||
      'An unexpected error occurred';

    if (!config?.silent) {
      if (error.response?.status === 401) {
        localStorage.removeItem('auth_token');
      }
      toast.error(typeof message === 'string' ? message : 'Request failed');
    }

    return Promise.reject(error);
  }
);

function unwrapList<T>(payload: T[] | { data: T[] }): T[] {
  return Array.isArray(payload) ? payload : payload.data;
}

export const money = (value: number | string | null | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const formatCurrency = (value: number | string | null | undefined): string =>
  new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency: 'SGD',
  }).format(money(value));

function numberOrDefault(value: number | string | null | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no'].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

function normalizeModifier(modifier: Partial<Modifier>, index: number): Modifier {
  return {
    ...modifier,
    id: String(modifier.id ?? modifier.name ?? index),
    name: modifier.name ?? 'Modifier',
    price_adjustment: money(modifier.price_adjustment),
    modifier_group_id: modifier.modifier_group_id ?? modifier.group_id,
    group_id: modifier.group_id ?? modifier.modifier_group_id,
    display_order: numberOrDefault(modifier.display_order, index),
    is_available: modifier.is_available ?? true,
  };
}

function normalizeModifierGroup(group: Partial<ModifierGroup>, index: number): ModifierGroup {
  const rawModifiers = Array.isArray(group.modifiers)
    ? group.modifiers
    : Array.isArray(group.options)
      ? group.options
      : [];
  const modifiers = rawModifiers
    .map((modifier, modifierIndex) => normalizeModifier(modifier, modifierIndex))
    .filter((modifier) => modifier.is_available !== false)
    .sort((a, b) => numberOrDefault(a.display_order, 0) - numberOrDefault(b.display_order, 0) || a.name.localeCompare(b.name));
  const maxSelect = Math.max(1, numberOrDefault(group.max_select, 1));
  const explicitRequired = optionalBoolean(group.required) ?? optionalBoolean(group.is_required);
  const minSelect = Math.min(maxSelect, Math.max(0, numberOrDefault(group.min_select, explicitRequired ? 1 : 0)));
  const isRequired = explicitRequired ?? (minSelect > 0);
  const name = group.name ?? group.group_name ?? 'Modifiers';

  return {
    ...group,
    id: String(group.id ?? group.group_id ?? name ?? index),
    name,
    description: group.description ?? group.group_description ?? null,
    required: isRequired,
    is_required: isRequired,
    min_select: minSelect,
    max_select: maxSelect,
    group_id: group.group_id,
    group_name: group.group_name ?? name,
    group_description: group.group_description ?? group.description ?? null,
    display_order: numberOrDefault(group.display_order, index),
    modifiers,
    options: modifiers,
  };
}

function normalizeProduct(product: Product): Product {
  const modifierGroups = Array.isArray(product.modifier_groups) ? product.modifier_groups : [];
  return {
    ...product,
    price: money(product.price),
    is_available: product.is_available ?? true,
    modifier_groups: modifierGroups
      .map((group, index) => normalizeModifierGroup(group, index))
      .filter((group) => group.modifiers.length > 0)
      .sort((a, b) => numberOrDefault(a.display_order, 0) - numberOrDefault(b.display_order, 0) || a.name.localeCompare(b.name)),
  };
}

export async function getOutlets(): Promise<Outlet[]> {
  const { data } = await api.get<Outlet[] | { data: Outlet[] }>('/outlets');
  return unwrapList(data);
}

export async function loginWithPin(outletId: string, pin: string): Promise<TokenResponse> {
  const { data } = await api.post<TokenResponse>('/auth/login', {
    outlet_id: outletId,
    pin,
  });
  localStorage.setItem('auth_token', data.access_token);
  return data;
}

export async function loginWithPassword(outletId: string, username: string, password: string): Promise<TokenResponse> {
  const { data } = await api.post<TokenResponse>('/auth/login', {
    outlet_id: outletId,
    username,
    password,
  });
  localStorage.setItem('auth_token', data.access_token);
  return data;
}

export async function getCurrentStaff(): Promise<Staff> {
  try {
    const { data } = await api.get<Staff>('/staff/me', { silent: true } as SilentRequestConfig);
    return data;
  } catch {
    const { data } = await api.get<Staff>('/auth/me');
    return data;
  }
}

export async function getCategories(params?: {
  outlet_id?: string;
  include_global?: boolean;
}): Promise<Category[]> {
  const { data } = await api.get<Category[] | { data: Category[] }>('/categories', { params });
  return unwrapList(data);
}

export async function getProducts(params?: {
  category_id?: string;
  outlet_id?: string;
  is_available?: boolean;
  include_modifiers?: boolean;
  search?: string;
}): Promise<Product[]> {
  const { search, ...apiParams } = params ?? {};
  const { data } = await api.get<Product[] | { data: Product[] }>('/products', {
    params: {
      include_modifiers: true,
      ...apiParams,
    },
  });
  const products = unwrapList(data).map(normalizeProduct);
  const query = search?.trim().toLowerCase();
  if (!query) {
    return products;
  }
  return products.filter((product) => product.name.toLowerCase().includes(query));
}

export async function createOrder(payload: OrderCreate): Promise<OrderRead> {
  const { data } = await api.post<OrderRead>('/orders', payload);
  return data;
}

export async function updateOrderStatus(
  orderId: string,
  payload: { status: OrderStatus; payment_method?: string | null; payment_reference?: string | null }
): Promise<OrderRead> {
  const { data } = await api.put<OrderRead>(`/orders/${orderId}/status`, payload);
  return data;
}

export async function lookupLoyalty(code: string): Promise<LoyaltyMember> {
  const { data } = await api.post<LoyaltyMember>('/loyalty/lookup', {
    phone: code.trim(),
  });
  return data;
}

export async function redeemLoyalty(
  memberId: string,
  orderId: string,
  pointsToRedeem: number
): Promise<LoyaltyRedeemResponse> {
  const { data } = await api.post<LoyaltyRedeemResponse>('/loyalty/redeem', {
    member_id: memberId,
    order_id: orderId,
    points_to_redeem: pointsToRedeem,
  });
  return data;
}

// ---------------------------------------------------------------------------
// Vouchers
// ---------------------------------------------------------------------------

export type VoucherType = 'cdc' | 'acre_group';

export interface VoucherRead extends Timestamped {
  code: string;
  type: VoucherType;
  amount: number | string;
  redeemed_at?: string | null;
  redeemed_by_staff_id?: string | null;
  outlet_id?: string | null;
  order_id?: string | null;
}

export interface VoucherValidateResponse {
  id: string;
  code: string;
  type: VoucherType;
  amount: number | string;
  is_valid: boolean;
}

export interface AppliedVoucher {
  id: string;
  voucher_id: string;
  code: string;
  type: VoucherType;
  amount_applied: number | string;
  created_at?: string | null;
}

export interface VoucherApplyPayload {
  codes: string[];
}

export async function validateVoucher(code: string): Promise<VoucherValidateResponse> {
  const { data } = await api.post<VoucherValidateResponse>('/vouchers/validate', { code: code.trim() });
  return data;
}

export async function applyVouchersToOrder(orderId: string, codes: string[]): Promise<OrderRead> {
  const { data } = await api.post<OrderRead>(`/orders/${orderId}/vouchers`, { codes });
  return data;
}

export async function createVoucher(payload: { code: string; type?: VoucherType; amount: number }): Promise<VoucherRead> {
  const { data } = await api.post<VoucherRead>('/vouchers', payload);
  return data;
}

export async function listVouchers(params?: { type?: VoucherType; redeemed?: boolean; limit?: number }): Promise<VoucherRead[]> {
  const { data } = await api.get<VoucherRead[] | { data: VoucherRead[] }>('/vouchers', { params });
  return Array.isArray(data) ? data : (data as any).data ?? [];
}
// cache-bust 1780963317

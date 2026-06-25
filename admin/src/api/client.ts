import axios from 'axios';
import toast from 'react-hot-toast';
import type {
  Product,
  ProductFormData,
  Category,
  CategoryFormData,
  Order,
  OrderStatus,
  Staff,
  StaffFormData,
  Outlet,
  OutletFormData,
  SalesSummary,
  SalesReport,
  TopProduct,
  StaffPerformance,
  DateRange,
  PaginatedResponse,
  DailyReport,
  WeeklyReport,
  MonthlyReport,
  ProductReport,
  StaffReport,
  OutletReport,
  DailyReportParams,
  WeeklyReportParams,
  MonthlyReportParams,
  ProductReportParams,
  StaffReportParams,
  OutletReportParams,
  CsvExportParams,
  ModifierGroup,
  ModifierGroupCreate,
  ModifierGroupUpdate,
  ModifierOption,
  ModifierOptionCreate,
  ModifierOptionUpdate,
  ProductModifierAssignment,
  ProductModifierAssignmentCreate,
  ProductModifierAssignmentUpdate,
  Voucher,
  VoucherCreate,
  VoucherIssueRequest,
  VoucherBulkIssueRequest,
  VoucherBulkIssueResponse,
  Campaign,
  CampaignFormData,
  CampaignMetrics,
  Customer,
  Discount,
  DiscountFormData,
} from '@/types';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1',
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
    const message =
      error.response?.data?.detail ||
      error.response?.data?.message ||
      error.message ||
      'An unexpected error occurred';

    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      window.location.href = '/login';
    }

    toast.error(message);
    return Promise.reject(error);
  }
);

const toNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBoolean = (value: unknown, fallback = false): boolean => {
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
  return fallback;
};

const normalizeModifierOption = (option: any): ModifierOption => ({
  ...option,
  price_adjustment: toNumber(option?.price_adjustment, 0),
});

const normalizeProductModifierAssignment = (assignment: any): ProductModifierAssignment => ({
  ...assignment,
  min_select: toNumber(assignment?.min_select, 0),
  max_select: Math.max(1, toNumber(assignment?.max_select, 1)),
  is_required: toBoolean(assignment?.is_required, false),
  display_order: toNumber(assignment?.display_order, 0),
  options: (assignment?.options || []).map(normalizeModifierOption),
});

// Products
export const getProducts = async (params?: {
  search?: string;
  category_id?: string;
  available?: boolean;
  page?: number;
  limit?: number;
}): Promise<PaginatedResponse<Product>> => {
  const { data } = await api.get('/products', { params });
  const normalized = Array.isArray(data) 
    ? data.map((p: any) => ({
        ...p,
        name: p.name ?? '',
        price: typeof p.price === 'string' ? parseFloat(p.price) : (p.price ?? 0),
        available: p.is_available ?? true,
        description: p.description ?? '',
        category_id: p.category_id ?? p.category?.id ?? '',
        category_name: p.category?.name || '',
        modifier_groups: (p.modifier_groups || []).map(normalizeProductModifierAssignment),
      }))
    : [];
  return { data: normalized, total: normalized.length, page: 1, limit: normalized.length || 100 };
};

export const getProduct = async (id: string): Promise<Product> => {
  const { data } = await api.get(`/products/${id}`);
  const p: any = data || {};
  return {
    ...p,
    name: p.name ?? '',
    price: typeof p.price === 'string' ? parseFloat(p.price) : (p.price ?? 0),
    available: p.is_available ?? true,
    description: p.description ?? '',
    category_id: p.category_id ?? p.category?.id ?? '',
    category_name: p.category?.name || '',
    modifier_groups: (p.modifier_groups || []).map(normalizeProductModifierAssignment),
  } as Product;
};

export const createProduct = async (product: ProductFormData): Promise<Product> => {
  const { data } = await api.post('/products', product);
  toast.success('Product created successfully');
  return data;
};

export const updateProduct = async (id: string, product: Partial<ProductFormData>): Promise<Product> => {
  const { data } = await api.put(`/products/${id}`, product);
  toast.success('Product updated successfully');
  return data;
};

export const deleteProduct = async (id: string): Promise<void> => {
  await api.delete(`/products/${id}`);
  toast.success('Product deleted successfully');
};

export const deleteProducts = async (ids: string[]): Promise<void> => {
  await api.post('/products/bulk-delete', { ids });
  toast.success(`${ids.length} products deleted successfully`);
};

export const toggleProductAvailability = async (id: string): Promise<Product> => {
  const { data } = await api.patch(`/products/${id}/toggle-availability`);
  return data;
};

export const toggleProductsAvailability = async (ids: string[], available: boolean): Promise<void> => {
  await api.post('/products/bulk-toggle-availability', { ids, available });
  toast.success(`${ids.length} products updated`);
};

// Categories
export const getCategories = async (params?: {
  page?: number;
  limit?: number;
}): Promise<PaginatedResponse<Category>> => {
  const { data } = await api.get('/categories', { params });
  const items = Array.isArray(data) ? data : [];
  const normalized: Category[] = items.map((c: Record<string, unknown>) => ({
    id: c.id as string,
    name: c.name as string,
    sort_order: (c.sort_order as number) ?? 0,
    outlet_id: (c.outlet_id as string | null) ?? null,
    created_at: c.created_at as string,
    updated_at: c.updated_at as string,
  }));
  return {
    data: normalized,
    total: normalized.length,
    page: 1,
    limit: normalized.length || 100,
  };
};

export const createCategory = async (category: CategoryFormData): Promise<Category> => {
  const { data } = await api.post('/categories', category);
  toast.success('Category created successfully');
  return data;
};

export const updateCategory = async (id: string, category: Partial<CategoryFormData>): Promise<Category> => {
  const { data } = await api.put(`/categories/${id}`, category);
  toast.success('Category updated successfully');
  return data;
};

export const deleteCategory = async (id: string): Promise<void> => {
  await api.delete(`/categories/${id}`);
  toast.success('Category deleted successfully');
};

export const reorderCategories = async (ids: string[]): Promise<void> => {
  const items = ids.map((id, index) => ({ id, sort_order: index }));
  await api.patch('/categories/reorder', { items });
  toast.success('Categories reordered successfully');
};

// Auth
export const login = async (payload: {
  name: string;
  pin: string;
  outlet_id?: string;
}): Promise<{ access_token: string; token_type: string; expires_in: number }> => {
  const { data } = await api.post('/auth/login', payload);
  return data;
};

// Orders
export const getOrders = async (params?: {
  page?: number;
  limit?: number;
  status?: OrderStatus;
  outlet_id?: string;
  staff_id?: string;
  date_from?: string;
  date_to?: string;
}): Promise<PaginatedResponse<Order>> => {
  const { data } = await api.get('/orders', { params });
  return data;
};

export const getOrder = async (id: string): Promise<Order> => {
  const { data } = await api.get(`/orders/${id}`);
  return data;
};

export const refundOrder = async (id: string): Promise<Order> => {
  const { data } = await api.post(`/orders/${id}/refund`);
  toast.success('Order refunded successfully');
  return data;
};

// Staff
export const getStaffList = async (params?: {
  page?: number;
  limit?: number;
  outlet_id?: string;
}): Promise<PaginatedResponse<Staff>> => {
  const [{ data: staffData }, { data: outletsData }] = await Promise.all([
    api.get('/staff', { params }),
    api.get('/outlets'),
  ]);
  const outlets = Array.isArray(outletsData) ? outletsData : [];
  const outletMap = new Map(
    outlets.map((o: Record<string, unknown>) => [o.id as string, o.name as string])
  );
  const items = Array.isArray(staffData) ? staffData : [];
  const normalized: Staff[] = items.map((s: Record<string, unknown>) => ({
    id: s.id as string,
    name: s.name as string,
    role: s.role as Staff['role'],
    outlet_id: s.outlet_id as string,
    outlet_name: outletMap.get(s.outlet_id as string) ?? '',
    active: (s.is_active as boolean) ?? true,
    created_at: s.created_at as string,
    updated_at: s.updated_at as string,
  }));
  return {
    data: normalized,
    total: normalized.length,
    page: 1,
    limit: normalized.length || 100,
  };
};

export const createStaff = async (staff: StaffFormData): Promise<Staff> => {
  const { data } = await api.post('/staff', staff);
  toast.success('Staff created successfully');
  return data;
};

export const updateStaff = async (id: string, staff: Partial<StaffFormData>): Promise<Staff> => {
  const { data } = await api.put(`/staff/${id}`, staff);
  toast.success('Staff updated successfully');
  return data;
};

export const deleteStaff = async (id: string): Promise<void> => {
  await api.delete(`/staff/${id}`);
  toast.success('Staff deleted successfully');
};

export const resetStaffPin = async (id: string, newPin: string): Promise<void> => {
  await api.post(`/staff/${id}/reset-pin`, { new_pin: newPin });
  toast.success('PIN reset successfully');
};

// Outlets
export const getOutlets = async (params?: {
  page?: number;
  limit?: number;
}): Promise<PaginatedResponse<Outlet>> => {
  const { data } = await api.get('/outlets', { params });
  const items = Array.isArray(data) ? data : [];
  const normalized: Outlet[] = items.map((o: Record<string, unknown>) => ({
    id: o.id as string,
    name: o.name as string,
    address: o.address as string,
    phone: (o.phone as string | null) ?? null,
    paynow_qr_url: (o.paynow_qr_url as string | null) ?? null,
    logo_url: (o.logo_url as string | null) ?? null,
    created_at: o.created_at as string,
    updated_at: o.updated_at as string,
  }));
  return {
    data: normalized,
    total: normalized.length,
    page: 1,
    limit: normalized.length || 100,
  };
};

export const createOutlet = async (outlet: OutletFormData): Promise<Outlet> => {
  const { data } = await api.post('/outlets', outlet);
  toast.success('Outlet created successfully');
  return data;
};

export const updateOutlet = async (id: string, outlet: Partial<OutletFormData>): Promise<Outlet> => {
  const { data } = await api.put(`/outlets/${id}`, outlet);
  toast.success('Outlet updated successfully');
  return data;
};

export const deleteOutlet = async (id: string): Promise<void> => {
  await api.delete(`/outlets/${id}`);
  toast.success('Outlet deleted successfully');
};

export interface PayNowQrResponse {
  outlet_id: string;
  paynow_qr_url: string | null;
}

export const uploadPayNowQr = async (id: string, file: File): Promise<PayNowQrResponse> => {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.put<PayNowQrResponse>(`/outlets/${id}/paynow-qr`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  toast.success('PayNow QR updated');
  return data;
};

export const deletePayNowQr = async (id: string): Promise<PayNowQrResponse> => {
  const { data } = await api.delete<PayNowQrResponse>(`/outlets/${id}/paynow-qr`);
  toast.success('PayNow QR removed');
  return data;
};

export interface OutletLogoResponse {
  outlet_id: string;
  logo_url: string | null;
}

export const uploadOutletLogo = async (id: string, file: File): Promise<OutletLogoResponse> => {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.put<OutletLogoResponse>(`/outlets/${id}/logo`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  toast.success('Logo updated');
  return data;
};

export const deleteOutletLogo = async (id: string): Promise<OutletLogoResponse> => {
  const { data } = await api.delete<OutletLogoResponse>(`/outlets/${id}/logo`);
  toast.success('Logo removed');
  return data;
};

// Reports
export const getSalesSummary = async (): Promise<SalesSummary> => {
  const { data } = await api.get('/reports/sales-summary');
  return data;
};

export const getSalesByOutlet = async (dateRange: DateRange): Promise<SalesReport[]> => {
  const { data } = await api.get('/reports/sales-by-outlet', { params: dateRange });
  return data;
};

export const getTopProducts = async (dateRange: DateRange): Promise<TopProduct[]> => {
  const { data } = await api.get('/reports/top-products', { params: dateRange });
  return data;
};

export const getStaffPerformance = async (dateRange: DateRange): Promise<StaffPerformance[]> => {
  const { data } = await api.get('/reports/staff-performance', { params: dateRange });
  return data;
};

export const getDailyReport = async (params?: DailyReportParams): Promise<DailyReport> => {
  const { data } = await api.get('/reports/daily', { params });
  return data;
};

export const getWeeklyReport = async (params?: WeeklyReportParams): Promise<WeeklyReport> => {
  const { data } = await api.get('/reports/weekly', { params });
  return data;
};

export const getMonthlyReport = async (params?: MonthlyReportParams): Promise<MonthlyReport> => {
  const { data } = await api.get('/reports/monthly', { params });
  return data;
};

export const getProductReport = async (params?: ProductReportParams): Promise<ProductReport> => {
  const { data } = await api.get('/reports/products', { params });
  return data;
};

export const getStaffReport = async (params?: StaffReportParams): Promise<StaffReport> => {
  const { data } = await api.get('/reports/staff', { params });
  return data;
};

export const getOutletReport = async (params?: OutletReportParams): Promise<OutletReport> => {
  const { data } = await api.get('/reports/outlets', { params });
  return data;
};

export const exportReportCSV = async (params?: CsvExportParams): Promise<Blob> => {
  const { data } = await api.get('/reports/export/csv', {
    params,
    responseType: 'blob',
  });
  return data;
};

// Vouchers
const normalizeVoucher = (voucher: any): Voucher => ({
  ...voucher,
  amount: typeof voucher?.amount === 'string' ? parseFloat(voucher.amount) : (voucher?.amount ?? 0),
  discount_cents: voucher?.discount_cents ?? null,
  customer_id: voucher?.customer_id ?? null,
  campaign_id: voucher?.campaign_id ?? null,
  customer_name: voucher?.customer_name ?? null,
  customer_phone: voucher?.customer_phone ?? null,
  campaign_name: voucher?.campaign_name ?? null,
  campaign_code_prefix: voucher?.campaign_code_prefix ?? null,
});

export const getVouchers = async (params?: {
  type?: 'cdc' | 'acre_group';
  redeemed?: boolean;
  campaign_id?: string;
  limit?: number;
  offset?: number;
}): Promise<Voucher[]> => {
  const { data } = await api.get('/vouchers', { params });
  return (Array.isArray(data) ? data : []).map(normalizeVoucher);
};

export const createVoucher = async (payload: VoucherCreate): Promise<Voucher> => {
  const { data } = await api.post('/vouchers', payload);
  toast.success('Voucher created');
  return normalizeVoucher(data);
};

export const issueVoucher = async (payload: VoucherIssueRequest): Promise<Voucher> => {
  const { data } = await api.post('/vouchers/issue', payload);
  toast.success('Voucher issued');
  return normalizeVoucher(data);
};

export const bulkIssueVouchers = async (
  payload: VoucherBulkIssueRequest
): Promise<VoucherBulkIssueResponse> => {
  const { data } = await api.post('/vouchers/bulk-issue', payload);
  const issued = toNumber(data?.issued, 0);
  toast.success(`${issued} voucher${issued === 1 ? '' : 's'} issued`);
  return {
    issued,
    codes: Array.isArray(data?.codes) ? data.codes : [],
  };
};

// Campaigns
const normalizeCampaign = (campaign: any): Campaign => ({
  ...campaign,
  budget_cents: campaign?.budget_cents ?? null,
  discount_cents: toNumber(campaign?.discount_cents, 0),
  auto_issue_on_signup: toBoolean(campaign?.auto_issue_on_signup, false),
  signup_voucher_discount_cents: campaign?.signup_voucher_discount_cents ?? null,
  voucher_style: campaign?.voucher_style ?? null,
  voucher_accent_color: campaign?.voucher_accent_color ?? null,
  voucher_headline: campaign?.voucher_headline ?? null,
  voucher_background_url: campaign?.voucher_background_url ?? null,
});

export const getCampaigns = async (): Promise<Campaign[]> => {
  const { data } = await api.get('/campaigns');
  return (Array.isArray(data) ? data : []).map(normalizeCampaign);
};

export const createCampaign = async (payload: CampaignFormData): Promise<Campaign> => {
  const { data } = await api.post('/campaigns', payload);
  toast.success('Campaign created');
  return normalizeCampaign(data);
};

export const updateCampaign = async (
  id: string,
  payload: Partial<CampaignFormData>
): Promise<Campaign> => {
  const { data } = await api.put(`/campaigns/${id}`, payload);
  toast.success('Campaign updated');
  return normalizeCampaign(data);
};

export const getCampaignMetrics = async (id: string): Promise<CampaignMetrics> => {
  const { data } = await api.get(`/campaigns/${id}/metrics`);
  return {
    campaign_id: data.campaign_id,
    campaign_name: data.campaign_name,
    total_signups: toNumber(data.total_signups, 0),
    vouchers_auto_issued: toNumber(data.vouchers_auto_issued, 0),
    signup_purchase_conversions: toNumber(data.signup_purchase_conversions, 0),
    signup_purchase_conversion_rate: toNumber(data.signup_purchase_conversion_rate, 0),
  };
};

// Customers
export const getCustomers = async (): Promise<Customer[]> => {
  const { data } = await api.get('/customers');
  return (Array.isArray(data) ? data : []).map((customer: any) => ({
    ...customer,
    moments_total: toNumber(customer?.moments_total, 0),
    voucher_count: toNumber(customer?.voucher_count, 0),
  }));
};

// ---------------------------------------------------------------------------
// Modifiers
// ---------------------------------------------------------------------------

export const getModifierGroups = async (): Promise<ModifierGroup[]> => {
  const { data } = await api.get('/modifier-groups');
  // Normalize price_adjustment (may arrive as string) to number
  return (Array.isArray(data) ? data : []).map((g: any) => ({
    ...g,
    options: (g.options || []).map((o: any) => ({
      ...o,
      price_adjustment: typeof o.price_adjustment === 'string' ? parseFloat(o.price_adjustment) : o.price_adjustment,
    })),
  }));
};

export const createModifierGroup = async (payload: ModifierGroupCreate): Promise<ModifierGroup> => {
  const { data } = await api.post('/modifier-groups', payload);
  toast.success('Modifier group created');
  return data;
};

export const updateModifierGroup = async (id: string, payload: ModifierGroupUpdate): Promise<ModifierGroup> => {
  const { data } = await api.put(`/modifier-groups/${id}`, payload);
  toast.success('Modifier group updated');
  return data;
};

export const deleteModifierGroup = async (id: string): Promise<void> => {
  await api.delete(`/modifier-groups/${id}`);
  toast.success('Modifier group deleted');
};

export const createModifierOption = async (groupId: string, payload: ModifierOptionCreate): Promise<ModifierOption> => {
  const { data } = await api.post(`/modifier-groups/${groupId}/options`, payload);
  return normalizeModifierOption(data);
};

export const updateModifierOption = async (id: string, payload: ModifierOptionUpdate): Promise<ModifierOption> => {
  const { data } = await api.put(`/modifier-options/${id}`, payload);
  return normalizeModifierOption(data);
};

export const deleteModifierOption = async (id: string): Promise<void> => {
  await api.delete(`/modifier-options/${id}`);
};

export const getProductModifierGroups = async (productId: string): Promise<ProductModifierAssignment[]> => {
  const { data } = await api.get(`/products/${productId}/modifier-groups`);
  return (Array.isArray(data) ? data : []).map(normalizeProductModifierAssignment);
};

export const assignModifierGroupToProduct = async (
  productId: string,
  payload: ProductModifierAssignmentCreate
): Promise<ProductModifierAssignment> => {
  const { data } = await api.post(`/products/${productId}/modifier-groups`, payload);
  toast.success('Modifier group assigned');
  return normalizeProductModifierAssignment(data);
};

export const updateProductModifierAssignment = async (
  productId: string,
  assignmentId: string,
  payload: ProductModifierAssignmentUpdate
): Promise<ProductModifierAssignment> => {
  const { data } = await api.put(
    `/products/${productId}/modifier-groups/${assignmentId}`,
    payload
  );
  toast.success('Assignment updated');
  return normalizeProductModifierAssignment(data);
};

export const unassignModifierGroupFromProduct = async (productId: string, assignmentId: string): Promise<void> => {
  await api.delete(`/products/${productId}/modifier-groups/${assignmentId}`);
  toast.success('Modifier group unassigned');
};

export const reorderProductModifierGroups = async (productId: string, ids: string[]): Promise<void> => {
  const items = ids.map((id, index) => ({ id, sort_order: index }));
  await api.patch(`/products/${productId}/modifier-groups/reorder`, { items });
  toast.success('Modifier groups reordered');
};

export const assignModifierGroup = assignModifierGroupToProduct;
export const unassignModifierGroup = unassignModifierGroupFromProduct;

// Discounts
export const getDiscounts = async (): Promise<Discount[]> => {
  const { data } = await api.get('/discounts');
  const list = Array.isArray(data) ? data : [];
  return list.map((d: any) => ({
    id: d.id,
    name: d.name,
    kind: d.kind,
    amount: toNumber(d.amount, 0),
    is_active: toBoolean(d.is_active, true),
    outlet_id: d.outlet_id ?? null,
    sort_order: toNumber(d.sort_order, 0),
    created_at: d.created_at,
    updated_at: d.updated_at,
  }));
};

export const createDiscount = async (payload: DiscountFormData): Promise<Discount> => {
  const { data } = await api.post('/discounts', payload);
  toast.success('Discount created');
  return {
    ...data,
    amount: toNumber(data.amount, 0),
    is_active: toBoolean(data.is_active, true),
    sort_order: toNumber(data.sort_order, 0),
  };
};

export const updateDiscount = async (id: string, payload: Partial<DiscountFormData>): Promise<Discount> => {
  const { data } = await api.put(`/discounts/${id}`, payload);
  toast.success('Discount updated');
  return {
    ...data,
    amount: toNumber(data.amount, 0),
    is_active: toBoolean(data.is_active, true),
    sort_order: toNumber(data.sort_order, 0),
  };
};

export const deleteDiscount = async (id: string): Promise<void> => {
  await api.delete(`/discounts/${id}`);
  toast.success('Discount deleted');
};

export const toggleDiscountActive = async (id: string): Promise<Discount> => {
  const { data } = await api.patch(`/discounts/${id}/toggle`);
  toast.success('Discount status updated');
  return {
    ...data,
    amount: toNumber(data.amount, 0),
    is_active: toBoolean(data.is_active, true),
    sort_order: toNumber(data.sort_order, 0),
  };
};

export const reorderDiscounts = async (ids: string[]): Promise<void> => {
  await api.patch('/discounts/reorder', { ids });
  toast.success('Discounts reordered');
};

const isNewProductModifierAssignment = (assignment: ProductModifierAssignment): boolean =>
  assignment.id.startsWith('new-');

const toAssignmentUpdatePayload = (
  assignment: ProductModifierAssignment
): ProductModifierAssignmentUpdate => ({
  min_select: assignment.min_select,
  max_select: assignment.max_select,
  is_required: assignment.is_required,
  display_order: assignment.display_order,
});

const hasAssignmentChanged = (
  original: ProductModifierAssignment,
  next: ProductModifierAssignment
): boolean =>
  original.min_select !== next.min_select ||
  original.max_select !== next.max_select ||
  original.is_required !== next.is_required ||
  original.display_order !== next.display_order;

export const hasProductModifierAssignmentChanges = (
  originalAssignments: ProductModifierAssignment[],
  assignments: ProductModifierAssignment[]
): boolean => {
  const originalById = new Map(originalAssignments.map((assignment) => [assignment.id, assignment]));
  const persistedAssignments = assignments.filter((assignment) => !isNewProductModifierAssignment(assignment));
  const persistedIds = new Set(persistedAssignments.map((assignment) => assignment.id));

  return (
    assignments.some(isNewProductModifierAssignment) ||
    originalAssignments.some((assignment) => !persistedIds.has(assignment.id)) ||
    persistedAssignments.some((assignment) => {
      const original = originalById.get(assignment.id);
      return !!original && hasAssignmentChanged(original, assignment);
    })
  );
};

export const saveProductModifierAssignments = async (
  productId: string,
  originalAssignments: ProductModifierAssignment[],
  assignments: ProductModifierAssignment[]
): Promise<void> => {
  if (!hasProductModifierAssignmentChanges(originalAssignments, assignments)) {
    return;
  }

  const originalById = new Map(originalAssignments.map((assignment) => [assignment.id, assignment]));
  const persistedAssignments = assignments.filter((assignment) => !isNewProductModifierAssignment(assignment));
  const persistedIds = new Set(persistedAssignments.map((assignment) => assignment.id));
  const actualIdsByTempId = new Map<string, string>();

  const removedAssignments = originalAssignments.filter(
    (assignment) => !persistedIds.has(assignment.id)
  );
  const modifiedAssignments = persistedAssignments.filter((assignment) => {
    const original = originalById.get(assignment.id);
    return !!original && hasAssignmentChanged(original, assignment);
  });
  const newAssignments = assignments.filter(isNewProductModifierAssignment);

  for (const assignment of removedAssignments) {
    await api.delete(`/products/${productId}/modifier-groups/${assignment.id}`);
  }

  for (const assignment of modifiedAssignments) {
    await api.put(
      `/products/${productId}/modifier-groups/${assignment.id}`,
      toAssignmentUpdatePayload(assignment)
    );
  }

  for (const assignment of newAssignments) {
    const { data } = await api.post(`/products/${productId}/modifier-groups`, {
      group_id: assignment.group_id,
    });
    const created = normalizeProductModifierAssignment(data);
    actualIdsByTempId.set(assignment.id, created.id);

    await api.put(
      `/products/${productId}/modifier-groups/${created.id}`,
      toAssignmentUpdatePayload(assignment)
    );
  }

  const reorderIds = assignments.map((assignment) =>
    isNewProductModifierAssignment(assignment)
      ? actualIdsByTempId.get(assignment.id) || assignment.id
      : assignment.id
  );
  await api.patch(`/products/${productId}/modifier-groups/reorder`, {
    items: reorderIds.map((id, index) => ({ id, sort_order: index })),
  });

  toast.success('Modifier assignments updated');
};

export default api;

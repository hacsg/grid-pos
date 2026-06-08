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
        modifier_groups: (p.modifier_groups || []).map((mg: any) => ({
          ...mg,
          options: (mg.options || []).map((o: any) => ({
            ...o,
            price_adjustment: typeof o.price_adjustment === 'string' ? parseFloat(o.price_adjustment) : (o.price_adjustment ?? 0),
          })),
        })),
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
    modifier_groups: (p.modifier_groups || []).map((mg: any) => ({
      ...mg,
      options: (mg.options || []).map((o: any) => ({
        ...o,
        price_adjustment: typeof o.price_adjustment === 'string' ? parseFloat(o.price_adjustment) : (o.price_adjustment ?? 0),
      })),
    })),
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
  return {
    ...data,
    price_adjustment: typeof data.price_adjustment === 'string' ? parseFloat(data.price_adjustment) : data.price_adjustment,
  };
};

export const updateModifierOption = async (id: string, payload: ModifierOptionUpdate): Promise<ModifierOption> => {
  const { data } = await api.put(`/modifier-options/${id}`, payload);
  return {
    ...data,
    price_adjustment: typeof data.price_adjustment === 'string' ? parseFloat(data.price_adjustment) : data.price_adjustment,
  };
};

export const deleteModifierOption = async (id: string): Promise<void> => {
  await api.delete(`/modifier-options/${id}`);
};

export const getProductModifierGroups = async (productId: string): Promise<ProductModifierAssignment[]> => {
  const { data } = await api.get(`/products/${productId}/modifier-groups`);
  return (Array.isArray(data) ? data : []).map((a: any) => ({
    ...a,
    options: (a.options || []).map((o: any) => ({
      ...o,
      price_adjustment: typeof o.price_adjustment === 'string' ? parseFloat(o.price_adjustment) : o.price_adjustment,
    })),
  }));
};

export const assignModifierGroupToProduct = async (
  productId: string,
  payload: ProductModifierAssignmentCreate
): Promise<ProductModifierAssignment> => {
  const { data } = await api.post(`/products/${productId}/modifier-groups`, payload);
  toast.success('Modifier group assigned');
  return data;
};

export const updateProductModifierAssignment = async (
  productId: string,
  assignmentId: string,
  payload: ProductModifierAssignmentUpdate
): Promise<ProductModifierAssignment> => {
  const { data } = await api.put(`/products/${productId}/modifier-groups/${assignmentId}`, payload);
  toast.success('Assignment updated');
  return data;
};

export const unassignModifierGroupFromProduct = async (productId: string, assignmentId: string): Promise<void> => {
  await api.delete(`/products/${productId}/modifier-groups/${assignmentId}`);
  toast.success('Modifier group unassigned');
};

export default api;
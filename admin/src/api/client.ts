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
} from '@/types';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

function toPaginated<T>(resp: any): PaginatedResponse<T> {
  if (resp && typeof resp === 'object' && Array.isArray(resp.data)) {
    return resp as PaginatedResponse<T>;
  }
  if (Array.isArray(resp)) {
    return { data: resp as T[], total: resp.length, page: 1, limit: resp.length || 100 };
  }
  return { data: [], total: 0, page: 1, limit: 100 };
}

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
  return toPaginated<Product>(data);
};

export const getProduct = async (id: string): Promise<Product> => {
  const { data } = await api.get(`/products/${id}`);
  return data;
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
  const pag = toPaginated<Category>(data);
  pag.data = pag.data.map((c: any) => ({
    ...c,
    outlet_ids: c.outlet_ids ?? (c.outlet_id ? [c.outlet_id] : []),
    outlet_id: c.outlet_id ?? null,
  }));
  return pag;
};

export const createCategory = async (category: CategoryFormData): Promise<Category> => {
  const payload: any = { name: category.name };
  const oid = category.outlet_id ?? (category.outlet_ids && category.outlet_ids.length ? category.outlet_ids[0] : undefined);
  if (oid !== undefined) payload.outlet_id = oid;
  const { data } = await api.post('/categories', payload);
  toast.success('Category created successfully');
  return data;
};

export const updateCategory = async (id: string, category: Partial<CategoryFormData>): Promise<Category> => {
  const payload: any = {};
  if (category.name != null) payload.name = category.name;
  if (category.outlet_ids !== undefined || category.outlet_id !== undefined) {
    const oid = category.outlet_id ?? (category.outlet_ids && category.outlet_ids.length ? category.outlet_ids[0] : null);
    payload.outlet_id = oid;
  }
  const { data } = await api.put(`/categories/${id}`, payload);
  toast.success('Category updated successfully');
  return data;
};

export const deleteCategory = async (id: string): Promise<void> => {
  await api.delete(`/categories/${id}`);
  toast.success('Category deleted successfully');
};

export const reorderCategories = async (ids: string[]): Promise<void> => {
  await api.put('/categories/reorder', { ids });
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
  const pag = toPaginated<Order>(data);
  pag.data = pag.data.map((o: any) => ({
    ...o,
    status: (o.status === 'paid' ? 'completed' : o.status) as OrderStatus,
  }));
  return pag;
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
  const { data } = await api.get('/staff', { params });
  const pag = toPaginated<Staff>(data);
  pag.data = pag.data.map((s: any) => ({
    ...s,
    active: s.active ?? s.is_active ?? true,
    email: s.email ?? '',
    pin: '****',
    outlet_name: s.outlet_name ?? '',
  }));
  return pag;
};

export const createStaff = async (staff: StaffFormData): Promise<Staff> => {
  // backend StaffCreate does not include email; pin required; outlet_id required
  const { email, ...payload } = staff as any;
  const { data } = await api.post('/staff', payload);
  toast.success('Staff created successfully');
  return data;
};

export const updateStaff = async (id: string, staff: Partial<StaffFormData>): Promise<Staff> => {
  const { email, pin, ...payload } = staff as any; // pin not updatable here; use reset
  const { data } = await api.put(`/staff/${id}`, payload);
  toast.success('Staff updated successfully');
  return data;
};

export const deleteStaff = async (id: string): Promise<void> => {
  await api.delete(`/staff/${id}`);
  toast.success('Staff deleted successfully');
};

export const resetStaffPin = async (id: string, newPin: string): Promise<void> => {
  await api.post(`/staff/${id}/reset-pin`, { pin: newPin });
  toast.success('PIN reset successfully');
};

// Outlets
export const getOutlets = async (params?: {
  page?: number;
  limit?: number;
}): Promise<PaginatedResponse<Outlet>> => {
  const { data } = await api.get('/outlets', { params });
  const pag = toPaginated<Outlet>(data);
  pag.data = pag.data.map((o: any) => ({
    ...o,
    active: o.active ?? o.is_active ?? true,
    email: o.email ?? '',
    address: o.address ?? '',
    phone: o.phone ?? '',
  }));
  return pag;
};

export const createOutlet = async (outlet: OutletFormData): Promise<Outlet> => {
  const payload: any = {
    name: outlet.name,
    address: outlet.address,
  };
  if (outlet.phone != null) payload.phone = outlet.phone;
  const { data } = await api.post('/outlets', payload);
  toast.success('Outlet created successfully');
  return data;
};

export const updateOutlet = async (id: string, outlet: Partial<OutletFormData>): Promise<Outlet> => {
  const payload: any = {};
  if (outlet.name != null) payload.name = outlet.name;
  if (outlet.address != null) payload.address = outlet.address;
  if (outlet.phone != null) payload.phone = outlet.phone;
  // backend uses PATCH and does not support email/active
  const { data } = await api.patch(`/outlets/${id}`, payload);
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

export default api;
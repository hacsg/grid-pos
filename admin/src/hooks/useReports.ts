import { useQuery } from '@tanstack/react-query';
import {
  getSalesSummary,
  getSalesByOutlet,
  getDailyReport,
  getWeeklyReport,
  getMonthlyReport,
  getProductReport,
  getStaffReport,
  getOutletReport,
} from '@/api/client';
import type {
  DateRange,
  DailyReportParams,
  WeeklyReportParams,
  MonthlyReportParams,
  ProductReportParams,
  StaffReportParams,
  OutletReportParams,
} from '@/types';

export function useSalesSummary() {
  return useQuery({
    queryKey: ['reports', 'sales-summary'],
    queryFn: () => getSalesSummary(),
  });
}

export function useSalesByOutlet(dateRange?: DateRange) {
  return useQuery({
    queryKey: ['reports', 'sales-by-outlet', dateRange],
    queryFn: () => getSalesByOutlet(dateRange!),
    enabled: !!dateRange,
  });
}

export function useDailyReport(params?: DailyReportParams) {
  return useQuery({
    queryKey: ['reports', 'daily', params],
    queryFn: () => getDailyReport(params),
    enabled: !!params,
  });
}

export function useWeeklyReport(params?: WeeklyReportParams) {
  return useQuery({
    queryKey: ['reports', 'weekly', params],
    queryFn: () => getWeeklyReport(params),
    enabled: !!params,
  });
}

export function useMonthlyReport(params?: MonthlyReportParams) {
  return useQuery({
    queryKey: ['reports', 'monthly', params],
    queryFn: () => getMonthlyReport(params),
    enabled: !!params,
  });
}

export function useProductReport(params?: ProductReportParams) {
  return useQuery({
    queryKey: ['reports', 'products', params],
    queryFn: () => getProductReport(params),
    enabled: !!params,
  });
}

export function useStaffReport(params?: StaffReportParams) {
  return useQuery({
    queryKey: ['reports', 'staff', params],
    queryFn: () => getStaffReport(params),
    enabled: !!params,
  });
}

export function useOutletReport(params?: OutletReportParams) {
  return useQuery({
    queryKey: ['reports', 'outlets', params],
    queryFn: () => getOutletReport(params),
    enabled: !!params,
  });
}
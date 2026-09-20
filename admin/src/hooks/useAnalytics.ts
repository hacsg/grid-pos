import { useQuery } from '@tanstack/react-query';
import {
  getAnalyticsDashboard,
  getFlavorAnalysis,
  getFlavorRankings,
  getStaffLeaderboard,
  getTodayMetrics,
} from '@/api/client';
import type { AnalyticsDashboardParams, FlavorAnalysisParams } from '@/types/analytics';

export function useTodayMetrics(outletId?: string, fromDate?: string, toDate?: string) {
  return useQuery({
    queryKey: ['analytics', 'today-metrics', outletId, fromDate, toDate],
    queryFn: () => getTodayMetrics(outletId, fromDate, toDate),
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useAnalyticsDashboard(params?: AnalyticsDashboardParams) {
  return useQuery({
    queryKey: ['analytics', 'dashboard', params],
    queryFn: () => getAnalyticsDashboard(params),
    enabled: !!params,
    placeholderData: (prev) => prev,
  });
}

export function useFlavorAnalysis(params?: FlavorAnalysisParams) {
  return useQuery({
    queryKey: ['analytics', 'flavors', params],
    queryFn: () => getFlavorAnalysis(params),
    enabled: !!params,
    placeholderData: (prev) => prev,
  });
}

export function useFlavorRankings(params?: { outlet_id?: string }) {
  return useQuery({
    queryKey: ['analytics', 'flavor-rankings', params],
    queryFn: () => getFlavorRankings(params),
    placeholderData: (prev) => prev,
  });
}

export function useStaffLeaderboard(params?: {
  date_from: string;
  date_to: string;
  outlet_id?: string;
}) {
  return useQuery({
    queryKey: ['analytics', 'staff-leaderboard', params],
    queryFn: () => getStaffLeaderboard(params!),
    enabled: !!params,
    placeholderData: (prev) => prev,
  });
}

import { useQuery } from '@tanstack/react-query';
import {
  getAnalyticsDashboard,
  getFlavorAnalysis,
  getFlavorRankings,
  getStaffLeaderboard,
} from '@/api/client';
import type { AnalyticsDashboardParams, FlavorAnalysisParams } from '@/types/analytics';

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

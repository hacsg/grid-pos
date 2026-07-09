import { useQuery } from '@tanstack/react-query';
import { getAnalyticsDashboard, getFlavorAnalysis, getFlavorRankings } from '@/api/client';
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

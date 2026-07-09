import { useQuery } from '@tanstack/react-query';
import { getAnalyticsDashboard } from '@/api/client';
import type { AnalyticsDashboardParams } from '@/types/analytics';

export function useAnalyticsDashboard(params?: AnalyticsDashboardParams) {
  return useQuery({
    queryKey: ['analytics', 'dashboard', params],
    queryFn: () => getAnalyticsDashboard(params),
    enabled: !!params,
    placeholderData: (prev) => prev,
  });
}

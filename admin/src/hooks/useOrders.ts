import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getOrders,
  getOrder,
  refundOrder,
} from '@/api/client';
import type { OrderStatus } from '@/types';

export function useOrders(params?: {
  page?: number;
  limit?: number;
  status?: OrderStatus;
  outlet_id?: string;
  staff_id?: string;
  start_date?: string;
  end_date?: string;
}) {
  return useQuery({
    queryKey: ['orders', params],
    queryFn: () => getOrders(params),
  });
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: ['orders', id],
    queryFn: () => getOrder(id),
    enabled: !!id,
  });
}

export function useRefundOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => refundOrder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}
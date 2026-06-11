import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getDiscounts,
  createDiscount,
  updateDiscount,
  deleteDiscount,
  toggleDiscountActive,
  reorderDiscounts,
} from '@/api/client';
import type { DiscountFormData } from '@/types';

export function useDiscounts() {
  return useQuery({
    queryKey: ['discounts'],
    queryFn: () => getDiscounts(),
  });
}

export function useCreateDiscount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DiscountFormData) => createDiscount(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discounts'] });
    },
  });
}

export function useUpdateDiscount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<DiscountFormData> }) =>
      updateDiscount(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discounts'] });
    },
  });
}

export function useDeleteDiscount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteDiscount(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discounts'] });
    },
  });
}

export function useToggleDiscount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => toggleDiscountActive(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discounts'] });
    },
  });
}

export function useReorderDiscounts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => reorderDiscounts(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discounts'] });
    },
  });
}

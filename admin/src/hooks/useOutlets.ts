import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getOutlets,
  createOutlet,
  updateOutlet,
  deleteOutlet,
} from '@/api/client';
import type { OutletFormData } from '@/types';

export function useOutlets(params?: { page?: number; limit?: number }) {
  return useQuery({
    queryKey: ['outlets', params],
    queryFn: () => getOutlets(params),
  });
}

export function useCreateOutlet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: OutletFormData) => createOutlet(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outlets'] });
      queryClient.invalidateQueries({ queryKey: ['staff'] });
    },
  });
}

export function useUpdateOutlet(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<OutletFormData>) => updateOutlet(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outlets'] });
      queryClient.invalidateQueries({ queryKey: ['staff'] });
    },
  });
}

export function useDeleteOutlet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteOutlet(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outlets'] });
      queryClient.invalidateQueries({ queryKey: ['staff'] });
    },
  });
}
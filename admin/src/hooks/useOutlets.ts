import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getOutlets,
  createOutlet,
  updateOutlet,
  deleteOutlet,
  uploadPayNowQr,
  deletePayNowQr,
  uploadOutletLogo,
  deleteOutletLogo,
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

export function useUploadPayNowQr() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ outletId, file }: { outletId: string; file: File }) => uploadPayNowQr(outletId, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outlets'] });
    },
  });
}

export function useDeletePayNowQr() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (outletId: string) => deletePayNowQr(outletId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outlets'] });
    },
  });
}

export function useUploadOutletLogo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ outletId, file }: { outletId: string; file: File }) => uploadOutletLogo(outletId, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outlets'] });
    },
  });
}

export function useDeleteOutletLogo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (outletId: string) => deleteOutletLogo(outletId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outlets'] });
    },
  });
}

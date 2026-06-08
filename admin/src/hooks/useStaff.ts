import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getStaffList,
  createStaff,
  updateStaff,
  deleteStaff,
  resetStaffPin,
} from '@/api/client';
import type { StaffFormData } from '@/types';

export function useStaffList(params?: {
  page?: number;
  limit?: number;
  outlet_id?: string;
}) {
  return useQuery({
    queryKey: ['staff', params],
    queryFn: () => getStaffList(params),
  });
}

export function useCreateStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: StaffFormData) => createStaff(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
    },
  });
}

export function useUpdateStaff(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<StaffFormData>) => updateStaff(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
    },
  });
}

export function useDeleteStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteStaff(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
    },
  });
}

export function useResetStaffPin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, pin }: { id: string; pin: string }) => resetStaffPin(id, pin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
    },
  });
}

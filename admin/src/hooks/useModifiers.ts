import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getModifierGroups,
  createModifierGroup,
  updateModifierGroup,
  deleteModifierGroup,
  createModifierOption,
  updateModifierOption,
  deleteModifierOption,
  getProductModifierGroups,
  assignModifierGroupToProduct,
  updateProductModifierAssignment,
  unassignModifierGroupFromProduct,
} from '@/api/client';
import type {
  ModifierGroupCreate,
  ModifierGroupUpdate,
  ModifierOptionCreate,
  ModifierOptionUpdate,
  ProductModifierAssignmentCreate,
  ProductModifierAssignmentUpdate,
} from '@/types';

export function useModifierGroups() {
  return useQuery({
    queryKey: ['modifier-groups'],
    queryFn: getModifierGroups,
  });
}

export function useCreateModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ModifierGroupCreate) => createModifierGroup(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups'] }),
  });
}

export function useUpdateModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ModifierGroupUpdate }) =>
      updateModifierGroup(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups'] }),
  });
}

export function useDeleteModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteModifierGroup(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups'] }),
  });
}

export function useCreateModifierOption(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ModifierOptionCreate) => createModifierOption(groupId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups'] }),
  });
}

export function useUpdateModifierOption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ModifierOptionUpdate }) =>
      updateModifierOption(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups'] }),
  });
}

export function useDeleteModifierOption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteModifierOption(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups'] }),
  });
}

export function useProductModifierGroups(productId: string | null | undefined) {
  return useQuery({
    queryKey: ['product-modifier-groups', productId],
    queryFn: () => getProductModifierGroups(productId!),
    enabled: !!productId,
  });
}

export function useAssignModifierGroup(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ProductModifierAssignmentCreate) =>
      assignModifierGroupToProduct(productId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product-modifier-groups', productId] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useUpdateProductModifierAssignment(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId, data }: { assignmentId: string; data: ProductModifierAssignmentUpdate }) =>
      updateProductModifierAssignment(productId, assignmentId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product-modifier-groups', productId] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useUnassignModifierGroup(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) => unassignModifierGroupFromProduct(productId, assignmentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product-modifier-groups', productId] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

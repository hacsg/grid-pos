import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  activatePrintTemplate,
  createPrintTemplate,
  deletePrintTemplate,
  getPrintTemplatePreview,
  getPrintTemplates,
  updatePrintTemplate,
} from '@/api/client';
import type { PrintTemplateFormData } from '@/types';

export function usePrintTemplates(params: { outlet_id?: string | null; document_type: 'receipt' | 'kitchen_chit' }) {
  return useQuery({
    queryKey: ['print-templates', params],
    queryFn: () => getPrintTemplates(params),
  });
}

export function useCreatePrintTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: PrintTemplateFormData) => createPrintTemplate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['print-templates'] });
    },
  });
}

export function useUpdatePrintTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<PrintTemplateFormData> }) => updatePrintTemplate(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['print-templates'] });
    },
  });
}

export function useDeletePrintTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deletePrintTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['print-templates'] });
    },
  });
}

export function useActivatePrintTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => activatePrintTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['print-templates'] });
    },
  });
}

export function usePrintTemplatePreview() {
  return useMutation({
    mutationFn: ({ id, orderData }: { id: string; orderData?: Record<string, unknown> }) => getPrintTemplatePreview(id, orderData),
  });
}

import { Pencil, Plus, Printer, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import Designer from '@/components/print-templates/Designer';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Modal from '@/components/ui/Modal';
import { useActivatePrintTemplate, useCreatePrintTemplate, useDeletePrintTemplate, usePrintTemplatePreview, usePrintTemplates, useUpdatePrintTemplate } from '@/hooks/usePrintTemplates';
import { useOutlets } from '@/hooks/useOutlets';
import type { PrintTemplate, PrintTemplateFormData } from '@/types';

type DocumentType = 'receipt' | 'kitchen_chit';

export default function PrintTemplates() {
  const [documentType, setDocumentType] = useState<DocumentType>('receipt');
  const [outletId, setOutletId] = useState<string | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<PrintTemplate | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<PrintTemplate | null>(null);

  const { data: outletsData } = useOutlets();
  const outlets = outletsData?.data ?? [];
  const activeOutletId = outletId === null ? outlets[0]?.id || '' : outletId;

  const templatesQuery = usePrintTemplates({
    outlet_id: activeOutletId || null,
    document_type: documentType,
  });
  const createTemplate = useCreatePrintTemplate();
  const updateTemplate = useUpdatePrintTemplate();
  const deleteTemplate = useDeletePrintTemplate();
  const activateTemplate = useActivatePrintTemplate();
  const previewMutation = usePrintTemplatePreview();

  const templates = useMemo(
    () => (templatesQuery.data || []).filter(
      (template) => template.document_type === documentType && template.outlet_id === (activeOutletId || null),
    ),
    [activeOutletId, documentType, templatesQuery.data],
  );
  const effectiveTemplate = templates.find((template) => template.is_active)
    ?? (activeOutletId
      ? (templatesQuery.data || []).find(
          (template) => template.document_type === documentType && template.outlet_id === null && template.is_active,
        )
      : undefined);

  function nextCopyName(name: string): string {
    const existingNames = new Set(templates.map((template) => template.name));
    let candidate = `${name} Copy`;
    let suffix = 2;
    while (existingNames.has(candidate)) {
      candidate = `${name} Copy ${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  async function handleDuplicate(template: PrintTemplate) {
    try {
      await createTemplate.mutateAsync({
        outlet_id: activeOutletId || null,
        document_type: template.document_type,
        name: nextCopyName(template.name),
        is_active: false,
        config: template.config,
      });
      toast.success('Template duplicated');
    } catch {
      // shared client toast
    }
  }

  async function handleSave(data: PrintTemplateFormData, duplicate: boolean) {
    const payload = {
      ...data,
      outlet_id: editingTemplate?.id ? editingTemplate.outlet_id : activeOutletId || null,
      name: duplicate && editingTemplate ? nextCopyName(data.name) : data.name,
    };

    try {
      if (editingTemplate && !duplicate) {
        await updateTemplate.mutateAsync({ id: editingTemplate.id, data: payload });
        toast.success('Template updated');
      } else {
        await createTemplate.mutateAsync(payload);
        toast.success('Template created');
      }
      setEditingTemplate(null);
      await templatesQuery.refetch();
    } catch {
      // shared client toast
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Print Templates</h1>
          <p className="mt-1 text-sm text-text-muted">Configure receipt and kitchen chit layouts per outlet.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={activeOutletId}
            onChange={(event) => setOutletId(event.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">All outlets (global default)</option>
            {outlets.map((outlet) => (
              <option key={outlet.id} value={outlet.id}>
                {outlet.name}
              </option>
            ))}
          </select>
          <Button
            onClick={() => {
              previewMutation.reset();
              setEditingTemplate({
                id: '',
                outlet_id: activeOutletId || null,
                document_type: documentType,
                name: '',
                is_active: false,
                config: {
                  documentType,
                  pageSize: { widthMM: 58, charWidth: 32 },
                  blocks: [],
                },
                created_at: '',
                updated_at: '',
              })
            }}
          >
            <Plus className="h-4 w-4" />
            New Template
          </Button>
        </div>
      </div>

      <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1">
        {[
          { value: 'receipt', label: 'Receipt' },
          { value: 'kitchen_chit', label: 'Kitchen Chit' },
        ].map((tab) => (
          <button
            key={tab.value}
            type="button"
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${documentType === tab.value ? 'bg-primary text-white' : 'text-text-muted hover:bg-surface hover:text-text'}`}
            onClick={() => {
              setDocumentType(tab.value as DocumentType);
              setEditingTemplate(null);
              setPreviewTemplate(null);
              previewMutation.reset();
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Currently printing</p>
          <p className="mt-0.5 font-semibold text-text">
            {effectiveTemplate?.name ?? (documentType === 'receipt' ? 'Built-in receipt layout' : 'Built-in kitchen chit layout')}
            <span className="ml-2 text-xs font-normal text-text-muted">
              {effectiveTemplate ? (effectiveTemplate.outlet_id ? 'Outlet template' : 'Global fallback') : 'Safe fallback'}
            </span>
          </p>
        </div>
        <p className="text-xs text-text-muted">Activated changes reach each POS within 60 seconds.</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {templates.map((template) => (
          <Card key={template.id} className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-text">{template.name}</h3>
                  {template.is_active ? <span className="rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success">Active</span> : null}
                  {template.outlet_id === null ? <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium text-text-muted">Global</span> : null}
                </div>
                <p className="mt-1 text-sm text-text-muted">
                  Updated {formatDistanceToNow(new Date(template.updated_at), { addSuffix: true })}
                </p>
              </div>
              <Printer className="h-5 w-5 text-text-muted" />
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => { previewMutation.reset(); setEditingTemplate(template); }}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void handleDuplicate(template)}>
                Duplicate
              </Button>
              {!template.is_active ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => activateTemplate.mutate(template.id, { onSuccess: () => toast.success('Template activated; tills update within 60 seconds') })}
                >
                  Activate
                </Button>
              ) : null}
              <Button variant="secondary" size="sm" onClick={() => { previewMutation.reset(); setPreviewTemplate(template); previewMutation.mutate({ id: template.id }); }}>
                Preview
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-error hover:bg-error/5 hover:text-error"
                onClick={() => {
                  const warning = template.is_active
                    ? 'This template is active. Deleting it will immediately return this scope to its fallback print layout. Delete it?'
                    : `Delete "${template.name}"?`;
                  if (window.confirm(warning)) {
                    deleteTemplate.mutate(template.id, { onSuccess: () => toast.success('Template deleted') });
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {!templatesQuery.isLoading && templates.length === 0 ? (
        <Card className="p-8 text-center">
          <Printer className="mx-auto h-8 w-8 text-text-muted" />
          <h3 className="mt-3 font-semibold text-text">No {documentType === 'receipt' ? 'receipt' : 'kitchen chit'} templates in this scope</h3>
          <p className="mt-1 text-sm text-text-muted">Create one to start from the current safe default layout, then activate it when the preview is correct.</p>
        </Card>
      ) : null}

      <Modal
        isOpen={!!editingTemplate}
        onClose={() => setEditingTemplate(null)}
        title={editingTemplate?.id ? 'Edit Print Template' : 'New Print Template'}
        size="lg"
      >
        {editingTemplate ? (
          <Designer
            documentType={documentType}
            template={editingTemplate.id ? editingTemplate : null}
            onClose={() => setEditingTemplate(null)}
            onSave={handleSave}
            saving={createTemplate.isPending || updateTemplate.isPending}
          />
        ) : null}
      </Modal>

      <Modal
        isOpen={!!previewTemplate}
        onClose={() => setPreviewTemplate(null)}
        title={previewTemplate ? `${previewTemplate.name} Preview` : 'Preview'}
        size="md"
      >
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-gray-200 bg-[#fffdf8] p-4 font-mono text-xs leading-5 text-text">
          {previewMutation.data?.text || 'Select refresh to load the server preview.'}
        </pre>
        {previewTemplate ? (
          <div className="mt-4 flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => previewMutation.mutate({ id: previewTemplate.id })}
            >
              Load Preview
            </Button>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

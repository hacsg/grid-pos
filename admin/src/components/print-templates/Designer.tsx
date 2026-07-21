import { Eye, EyeOff, GripVertical, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import BlockEditor from '@/components/print-templates/BlockEditor';
import Preview from '@/components/print-templates/Preview';
import { DEFAULT_SAMPLE_ORDER, renderPrintPreview } from '@/utils/printPreview';
import type { PrintTemplate, PrintTemplateBlock, PrintTemplateConfig, PrintTemplateFormData } from '@/types';

const RECEIPT_BLOCKS: PrintTemplateBlock[] = [
  { type: 'header', visible: true, fields: { showBrandName: true, showCompanyDetails: true, showOutletName: true } },
  { type: 'orderMeta', visible: true, fields: { showOrderNumber: true, showDate: true } },
  { type: 'itemsTable', visible: true, fields: { columns: ['qty', 'name', 'price'], showModifiers: true } },
  { type: 'totals', visible: true, fields: { showDiscounts: true, showVouchers: true, showGrandTotal: true } },
  { type: 'payment', visible: true, fields: { showMethod: true, showChange: true } },
  { type: 'footer', visible: true, fields: { line1: 'Thank you', line2: '' } },
  { type: 'feedCut', visible: true, fields: { lines: 0 } },
];

const KITCHEN_BLOCKS: PrintTemplateBlock[] = [
  { type: 'kitchenHeader', visible: true, fields: { title: 'KITCHEN', showOrderNumber: true, showTime: true } },
  { type: 'kitchenItems', visible: true, fields: { showModifiers: true } },
  { type: 'feedCut', visible: true, fields: { lines: 0 } },
];

const BLOCK_LABELS: Record<string, string> = {
  header: 'Header',
  orderMeta: 'Order Meta',
  itemsTable: 'Items Table',
  totals: 'Totals',
  payment: 'Payment',
  footer: 'Footer',
  text: 'Custom Text',
  feedCut: 'Feed & Cut',
  kitchenHeader: 'Kitchen Header',
  kitchenItems: 'Kitchen Items',
};

function defaultConfig(documentType: 'receipt' | 'kitchen_chit'): PrintTemplateConfig {
  return {
    documentType,
    pageSize: { widthMM: 58, charWidth: 32 },
    blocks: documentType === 'receipt' ? RECEIPT_BLOCKS : KITCHEN_BLOCKS,
  };
}

interface DesignerProps {
  documentType: 'receipt' | 'kitchen_chit';
  template: PrintTemplate | null;
  onClose: () => void;
  onSave: (payload: PrintTemplateFormData, duplicate: boolean) => Promise<void>;
  saving: boolean;
}

export default function Designer({ documentType, template, onClose, onSave, saving }: DesignerProps) {
  const [name, setName] = useState(template?.name ?? (documentType === 'receipt' ? 'New Receipt' : 'New Kitchen Chit'));
  const [isActive, setIsActive] = useState(template?.is_active ?? false);
  const [config, setConfig] = useState<PrintTemplateConfig>(template?.config ?? defaultConfig(documentType));
  const [expanded, setExpanded] = useState<string | null>(config.blocks[0]?.type ?? null);
  const [isDuplicating, setIsDuplicating] = useState(false);

  const preview = useMemo(() => renderPrintPreview(config, { ...DEFAULT_SAMPLE_ORDER, documentType }), [config, documentType]);
  const palette = documentType === 'receipt'
    ? [...RECEIPT_BLOCKS, { type: 'text', visible: true, fields: { content: 'Custom message', align: 'center', uppercase: false } }]
    : KITCHEN_BLOCKS;

  const handleSave = async (duplicate = false) => {
    if (!name.trim()) return;
    await onSave(
      {
        outlet_id: template?.outlet_id ?? null,
        document_type: documentType,
        name: name.trim(),
        is_active: duplicate ? false : isActive,
        config,
      },
      duplicate,
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)]">
      <div className="space-y-4">
        <div className="space-y-3">
          {config.blocks.map((block, index) => (
            <div key={`${block.type}-${index}`} className="rounded-xl border border-gray-200 bg-white">
              <div className="flex items-center pr-3">
                <button
                  type="button"
                  className="flex flex-1 items-center gap-3 px-4 py-3 text-left text-sm text-text transition-colors hover:bg-surface/70"
                  onClick={() => setExpanded(expanded === `${block.type}-${index}` ? null : `${block.type}-${index}`)}
                >
                  <GripVertical className="h-4 w-4 text-text-muted" />
                  <span className="font-medium">{BLOCK_LABELS[block.type] ?? block.type}</span>
                </button>
                <button
                  type="button"
                  className="rounded-md p-2 text-text-muted hover:bg-surface"
                  aria-label={block.visible ? `Hide ${BLOCK_LABELS[block.type]}` : `Show ${BLOCK_LABELS[block.type]}`}
                  onClick={() => {
                    setConfig((current) => ({
                      ...current,
                      blocks: current.blocks.map((candidate, candidateIndex) =>
                        candidateIndex === index ? { ...candidate, visible: !candidate.visible } : candidate
                      ),
                    }));
                  }}
                >
                  {block.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
              </div>
              {expanded === `${block.type}-${index}` ? (
                <div className="space-y-3 border-t border-gray-100 px-4 py-4">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={index === 0}
                      onClick={() =>
                        setConfig((current) => {
                          const blocks = [...current.blocks];
                          [blocks[index - 1], blocks[index]] = [blocks[index], blocks[index - 1]];
                          return { ...current, blocks };
                        })
                      }
                    >
                      Up
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={index === config.blocks.length - 1}
                      onClick={() =>
                        setConfig((current) => {
                          const blocks = [...current.blocks];
                          [blocks[index], blocks[index + 1]] = [blocks[index + 1], blocks[index]];
                          return { ...current, blocks };
                        })
                      }
                    >
                      Down
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={config.blocks.length === 1}
                      className="ml-auto text-error hover:bg-error/5 hover:text-error"
                      onClick={() =>
                        setConfig((current) => ({
                          ...current,
                          blocks: current.blocks.filter((_, candidateIndex) => candidateIndex !== index),
                        }))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove
                    </Button>
                  </div>
                  <BlockEditor
                    block={block}
                    onChange={(nextBlock) =>
                      setConfig((current) => ({
                        ...current,
                        blocks: current.blocks.map((candidate, candidateIndex) => (candidateIndex === index ? nextBlock : candidate)),
                      }))
                    }
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-4">
          <p className="mb-3 text-sm font-medium text-text">Add block</p>
          <div className="flex flex-wrap gap-2">
            {palette.map((block) => (
              <Button
                key={`add-${block.type}`}
                variant="secondary"
                size="sm"
                onClick={() =>
                  setConfig((current) => ({
                    ...current,
                    blocks: [...current.blocks, JSON.parse(JSON.stringify(block))],
                  }))
                }
              >
                <Plus className="h-4 w-4" />
                {BLOCK_LABELS[block.type]}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium text-text">Live Preview</p>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-text-muted" htmlFor="paper-width">Paper</label>
            <select
              id="paper-width"
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-text"
              value={config.pageSize.widthMM}
              onChange={(event) => {
                const widthMM = Number(event.target.value);
                setConfig((current) => ({ ...current, pageSize: { widthMM, charWidth: widthMM === 80 ? 48 : 32 } }));
              }}
            >
              <option value={58}>58 mm</option>
              <option value={80}>80 mm</option>
            </select>
          </div>
        </div>
        <Preview text={preview} />
        <p className="text-xs leading-5 text-text-muted">
          Thermal output is plain ESC/POS text. Characters outside basic ASCII may print as "?" depending on the printer code page.
        </p>
        <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
          <Input label="Template Name" value={name} onChange={(event) => setName(event.target.value)} />
          <label className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm text-text">
            <span>Set active after save</span>
            <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
          </label>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setIsDuplicating(true);
                void handleSave(true).finally(() => setIsDuplicating(false));
              }}
              loading={saving && isDuplicating}
            >
              Save as Copy
            </Button>
            <Button disabled={!name.trim()} onClick={() => void handleSave()} loading={saving && !isDuplicating}>
              Save Template
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

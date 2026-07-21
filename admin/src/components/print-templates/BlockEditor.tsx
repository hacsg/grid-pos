import Input from '@/components/ui/Input';
import type { PrintTemplateBlock } from '@/types';

interface BlockEditorProps {
  block: PrintTemplateBlock;
  onChange: (block: PrintTemplateBlock) => void;
}

const FIELD_LABELS: Record<string, string> = {
  showBrandName: 'Show brand name',
  showCompanyDetails: 'Show company details',
  showOutletName: 'Show outlet name',
  showOrderNumber: 'Show order number',
  showDate: 'Show date and time',
  showModifiers: 'Show modifiers',
  showDiscounts: 'Show discounts',
  showVouchers: 'Show voucher summary and details',
  showGrandTotal: 'Show grand total',
  showMethod: 'Show payment method',
  showChange: 'Show change due',
  showTime: 'Show time',
  line1: 'First line',
  line2: 'Second line',
  title: 'Heading',
  lines: 'Extra feed lines',
  content: 'Text',
  align: 'Alignment',
  uppercase: 'Uppercase',
};

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase());
}

export default function BlockEditor({ block, onChange }: BlockEditorProps) {
  const entries = Object.entries(block.fields || {});

  return (
    <div className="space-y-3 rounded-lg border border-gray-100 bg-surface/40 p-3">
      {entries.length === 0 ? <p className="text-xs text-text-muted">This block has no editable fields.</p> : null}
      {entries.map(([key, value]) => {
        if (typeof value === 'boolean') {
          return (
            <label key={key} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-text">
              <span>{fieldLabel(key)}</span>
              <input
                type="checkbox"
                checked={value}
                onChange={(event) =>
                  onChange({
                    ...block,
                    fields: {
                      ...block.fields,
                      [key]: event.target.checked,
                    },
                  })
                }
              />
            </label>
          );
        }

        if (Array.isArray(value)) {
          if (key === 'columns') {
            return (
              <fieldset key={key} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                <legend className="px-1 text-xs font-medium text-text-muted">Item columns</legend>
                <div className="flex flex-wrap gap-4 text-sm text-text">
                  {[
                    { value: 'qty', label: 'Quantity' },
                    { value: 'price', label: 'Price' },
                  ].map((column) => (
                    <label key={column.value} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={value.includes(column.value)}
                        onChange={(event) => {
                          const next = event.target.checked
                            ? [...value, column.value]
                            : value.filter((item) => item !== column.value);
                          onChange({ ...block, fields: { ...block.fields, [key]: ['name', ...next.filter((item) => item !== 'name')] } });
                        }}
                      />
                      {column.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          }
          return (
            <Input
              key={key}
              label={fieldLabel(key)}
              value={value.join(',')}
              onChange={(event) =>
                onChange({
                  ...block,
                  fields: {
                    ...block.fields,
                    [key]: event.target.value.split(',').map((item) => item.trim()).filter(Boolean),
                  },
                })
              }
            />
          );
        }

        if (key === 'align') {
          return (
            <label key={key} className="grid gap-1.5 text-sm text-text">
              <span className="font-medium">Alignment</span>
              <select
                className="rounded-lg border border-gray-200 bg-white px-3 py-2"
                value={String(value || 'left')}
                onChange={(event) => onChange({ ...block, fields: { ...block.fields, [key]: event.target.value } })}
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
              </select>
            </label>
          );
        }

        return (
          <Input
            key={key}
            label={fieldLabel(key)}
            type={typeof value === 'number' ? 'number' : 'text'}
            min={key === 'lines' ? 0 : undefined}
            max={key === 'lines' ? 10 : undefined}
            maxLength={key === 'content' ? 500 : key === 'title' ? 32 : undefined}
            value={String(value ?? '')}
            onChange={(event) =>
              onChange({
                ...block,
                fields: {
                  ...block.fields,
                  [key]: typeof value === 'number' ? Number(event.target.value || 0) : event.target.value,
                },
              })
            }
          />
        );
      })}
    </div>
  );
}

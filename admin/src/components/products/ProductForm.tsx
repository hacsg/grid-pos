import { useEffect, useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useModifierGroups } from '@/hooks/useModifiers';
import type { Product, Category, ProductModifierAssignment } from '@/types';

const productSchema = z.object({
  name: z.string().min(1, 'Product name is required'),
  description: z.string(),
  price: z.coerce.number().positive('Price must be positive'),
  category_id: z.string().min(1, 'Category is required'),
  available: z.boolean(),
  is_gift_card: z.boolean(),
});

type ProductFormValues = z.infer<typeof productSchema>;

const sortAssignments = (items: ProductModifierAssignment[]) =>
  [...items].sort((a, b) => a.display_order - b.display_order || a.group_name.localeCompare(b.group_name));

interface ProductFormProps {
  product?: Product | null;
  categories: Category[];
  onSubmit: (data: ProductFormValues, assignments: ProductModifierAssignment[]) => void;
  onCancel: () => void;
  onModifierChanges?: (assignments: ProductModifierAssignment[]) => void;
  loading?: boolean;
}

export default function ProductForm({
  product,
  categories,
  onSubmit,
  onCancel,
  onModifierChanges,
  loading = false,
}: ProductFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: product?.name ?? '',
      description: product?.description ?? '',
      price: product?.price ?? 0,
      category_id: product?.category_id ?? '',
      available: product?.available ?? true,
      is_gift_card: product?.is_gift_card ?? false,
    },
  });

  // Modifier assignments (for existing product)
  const { data: modifierGroupsData = [] } = useModifierGroups();
  const [assignments, setAssignments] = useState<ProductModifierAssignment[]>([]);
  const [selectedToAdd, setSelectedToAdd] = useState('');

  // Seed assignments from product when it loads/changes
  useEffect(() => {
    if (product?.modifier_groups) {
      setAssignments(product.modifier_groups);
    } else {
      setAssignments([]);
    }
  }, [product?.id, product?.modifier_groups]);

  useEffect(() => {
    onModifierChanges?.(sortAssignments(assignments));
  }, [assignments, onModifierChanges]);

  // Populate form fields (name, description, price, etc). Using defaultValues for sync init on mount + reset in effect for safety/timing.
  // The key={editingProduct?.id} in parent forces remount when switching products so this runs with correct data.
  useEffect(() => {
    const formValues = {
      name: product?.name ?? '',
      description: product?.description ?? '',
      price: product?.price ?? 0,
      category_id: product?.category_id ?? '',
      available: product?.available ?? true,
      is_gift_card: product?.is_gift_card ?? false,
    };
    reset(formValues);
  }, [product?.id, reset]);

  const assignedGroupIds = new Set(assignments.map((a) => a.group_id));
  const availableToAdd = modifierGroupsData.filter((g) => !assignedGroupIds.has(g.id));

  const handleFormSubmit = (data: ProductFormValues) => {
    onSubmit(data, sortAssignments(assignments));
  };

  const handleAddGroup = () => {
    if (!product?.id || !selectedToAdd) return;
    const group = modifierGroupsData.find((g) => g.id === selectedToAdd);
    if (!group) return;
    const nextDisplayOrder = assignments.length > 0
      ? Math.max(...assignments.map((a) => a.display_order)) + 1
      : 0;
    const created: ProductModifierAssignment = {
      id: `new-${group.id}-${Date.now()}`,
      group_id: group.id,
      group_name: group.name,
      group_description: group.description,
      min_select: 0,
      max_select: 1,
      is_required: false,
      display_order: nextDisplayOrder,
      options: group.options,
    };
    setAssignments((prev) => [...prev, created]);
    setSelectedToAdd('');
  };

  const handleUpdateAssignment = (assignmentId: string, patch: Partial<ProductModifierAssignment>) => {
    if (!product?.id) return;
    setAssignments((prev) =>
      prev.map((a) => (a.id === assignmentId ? { ...a, ...patch } : a))
    );
  };

  const handleRemoveAssignment = (assignmentId: string) => {
    if (!product?.id) return;
    setAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
  };

  const moveAssignment = (index: number, direction: -1 | 1) => {
    const sorted = sortAssignments(assignments);
    const target = index + direction;
    if (target < 0 || target >= sorted.length) return;
    // Reassign sequential display_orders after the swap
    const reordered = [...sorted];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setAssignments((prev) =>
      prev.map((a) => {
        const newIdx = reordered.findIndex((r) => r.id === a.id);
        return { ...a, display_order: newIdx };
      })
    );
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-5">
      <Input
        label="Product Name"
        placeholder="e.g. Classic Gelato"
        error={errors.name?.message}
        {...register('name')}
      />

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-text">Description</label>
        <textarea
          className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-text placeholder:text-text-muted/60 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          rows={3}
          placeholder="Describe the product..."
          {...register('description')}
        />
        {errors.description && (
          <span className="text-xs text-error">{errors.description.message}</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Price (S$)"
          type="number"
          step="0.01"
          placeholder="0.00"
          error={errors.price?.message}
          {...register('price')}
        />

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text">Category</label>
          <select
            className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-text transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            {...register('category_id')}
          >
            <option value="">Select category</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
          {errors.category_id && (
            <span className="text-xs text-error">{errors.category_id.message}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="available"
          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
          {...register('available')}
        />
        <label htmlFor="available" className="text-sm text-text">
          Available for sale
        </label>
      </div>

      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          id="is_gift_card"
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
          {...register('is_gift_card')}
        />
        <div className="flex flex-col">
          <label htmlFor="is_gift_card" className="text-sm text-text">
            Physical gift card
          </label>
          <span className="text-xs text-text-muted">
            Selling this prompts staff to scan and activate a physical card after payment.
          </span>
        </div>
      </div>

      {/* Modifier Groups Section */}
      <div className="border-t border-gray-100 pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-text">Modifier Groups</div>
            <div className="text-xs text-text-muted">Control which modifier groups apply to this product and their selection rules.</div>
          </div>
        </div>

        {!product?.id ? (
          <div className="text-xs text-text-muted bg-surface rounded p-3">
            Save the product first to manage modifier group assignments.
          </div>
        ) : (
          <>
            {/* Add selector */}
            <div className="flex items-center gap-2">
              <select
                className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none"
                value={selectedToAdd}
                onChange={(e) => setSelectedToAdd(e.target.value)}
              >
                <option value="">Select a modifier group to add…</option>
                {availableToAdd.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!selectedToAdd}
                onClick={handleAddGroup}
              >
                Add
              </Button>
            </div>

            {/* Assigned list */}
            {assignments.length === 0 ? (
              <div className="text-xs text-text-muted">No modifier groups assigned yet.</div>
            ) : (
              <div className="space-y-2">
                {sortAssignments(assignments).map((a, idx) => (
                  <div key={a.id} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col gap-0.5">
                          <button
                            type="button"
                            onClick={() => moveAssignment(idx, -1)}
                            disabled={idx === 0}
                            className="rounded p-0.5 text-text-muted hover:text-text disabled:opacity-30"
                            aria-label="Move up"
                          >
                            <ChevronUp className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveAssignment(idx, 1)}
                            disabled={idx === assignments.length - 1}
                            className="rounded p-0.5 text-text-muted hover:text-text disabled:opacity-30"
                            aria-label="Move down"
                          >
                            <ChevronDown className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="font-medium text-sm">{a.group_name}</div>
                      </div>
                      <button
                        type="button"
                        className="text-xs text-error hover:underline"
                        onClick={() => handleRemoveAssignment(a.id)}
                      >
                        Remove
                      </button>
                    </div>
                    {a.group_description && (
                      <div className="text-[11px] text-text-muted mb-2">{a.group_description}</div>
                    )}

                    <div className="grid grid-cols-2 gap-3 mt-2">
                      <div>
                        <label className="block text-[11px] text-text-muted mb-1">Min select</label>
                        <input
                          type="number"
                          min={0}
                          className="w-full rounded border border-gray-200 px-2 py-1 text-sm"
                          value={a.min_select}
                          onChange={(e) =>
                            handleUpdateAssignment(a.id, { min_select: Math.max(0, parseInt(e.target.value || '0', 10)) })
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-text-muted mb-1">Max select</label>
                        <input
                          type="number"
                          min={1}
                          className="w-full rounded border border-gray-200 px-2 py-1 text-sm"
                          value={a.max_select}
                          onChange={(e) =>
                            handleUpdateAssignment(a.id, { max_select: Math.max(1, parseInt(e.target.value || '1', 10)) })
                          }
                        />
                      </div>
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      <input
                        id={`req-${a.id}`}
                        type="checkbox"
                        checked={a.is_required}
                        onChange={(e) => {
                          const isRequired = e.target.checked;
                          handleUpdateAssignment(a.id, {
                            is_required: isRequired,
                            min_select: isRequired ? Math.max(a.min_select, 1) : 0,
                          });
                        }}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      <label htmlFor={`req-${a.id}`} className="text-xs text-text">Required</label>
                    </div>

                    <div className="mt-1 text-[10px] text-text-muted">
                      {a.options?.length || 0} option{(a.options?.length || 0) === 1 ? '' : 's'} available
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
        <Button variant="secondary" onClick={onCancel} type="button">
          Cancel
        </Button>
        <Button type="submit" loading={loading}>
          {product ? 'Update Product' : 'Create Product'}
        </Button>
      </div>
    </form>
  );
}

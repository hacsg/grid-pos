import { useState } from 'react';
import { ChevronUp, ChevronDown, Plus, Pencil, Trash2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';
import type { Category, Outlet } from '@/types';

interface CategoryManagerProps {
  categories: Category[];
  outlets: Outlet[];
  loading: boolean;
  onCreate: (data: { name: string; outlet_id: string | null }) => void;
  onUpdate: (id: string, data: { name: string; outlet_id: string | null }) => void;
  onDelete: (id: string) => void;
  onReorder: (ids: string[]) => void;
}

export default function CategoryManager({
  categories,
  outlets,
  loading,
  onCreate,
  onUpdate,
  onDelete,
  onReorder,
}: CategoryManagerProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [name, setName] = useState('');
  const [outletId, setOutletId] = useState<string | null>(null);

  const openCreateModal = () => {
    setEditingCategory(null);
    setName('');
    setOutletId(null);
    setIsModalOpen(true);
  };

  const openEditModal = (category: Category) => {
    setEditingCategory(category);
    setName(category.name);
    setOutletId(category.outlet_id);
    setIsModalOpen(true);
  };

  const handleSubmit = () => {
    if (!name.trim()) return;
    const data = { name: name.trim(), outlet_id: outletId };
    if (editingCategory) {
      onUpdate(editingCategory.id, data);
    } else {
      onCreate(data);
    }
    setIsModalOpen(false);
  };

  const getOutletName = (id: string | null) => {
    if (!id) return null;
    return outlets.find((o) => o.id === id)?.name ?? null;
  };

  const moveCategory = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= categories.length) return;
    const newOrder = [...categories];
    // Swap the elements
    const tmp = newOrder[index];
    newOrder[index] = newOrder[target];
    newOrder[target] = tmp;
    // Reassign sort_order sequentially
    const ids = newOrder.map((c) => c.id);
    onReorder(ids);
  };

  return (
    <>
      <Card
        title="Categories"
        subtitle={`${categories.length} categories`}
        action={
          <Button size="sm" onClick={openCreateModal}>
            <Plus className="h-4 w-4" />
            Add Category
          </Button>
        }
      >
        <div className="space-y-1">
          {categories.map((category, index) => (
            <div
              key={category.id}
              className="flex items-center gap-3 rounded-lg border border-gray-100 px-4 py-3 transition-colors hover:bg-surface"
            >
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => moveCategory(index, -1)}
                  disabled={index === 0}
                  className="rounded p-0.5 text-text-muted hover:text-text disabled:opacity-30"
                  aria-label="Move up"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => moveCategory(index, 1)}
                  disabled={index === categories.length - 1}
                  className="rounded p-0.5 text-text-muted hover:text-text disabled:opacity-30"
                  aria-label="Move down"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text">{category.name}</p>
                <p className="text-xs text-text-muted">
                  Order: {category.sort_order}
                  {category.outlet_id
                    ? ` · ${getOutletName(category.outlet_id) ?? 'Assigned outlet'}`
                    : ' · All outlets'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => openEditModal(category)}
                  className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-white hover:text-text"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => onDelete(category.id)}
                  className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-white hover:text-error"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {categories.length === 0 && !loading && (
          <div className="py-8 text-center text-sm text-text-muted">
            No categories yet. Click "Add Category" to create one.
          </div>
        )}
      </Card>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingCategory ? 'Edit Category' : 'Create Category'}
      >
        <div className="space-y-4">
          <Input
            label="Category Name"
            placeholder="e.g. Gelato, Sorbet"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          {outlets.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text">Assign to Outlet</label>
              <select
                value={outletId ?? ''}
                onChange={(e) => setOutletId(e.target.value || null)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">All outlets (global)</option>
                {outlets.map((outlet) => (
                  <option key={outlet.id} value={outlet.id}>
                    {outlet.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>
              {editingCategory ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
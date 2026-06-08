import { useState } from 'react';
import { GripVertical, Plus, Pencil, Trash2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';
import type { Category, Outlet } from '@/types';

interface CategoryManagerProps {
  categories: Category[];
  outlets: Outlet[];
  loading: boolean;
  onCreate: (data: { name: string; outlet_ids: string[] }) => void;
  onUpdate: (id: string, data: { name: string; outlet_ids: string[] }) => void;
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
  const [selectedOutlets, setSelectedOutlets] = useState<string[]>([]);

  const openCreateModal = () => {
    setEditingCategory(null);
    setName('');
    setSelectedOutlets([]);
    setIsModalOpen(true);
  };

  const openEditModal = (category: Category) => {
    setEditingCategory(category);
    setName(category.name);
    setSelectedOutlets(category.outlet_ids || []);
    setIsModalOpen(true);
  };

  const handleSubmit = () => {
    if (!name.trim()) return;
    const data = { name: name.trim(), outlet_ids: selectedOutlets };
    if (editingCategory) {
      onUpdate(editingCategory.id, data);
    } else {
      onCreate(data);
    }
    setIsModalOpen(false);
  };

  const toggleOutlet = (outletId: string) => {
    setSelectedOutlets((prev) =>
      prev.includes(outletId)
        ? prev.filter((id) => id !== outletId)
        : [...prev, outletId]
    );
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
              <button className="cursor-grab text-text-muted hover:text-text">
                <GripVertical className="h-4 w-4" />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text">{category.name}</p>
                <p className="text-xs text-text-muted">
                  Order: {category.sort_order}
                  {category.outlet_ids?.length > 0 &&
                    ` · ${category.outlet_ids.length} outlet(s)`}
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
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-text">Assign to Outlets</label>
              <div className="space-y-2">
                {outlets.map((outlet) => (
                  <label
                    key={outlet.id}
                    className="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2 cursor-pointer hover:bg-surface"
                  >
                    <input
                      type="checkbox"
                      checked={selectedOutlets.includes(outlet.id)}
                      onChange={() => toggleOutlet(outlet.id)}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <div>
                      <p className="text-sm font-medium text-text">{outlet.name}</p>
                      <p className="text-xs text-text-muted">{outlet.address}</p>
                    </div>
                  </label>
                ))}
              </div>
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
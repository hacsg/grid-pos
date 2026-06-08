import {
  useCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useReorderCategories,
} from '@/hooks/useCategories';
import { useOutlets } from '@/hooks/useOutlets';
import CategoryManager from '@/components/products/CategoryManager';
import type { CategoryFormData } from '@/types';

export default function Categories() {
  const { data: categoriesData, isLoading } = useCategories();
  const { data: outletsData } = useOutlets();

  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();
  const reorderCategories = useReorderCategories();

  const categories = categoriesData?.data || [];
  const outlets = outletsData?.data || [];

  const handleCreate = (data: CategoryFormData) => {
    createCategory.mutate(data);
  };

  const handleUpdate = (id: string, data: CategoryFormData) => {
    updateCategory.mutate({ id, data });
  };

  const handleDelete = (id: string) => {
    if (!window.confirm('Delete this category?')) return;
    deleteCategory.mutate(id);
  };

  const handleReorder = (ids: string[]) => {
    reorderCategories.mutate(ids);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text">Categories</h1>
        <p className="mt-1 text-sm text-text-muted">
          Manage product categories and outlet assignments
        </p>
      </div>

      <div className="max-w-2xl">
        <CategoryManager
          categories={categories}
          outlets={outlets}
          loading={isLoading}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onReorder={handleReorder}
        />
      </div>
    </div>
  );
}